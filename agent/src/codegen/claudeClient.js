'use strict';

/**
 * Wraps the Anthropic Messages API ("Claude SDK") to turn a plain-English
 * description into a ServiceNow script body — Business Rule (server-side,
 * NOW-10) or Client Script (browser-side, NOW-11) — and, given an already-
 * generated artifact, to produce the plain-English governance narrative
 * the fixed approval-statement template needs (NOW-12).
 *
 * Secrets handling: the API key is supplied via a Docker Compose file-based
 * secret (see docker-compose.yml / CLAUDE.md), read from ANTHROPIC_API_KEY_FILE
 * at call time. Never read via an env var containing the raw key, never
 * logged, never included in any error message.
 */

const fs = require('node:fs');
const Anthropic = require('@anthropic-ai/sdk');

const API_KEY_FILE = process.env.ANTHROPIC_API_KEY_FILE || '/run/secrets/anthropic_api_key';
const MODEL = process.env.CLAUDE_CODEGEN_MODEL || 'claude-sonnet-5';

// A tool schema's `required` list is a hint to the model, not a runtime
// guarantee — the API can still return a response missing a field or with
// the wrong type. Used at every tool-call boundary in this file (codegen
// and approval-narrative alike) so a malformed response fails fast with a
// clear error here, rather than surfacing later as a cryptic error deep
// inside whatever consumes it (e.g. a bare `undefined` silently embedded
// into generated source, or a TypeError inside statement rendering).
function assertRequiredStringFields(input, fields, toolName) {
  if (!input || typeof input !== 'object') {
    throw new Error(`Claude returned a malformed ${toolName} tool call: no input object.`);
  }
  for (const field of fields) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new Error(`Claude returned a malformed ${toolName} tool call: ${field} must be a non-empty string.`);
    }
  }
}

function readApiKey() {
  try {
    return fs.readFileSync(API_KEY_FILE, 'utf8').trim();
  } catch {
    // Deliberately don't include the underlying fs error (could echo a path
    // with unexpected content); state only what's needed to fix it.
    throw new Error(
      `Anthropic API key not found at ${API_KEY_FILE}. Provision the Docker secret ` +
        '(see anthropic-api-key.example) — never pass the key via an environment variable.',
    );
  }
}

let cachedClient = null;
function getDefaultClient() {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: readApiKey() });
  }
  return cachedClient;
}

const EMIT_SCRIPT_TOOL = {
  name: 'emit_business_rule_script',
  description: 'Return the generated ServiceNow Business Rule script.',
  input_schema: {
    type: 'object',
    properties: {
      functionName: {
        type: 'string',
        description: 'A camelCase JS function name describing what the script does, e.g. "blockEmptyCategory".',
      },
      scriptBody: {
        type: 'string',
        description:
          'The statements that go inside the function body only — no function wrapper, no imports. ' +
          '`current` and `previous` (GlideRecord) are already in scope, as is `gs`.',
      },
      summary: {
        type: 'string',
        description: 'One-sentence plain-English summary of what the script does, for a non-technical approver.',
      },
    },
    required: ['functionName', 'scriptBody', 'summary'],
  },
};

function buildSystemPrompt() {
  return [
    'You write server-side script bodies for ServiceNow Fluent Business Rules.',
    "The function signature is always `(current: GlideRecord, previous: GlideRecord)` — you only supply the statements inside the body.",
    'Use the real @servicenow/glide GlideRecord API (e.g. current.getValue(), current.setValue(), gs.addInfoMessage()) — do not invent APIs.',
    'Keep the script minimal and directly reflect the requested behaviour. Do not add imports or the function wrapper.',
    'You must respond by calling the emit_business_rule_script tool — do not respond in plain text.',
  ].join(' ');
}

/**
 * @param {object} params
 * @param {string} params.description - plain-English desired behaviour
 * @param {string} params.table
 * @param {string} params.when
 * @param {string[]} params.action
 * @param {object} [opts]
 * @param {{messages: {create: Function}}} [opts.client] - override for
 *   testing without a live API key; must implement the same shape as the
 *   Anthropic SDK client's `messages.create`.
 * @returns {Promise<{functionName: string, scriptBody: string, summary: string}>}
 */
async function generateScriptBody({ description, table, when, action }, opts = {}) {
  const client = opts.client || getDefaultClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    tools: [EMIT_SCRIPT_TOOL],
    tool_choice: { type: 'tool', name: EMIT_SCRIPT_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          `Table: ${table}`,
          `Timing: ${when}`,
          `Action(s): ${action.join(', ')}`,
          `Desired behaviour: ${description}`,
        ].join('\n'),
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return the expected emit_business_rule_script tool call.');
  }
  // PR Agent flagged (NOW-12 review): this returned unvalidated while the
  // approval-narrative calls below already validated theirs — inconsistent,
  // and a real gap: assertSafeIdentifier (generateBusinessRule.js) doesn't
  // reliably catch an undefined functionName, since String(undefined) is
  // itself a syntactically valid identifier.
  assertRequiredStringFields(toolUse.input, ['functionName', 'scriptBody', 'summary'], EMIT_SCRIPT_TOOL.name);
  return toolUse.input;
}

const EMIT_CLIENT_SCRIPT_TOOL = {
  name: 'emit_client_script',
  description: 'Return the generated ServiceNow Client Script.',
  input_schema: {
    type: 'object',
    properties: {
      scriptBody: {
        type: 'string',
        description:
          'The statements that go inside the event handler function body only — no function wrapper. ' +
          '`g_form` is already in scope; for onChange, `control`, `oldValue`, `newValue`, `isLoading` are also in scope.',
      },
      summary: {
        type: 'string',
        description: 'One-sentence plain-English summary of what the script does, for a non-technical approver.',
      },
    },
    required: ['scriptBody', 'summary'],
  },
};

function buildClientScriptSystemPrompt(type) {
  const signature =
    {
      onLoad: 'onLoad()',
      onChange: 'onChange(control, oldValue, newValue, isLoading)',
      onSubmit: 'onSubmit()',
    }[type] || `${type}()`;

  return [
    'You write ServiceNow Client Script bodies — code that runs in the browser via the g_form API.',
    `The function signature is always \`function ${signature}\` — you only supply the statements inside the body.`,
    'Use the real g_form client API (e.g. g_form.getValue(), g_form.setValue(), g_form.addInfoMessage()) — do not invent APIs.',
    'Client scripts run in the browser: no imports, no Node/server APIs, no GlideRecord.',
    'For onSubmit, return false from the body to block the form submission when needed.',
    'Keep the script minimal and directly reflect the requested behaviour. Do not add the function wrapper.',
    'You must respond by calling the emit_client_script tool — do not respond in plain text.',
  ].join(' ');
}

/**
 * @param {object} params
 * @param {string} params.description - plain-English desired behaviour
 * @param {string} params.table
 * @param {'onLoad'|'onChange'|'onSubmit'} params.type
 * @param {string} [params.field] - required for 'onChange'
 * @param {object} [opts]
 * @param {{messages: {create: Function}}} [opts.client] - override for testing
 * @returns {Promise<{scriptBody: string, summary: string}>}
 */
async function generateClientScriptBody({ description, table, type, field }, opts = {}) {
  const client = opts.client || getDefaultClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildClientScriptSystemPrompt(type),
    tools: [EMIT_CLIENT_SCRIPT_TOOL],
    tool_choice: { type: 'tool', name: EMIT_CLIENT_SCRIPT_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          `Table: ${table}`,
          `Trigger: ${type}`,
          field ? `Field: ${field}` : null,
          `Desired behaviour: ${description}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return the expected emit_client_script tool call.');
  }
  assertRequiredStringFields(toolUse.input, ['scriptBody', 'summary'], EMIT_CLIENT_SCRIPT_TOOL.name);
  return toolUse.input;
}

// --- NOW-12: approval-statement narrative generation ---------------------
//
// Separate from the script-body generation above: these calls take an
// *already-generated* artifact (real scriptBody, real context) and ask
// Claude to produce the plain-English governance narrative fields the fixed
// approval-statement template needs (numbered logic steps, data touched,
// a privilege/security flag, and the artifact-type justification). Kept as
// its own tool call rather than folded into generateScriptBody/
// generateClientScriptBody so NOW-10/11's codegen prompts stay focused on
// producing correct code, not prose.
//
// Deliberately NOT asked of Claude: the order-conflict check and "new vs.
// modifying existing" — both require querying the live ServiceNow instance,
// which this MVP has no connection to (NOW-9 is blocked on NOW-3/5/7). The
// approval-statement renderer states this honestly rather than having
// Claude guess at something it cannot know (see generateApprovalStatement.js).
//
// Narrative responses have one extra shape requirement on top of
// assertRequiredStringFields (above): logicSteps must be a non-empty array
// of non-empty strings, since this narrative text becomes the actual
// governance document a human decides Approve/Revise/Reject against.
function assertNarrativeShape(input, stringFields, toolName) {
  assertRequiredStringFields(input, stringFields, toolName);
  if (!Array.isArray(input.logicSteps) || input.logicSteps.length === 0 || !input.logicSteps.every((s) => typeof s === 'string' && s.length > 0)) {
    throw new Error(`Claude returned a malformed ${toolName} tool call: logicSteps must be a non-empty array of non-empty strings.`);
  }
}

const EMIT_BR_APPROVAL_NARRATIVE_TOOL = {
  name: 'emit_business_rule_approval_narrative',
  description:
    'Return the plain-English governance narrative for a generated Business Rule, for a non-technical approver deciding Approve/Revise/Reject.',
  input_schema: {
    type: 'object',
    properties: {
      logicSteps: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Numbered plain-English steps describing what the script actually does, in execution order. ' +
          'Each array entry is one step (do not include the number or a leading dash).',
      },
      dataTouched: {
        type: 'string',
        description:
          'Plain-English sentence listing every table/field the script reads or writes, based on the actual ' +
          'script body given, especially anything beyond the triggering record (e.g. related tables).',
      },
      conditionEnglish: {
        type: 'string',
        description:
          "The trigger's filter condition (an encoded query) translated into plain English. If a field value " +
          "code can't be confidently translated to a label (e.g. a choice value like state=6), describe it " +
          "literally (\"state equals 6\") rather than guessing the label. If there is no filter condition, " +
          'return a sentence stating it runs on every matching trigger with no additional condition.',
      },
      privilegeFlag: {
        type: 'string',
        description:
          "Business Rules run server-side with elevated access. State plainly if this script touches a table/" +
          "record the requesting user couldn't normally reach directly, or bypasses something (aborts the " +
          'transaction, skips workflow, etc.). If there is no such concern, say so explicitly rather than ' +
          'leaving it blank — this line is a completed safety check either way.',
      },
      typeJustification: {
        type: 'string',
        description:
          'One sentence on why a Business Rule (not a Client Script) is the right artifact type for this ' +
          'requested behaviour.',
      },
    },
    required: ['logicSteps', 'dataTouched', 'conditionEnglish', 'privilegeFlag', 'typeJustification'],
  },
};

function buildBrNarrativeSystemPrompt() {
  return [
    'You write the plain-English governance narrative that accompanies a generated ServiceNow Business Rule,',
    'read by a non-technical approver before it is applied to any instance. Base every field on the actual',
    'script body you are given, not just the requested description — inspect it for the real tables/fields it',
    'touches. Be precise and conservative: if something is uncertain, say so rather than guessing.',
    'You must respond by calling the emit_business_rule_approval_narrative tool — do not respond in plain text.',
  ].join(' ');
}

/**
 * @param {object} params
 * @param {string} params.description - original plain-English desired behaviour
 * @param {string} params.table
 * @param {string} params.when
 * @param {string[]} params.action
 * @param {string|null} [params.filterCondition] - encoded query, if any
 * @param {string} params.scriptBody - the actual generated script body
 * @param {object} [opts]
 * @param {{messages: {create: Function}}} [opts.client] - override for testing
 * @returns {Promise<{logicSteps: string[], dataTouched: string, conditionEnglish: string, privilegeFlag: string, typeJustification: string}>}
 */
async function generateBusinessRuleApprovalNarrative(
  { description, table, when, action, filterCondition, scriptBody },
  opts = {},
) {
  const client = opts.client || getDefaultClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildBrNarrativeSystemPrompt(),
    tools: [EMIT_BR_APPROVAL_NARRATIVE_TOOL],
    tool_choice: { type: 'tool', name: EMIT_BR_APPROVAL_NARRATIVE_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          `Table: ${table}`,
          `Timing: ${when}`,
          `Action(s): ${action.join(', ')}`,
          `Filter condition (encoded query): ${filterCondition || '(none)'}`,
          `Originally requested behaviour: ${description}`,
          `Actual generated script body:\n${scriptBody}`,
        ].join('\n'),
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return the expected emit_business_rule_approval_narrative tool call.');
  }
  assertNarrativeShape(
    toolUse.input,
    ['dataTouched', 'conditionEnglish', 'privilegeFlag', 'typeJustification'],
    EMIT_BR_APPROVAL_NARRATIVE_TOOL.name,
  );
  return toolUse.input;
}

const EMIT_CS_APPROVAL_NARRATIVE_TOOL = {
  name: 'emit_client_script_approval_narrative',
  description:
    'Return the plain-English governance narrative for a generated Client Script, for a non-technical approver deciding Approve/Revise/Reject.',
  input_schema: {
    type: 'object',
    properties: {
      logicSteps: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Numbered plain-English steps describing what the script actually does, in execution order. ' +
          'Each array entry is one step (do not include the number or a leading dash).',
      },
      dataTouched: {
        type: 'string',
        description:
          'Plain-English sentence listing every form field the script reads or writes, based on the actual ' +
          'script body given. Client Scripts run in the browser only — explicitly note if no server-side ' +
          'records are touched (which is normally the case).',
      },
      securityFlag: {
        type: 'string',
        description:
          'Client Scripts are cosmetic/UX only — never a security control. If the logic looks like it is ' +
          'trying to enforce something (hide a field to "prevent" a value, block submit to "prevent" bad ' +
          'data), state plainly that this does not stop the same change via API or import, and that a ' +
          'server-side control (Business Rule/ACL) may also be needed. If the logic makes no such attempt, ' +
          'say so explicitly rather than leaving it blank — this line is a completed check either way.',
      },
      typeJustification: {
        type: 'string',
        description:
          'One sentence on why a Client Script (not a Business Rule) is the right artifact type for this ' +
          'requested behaviour.',
      },
    },
    required: ['logicSteps', 'dataTouched', 'securityFlag', 'typeJustification'],
  },
};

function buildCsNarrativeSystemPrompt() {
  return [
    'You write the plain-English governance narrative that accompanies a generated ServiceNow Client Script,',
    'read by a non-technical approver before it is applied to any instance. Base every field on the actual',
    'script body you are given, not just the requested description. Be precise and conservative: if something',
    'is uncertain, say so rather than guessing.',
    'You must respond by calling the emit_client_script_approval_narrative tool — do not respond in plain text.',
  ].join(' ');
}

/**
 * @param {object} params
 * @param {string} params.description - original plain-English desired behaviour
 * @param {string} params.table
 * @param {'onLoad'|'onChange'|'onSubmit'} params.type
 * @param {string} [params.field] - required for 'onChange'
 * @param {string} params.scriptBody - the actual generated script body
 * @param {object} [opts]
 * @param {{messages: {create: Function}}} [opts.client] - override for testing
 * @returns {Promise<{logicSteps: string[], dataTouched: string, securityFlag: string, typeJustification: string}>}
 */
async function generateClientScriptApprovalNarrative({ description, table, type, field, scriptBody }, opts = {}) {
  const client = opts.client || getDefaultClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildCsNarrativeSystemPrompt(),
    tools: [EMIT_CS_APPROVAL_NARRATIVE_TOOL],
    tool_choice: { type: 'tool', name: EMIT_CS_APPROVAL_NARRATIVE_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [
          `Table: ${table}`,
          `Trigger: ${type}`,
          field ? `Field: ${field}` : null,
          `Originally requested behaviour: ${description}`,
          `Actual generated script body:\n${scriptBody}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return the expected emit_client_script_approval_narrative tool call.');
  }
  assertNarrativeShape(toolUse.input, ['dataTouched', 'securityFlag', 'typeJustification'], EMIT_CS_APPROVAL_NARRATIVE_TOOL.name);
  return toolUse.input;
}

module.exports = {
  generateScriptBody,
  EMIT_SCRIPT_TOOL,
  generateClientScriptBody,
  EMIT_CLIENT_SCRIPT_TOOL,
  generateBusinessRuleApprovalNarrative,
  EMIT_BR_APPROVAL_NARRATIVE_TOOL,
  generateClientScriptApprovalNarrative,
  EMIT_CS_APPROVAL_NARRATIVE_TOOL,
};
