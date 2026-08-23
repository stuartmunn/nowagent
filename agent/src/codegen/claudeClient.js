'use strict';

/**
 * Wraps the Anthropic Messages API ("Claude SDK") to turn a plain-English
 * description into a ServiceNow script body — Business Rule (server-side,
 * NOW-10) or Client Script (browser-side, NOW-11).
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
  return toolUse.input;
}

module.exports = {
  generateScriptBody,
  EMIT_SCRIPT_TOOL,
  generateClientScriptBody,
  EMIT_CLIENT_SCRIPT_TOOL,
};
