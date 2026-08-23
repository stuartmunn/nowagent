'use strict';

/**
 * NOW-11: Client Script generation (codegen only, no deploy).
 *
 * Same shape as generateBusinessRule.js (NOW-10) by design — the summary
 * object below matches its fields exactly so the approval-statement story
 * (NOW-12) doesn't need artifact-type-specific branching.
 *
 * IMPORTANT validation-coverage difference from Business Rules, verified
 * hands-on (not assumed): a Business Rule's script is a real imported .ts
 * function, so now-sdk build fully type-checks it. A Client Script's body
 * is embedded as a `script\`...\`` tagged template — now-sdk build does
 * NOT type-check or even syntax-check that string (confirmed by building
 * a ClientScript with deliberately-invalid JavaScript inside the template
 * and getting a clean build). now-sdk build only validates the surrounding
 * ClientScript({...}) call's structural fields (table, a valid `type`
 * enum value, required/known props, etc.) — not the script content itself.
 * So "passes now-sdk's own validation" for a Client Script means the
 * *structure* validated, not that the generated JS is necessarily correct.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { generateClientScriptBody } = require('./claudeClient');
const { validateFluentWorkspace } = require('./fluentValidate');
const { FLUENT_DIR, SERVER_DIR, withLock, clearGeneratedDir } = require('./fluentWorkspace');
const { slugify, escapeSingleQuotes } = require('./textUtils');

// Scoped to the three trigger types NOW-11 actually asks for. onCellEdit
// exists in Fluent but its handler signature wasn't verified for this
// story — add it deliberately later, don't guess it in now.
const VALID_TYPES = new Set(['onLoad', 'onChange', 'onSubmit']);

function assertValidContext(context) {
  if (!context || typeof context !== 'object') {
    throw new Error('context is required');
  }
  const { table, type, field, description } = context;
  if (!table || typeof table !== 'string') {
    throw new Error('context.table is required (e.g. "incident")');
  }
  if (!VALID_TYPES.has(type)) {
    throw new Error(`context.type must be one of: ${[...VALID_TYPES].join(', ')}`);
  }
  // now-sdk build does NOT catch a missing `field` on onChange (verified
  // hands-on — it type-checks fine either way), so we enforce it ourselves.
  if (type === 'onChange' && (!field || typeof field !== 'string')) {
    throw new Error('context.field is required when context.type is "onChange"');
  }
  if (!description || typeof description !== 'string') {
    throw new Error('context.description is required (plain-English desired behaviour)');
  }
}

// Real, standard ServiceNow client-script handler signatures (platform
// API, not Fluent-specific) — we control the wrapper, Claude only supplies
// the body, same pattern as generateBusinessRule.js's script function.
const HANDLER_SIGNATURE = {
  onLoad: 'onLoad()',
  onChange: 'onChange(control, oldValue, newValue, isLoading)',
  onSubmit: 'onSubmit()',
};

function buildFluentSource({ id, name, table, type, field, description, scriptBody }) {
  const signature = HANDLER_SIGNATURE[type];
  const lines = [
    "import { ClientScript } from '@servicenow/sdk/core'",
    '',
    'ClientScript({',
    `    $id: Now.ID['${id}'],`,
    `    name: '${escapeSingleQuotes(name)}',`,
    `    table: '${escapeSingleQuotes(table)}',`,
    '    active: true,',
    '    applies_extended: false,',
    '    global: true,',
    "    ui_type: 'all',",
    `    description: '${escapeSingleQuotes(description)}',`,
    "    messages: '',",
    '    isolate_script: false,',
    `    type: '${type}',`,
  ];
  if (type === 'onChange') {
    lines.push(`    field: '${escapeSingleQuotes(field)}',`);
  }
  lines.push(
    `    script: script\`function ${signature} {`,
    scriptBody,
    '    }`,',
    '})',
    '',
  );
  return lines.join('\n');
}

/**
 * @param {object} context
 * @param {string} context.table - target table, e.g. 'incident'
 * @param {'onLoad'|'onChange'|'onSubmit'} context.type
 * @param {string} [context.field] - required when type is 'onChange'
 * @param {string} [context.name] - display name (derived from description if omitted)
 * @param {string} context.description - plain-English desired behaviour
 * @param {object} [opts]
 * @param {object} [opts.claudeClient] - override for testing (see claudeClient.js)
 * @returns {Promise<object>} generated artifact + validation + structured summary
 */
async function generateClientScript(context, opts = {}) {
  assertValidContext(context);
  const { table, type, field, description } = context;
  const name = context.name || description.slice(0, 80);
  const id = `cs-${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;

  const { scriptBody, summary: scriptSummary } = await generateClientScriptBody(
    { description, table, type, field },
    { client: opts.claudeClient },
  );

  // Client scripts embed the whole handler inline (no separate server
  // file/import to sanity-check an identifier for) — nothing untrusted is
  // injected as a bare identifier here, only as a quoted string literal
  // (already escaped by escapeSingleQuotes).
  const fluentSource = buildFluentSource({ id, name, table, type, field, description, scriptBody });
  const fluentFilePath = path.join(FLUENT_DIR, `${id}.now.ts`);

  const validation = await withLock(async () => {
    // Same single-slot scratch space as generateBusinessRule.js — this
    // lock is shared across artifact types on purpose (see fluentWorkspace.js).
    // Client scripts have no server file, but we still clear SERVER_DIR: a
    // leftover Business Rule server file could otherwise poison this build.
    clearGeneratedDir(FLUENT_DIR);
    clearGeneratedDir(SERVER_DIR);
    fs.writeFileSync(fluentFilePath, fluentSource, 'utf8');
    return validateFluentWorkspace();
  });

  return {
    id,
    fluentFilePath,
    fluentSource,
    validation,
    // Same shape as generateBusinessRule.js's summary (NOW-10) — see that
    // file's comment. filterCondition doesn't apply to Client Scripts (null).
    summary: {
      artifactType: 'Client Script',
      name,
      table,
      trigger: field ? `${type} of ${field}` : type,
      filterCondition: null,
      whatItDoes: scriptSummary,
    },
  };
}

module.exports = { generateClientScript };
