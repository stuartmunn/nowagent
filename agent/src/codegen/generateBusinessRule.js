'use strict';

/**
 * NOW-10: Business Rule generation (codegen only, no deploy).
 *
 * Given structured context + a plain-English description, produces a
 * Fluent Business Rule (.now.ts + server script), validates it via the
 * Fluent workspace's own now-sdk build, and returns a structured summary
 * suitable for the approval-statement story (NOW-12) to consume — never
 * raw code as the primary hand-off.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { generateScriptBody } = require('./claudeClient');
const { validateFluentWorkspace } = require('./fluentValidate');
const { FLUENT_DIR, SERVER_DIR, withLock, clearGeneratedDir } = require('./fluentWorkspace');
const { slugify, escapeSingleQuotes, assertSafeIdentifier } = require('./textUtils');

const VALID_WHEN = new Set(['before', 'after', 'async', 'display']);
const VALID_ACTIONS = new Set(['insert', 'update', 'delete', 'query']);

function assertValidContext(context) {
  if (!context || typeof context !== 'object') {
    throw new Error('context is required');
  }
  const { table, when, action, description } = context;
  if (!table || typeof table !== 'string') {
    throw new Error('context.table is required (e.g. "incident")');
  }
  if (!VALID_WHEN.has(when)) {
    throw new Error(`context.when must be one of: ${[...VALID_WHEN].join(', ')}`);
  }
  if (!Array.isArray(action) || action.length === 0 || !action.every((a) => VALID_ACTIONS.has(a))) {
    throw new Error(`context.action must be a non-empty array from: ${[...VALID_ACTIONS].join(', ')}`);
  }
  if (!description || typeof description !== 'string') {
    throw new Error('context.description is required (plain-English desired behaviour)');
  }
}

function buildServerSource(functionName, scriptBody) {
  return [
    "import { gs, type GlideRecord } from '@servicenow/glide'",
    '',
    `export function ${functionName}(current: GlideRecord, previous: GlideRecord) {`,
    scriptBody,
    '}',
    '',
  ].join('\n');
}

function buildFluentSource({ id, name, table, when, action, filterCondition, functionName }) {
  const lines = [
    "import { BusinessRule } from '@servicenow/sdk/core'",
    `import { ${functionName} } from '../../server/generated/${id}'`,
    '',
    'BusinessRule({',
    `    $id: Now.ID['${id}'],`,
    `    name: '${escapeSingleQuotes(name)}',`,
    `    table: '${escapeSingleQuotes(table)}',`,
    `    when: '${when}',`,
    `    action: [${action.map((a) => `'${a}'`).join(', ')}],`,
    '    order: 100,',
    '    active: true,',
  ];
  if (filterCondition) {
    lines.push(`    filterCondition: '${escapeSingleQuotes(filterCondition)}',`);
  }
  lines.push(`    script: ${functionName},`, '})', '');
  return lines.join('\n');
}

/**
 * @param {object} context
 * @param {string} context.table - target table, e.g. 'incident'
 * @param {'before'|'after'|'async'|'display'} context.when
 * @param {Array<'insert'|'update'|'delete'|'query'>} context.action
 * @param {string} [context.filterCondition] - encoded query
 * @param {string} [context.name] - display name (derived from description if omitted)
 * @param {string} context.description - plain-English desired behaviour
 * @param {object} [opts]
 * @param {object} [opts.claudeClient] - override for testing (see claudeClient.js)
 * @returns {Promise<object>} generated artifact + validation + structured summary
 */
async function generateBusinessRule(context, opts = {}) {
  assertValidContext(context);
  const { table, when, action, filterCondition, description } = context;
  const name = context.name || description.slice(0, 80);
  const id = `br-${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;

  const { functionName, scriptBody, summary: scriptSummary } = await generateScriptBody(
    { description, table, when, action },
    { client: opts.claudeClient },
  );

  // functionName is untrusted LLM output injected verbatim as a JS
  // identifier (export name + import specifier) into generated source.
  assertSafeIdentifier(functionName, 'function name');

  const serverSource = buildServerSource(functionName, scriptBody);
  const fluentSource = buildFluentSource({ id, name, table, when, action, filterCondition, functionName });
  const fluentFilePath = path.join(FLUENT_DIR, `${id}.now.ts`);
  const serverFilePath = path.join(SERVER_DIR, `${id}.ts`);

  const validation = await withLock(async () => {
    // Single-slot scratch space: clear any previous candidate before writing
    // this one, so a stale invalid file from an earlier call (or a
    // concurrent one — including a different artifact type sharing this
    // same workspace) can never poison this build.
    clearGeneratedDir(FLUENT_DIR);
    clearGeneratedDir(SERVER_DIR);
    fs.writeFileSync(fluentFilePath, fluentSource, 'utf8');
    fs.writeFileSync(serverFilePath, serverSource, 'utf8');
    return validateFluentWorkspace();
  });

  return {
    id,
    fluentFilePath,
    serverFilePath,
    fluentSource,
    serverSource,
    validation,
    // Structured summary for NOW-12 (approval statement) — plain-English
    // trigger + condition + what it does, not raw code. Keep this shape
    // identical to generateClientScript.js's summary (NOW-11) — same field
    // names for both artifact types (a single human-readable `trigger`
    // string, not BR-specific when/action fields) — so downstream stories
    // don't need artifact-type-specific branching to read it.
    summary: {
      artifactType: 'Business Rule',
      name,
      table,
      trigger: `${when} ${action.join(', ')}`,
      filterCondition: filterCondition || null,
      whatItDoes: scriptSummary,
    },
  };
}

module.exports = { generateBusinessRule };
