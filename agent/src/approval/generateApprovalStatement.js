'use strict';

/**
 * NOW-12: Approval statement generation.
 *
 * Turns a generated artifact (the return value of generateBusinessRule.js /
 * generateClientScript.js) into the fixed plain-English approval statement
 * that must be presented before anything is applied to an instance, even
 * dev — per DESIGNPRINCIPLES.md #2, this is the actual governance control,
 * not a nicety. Template supplied by Stuart 2026-08-24 (mirrored at
 * docs/approval-statement-template.md).
 *
 * Two fields in the template are deliberately NOT generated here as claims
 * of fact, because this MVP has no live ServiceNow instance connection
 * (NOW-9 is blocked on NOW-3/5/7 — see README.md):
 *   - the "another active BR already exists at this order" conflict check
 *   - "new vs. modifying existing" (there is no query-existing-artifact
 *     path anywhere in this codebase yet — every artifact this pipeline
 *     produces is, by construction, new)
 * Both are rendered as explicit, honest statements rather than a fabricated
 * "no conflicts found" — a governance document that silently guesses is
 * worse than one that says what wasn't checked.
 */

const {
  generateBusinessRuleApprovalNarrative,
  generateClientScriptApprovalNarrative,
} = require('../codegen/claudeClient');

const ACTION_VERB = {
  insert: 'a record is inserted',
  update: 'a record is updated',
  delete: 'a record is deleted',
  query: 'a record is queried',
};

const WHEN_ADVERB = {
  before: 'before',
  after: 'after',
  async: 'asynchronously, after',
  display: 'when the form is about to display, before',
};

function describeBrTrigger({ when, action, table }) {
  const actionPhrase = action.map((a) => ACTION_VERB[a] || a).join(' or ');
  const adverb = WHEN_ADVERB[when] || when;
  return `Runs ${adverb} ${actionPhrase} on ${table}.`;
}

function describeCsCondition({ uiType, isolateScript }) {
  const uiText = uiType === 'all' ? 'Desktop and Mobile UI' : uiType;
  const scopeText = isolateScript ? 'isolated' : 'global';
  return `Condition: ${uiText}, isolate scope: ${scopeText}.`;
}

function renderLogicList(logicSteps) {
  return ['Logic:', ...logicSteps.map((step, i) => `${i + 1}. ${step}`)].join('\n');
}

function renderBusinessRuleStatement(context, artifact, narrative) {
  const { summary } = artifact;
  const lines = [
    `Business Rule: "${summary.name}" — Table: ${summary.table}`,
    `${describeBrTrigger(context)} Order: ${summary.order} (not verified against a live ` +
      `ServiceNow instance — no instance connection is available in this MVP; see NOW-9).`,
    `Condition: ${narrative.conditionEnglish}`,
    renderLogicList(narrative.logicSteps),
    '',
    `Data touched: ${narrative.dataTouched}`,
    `Privilege flag: ${narrative.privilegeFlag}`,
    'New or modifying: new Business Rule.',
    `Why Business Rule, not Client Script: ${narrative.typeJustification}`,
    'Approve / Revise / Reject?',
  ];
  return lines.join('\n');
}

function renderClientScriptStatement(context, artifact, narrative) {
  const { summary } = artifact;
  const typeLine = context.type === 'onChange' ? `Type: onChange, field: ${context.field}` : `Type: ${context.type}`;
  const lines = [
    `Client Script: "${summary.name}" — Table: ${summary.table}`,
    typeLine,
    describeCsCondition(summary),
    renderLogicList(narrative.logicSteps),
    '',
    `Data touched: ${narrative.dataTouched}`,
    `Security flag: ${narrative.securityFlag}`,
    'New or modifying: new Client Script.',
    `Why Client Script, not Business Rule: ${narrative.typeJustification}`,
    'Approve / Revise / Reject?',
  ];
  return lines.join('\n');
}

/**
 * @param {object} context - the same context object passed to generateBusinessRule()
 *   or generateClientScript() to produce `artifact` (table, when/action or type/field,
 *   description, filterCondition). Taken explicitly rather than re-parsed back out of
 *   artifact.summary.trigger, which is a display string, not a machine-readable one.
 * @param {object} artifact - return value of generateBusinessRule() or generateClientScript()
 * @param {object} [opts]
 * @param {object} [opts.claudeClient] - override for testing (see claudeClient.js)
 * @returns {Promise<{text: string, narrative: object}>}
 */
async function generateApprovalStatement(context, artifact, opts = {}) {
  if (!artifact || !artifact.summary || typeof artifact.scriptBody !== 'string') {
    throw new Error('artifact must be the return value of generateBusinessRule() or generateClientScript()');
  }

  const { summary } = artifact;
  if (summary.artifactType === 'Business Rule') {
    const narrative = await generateBusinessRuleApprovalNarrative(
      {
        description: context.description,
        table: context.table,
        when: context.when,
        action: context.action,
        filterCondition: context.filterCondition,
        scriptBody: artifact.scriptBody,
      },
      { client: opts.claudeClient },
    );
    return { text: renderBusinessRuleStatement(context, artifact, narrative), narrative };
  }

  if (summary.artifactType === 'Client Script') {
    const narrative = await generateClientScriptApprovalNarrative(
      {
        description: context.description,
        table: context.table,
        type: context.type,
        field: context.field,
        scriptBody: artifact.scriptBody,
      },
      { client: opts.claudeClient },
    );
    return { text: renderClientScriptStatement(context, artifact, narrative), narrative };
  }

  throw new Error(`Unknown artifactType: ${summary.artifactType}`);
}

module.exports = { generateApprovalStatement };
