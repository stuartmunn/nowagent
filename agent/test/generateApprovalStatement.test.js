'use strict';

/**
 * NOW-12 acceptance test: given a generated Business Rule or Client Script,
 * generateApprovalStatement produces the fixed-template plain-English
 * statement — artifact type named + justified, numbered logic, data
 * touched, a privilege/security flag, and the Approve/Revise/Reject footer.
 *
 * The codegen step (generateBusinessRule/generateClientScript) and the
 * narrative step (generateApprovalStatement) each stub their own Claude
 * client — no live ANTHROPIC_API_KEY needed to run this suite. now-sdk
 * build validation is still real (via generateBusinessRule/generateClientScript
 * themselves, same as their own NOW-10/11 suites).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { generateBusinessRule } = require('../src/codegen/generateBusinessRule');
const { generateClientScript } = require('../src/codegen/generateClientScript');
const { generateApprovalStatement } = require('../src/approval/generateApprovalStatement');

const codegenBrClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_business_rule_script',
            input: {
              functionName: 'autoCloseRelatedTasks',
              // NOTE: kept within what generateBusinessRule.js's server wrapper
              // actually supports today (`current`/`previous` are typed
              // GlideRecord, imported `type`-only — no value import for
              // constructing a *new* GlideRecord against another table).
              // A "look up related Task records" BR like the approval
              // template's own worked example isn't expressible yet; that's
              // a NOW-10 wrapper gap, flagged separately, not a NOW-12 concern.
              scriptBody: "  gs.addInfoMessage('Incident closed: ' + current.getValue('number'));",
              summary: 'Adds an info message confirming the incident was closed.',
            },
          },
        ],
      };
    },
  },
};

const narrativeBrClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_business_rule_approval_narrative',
            input: {
              logicSteps: [
                'Look up all Task records related to this Incident.',
                'For each related task still open, set its state to Closed.',
                'Update each task record.',
              ],
              dataTouched: 'reads Incident.state; reads and writes Task.state for all child tasks.',
              conditionEnglish: "Runs when the Incident's state changes to Closed.",
              privilegeFlag:
                'Updates Task records the current user may not have direct write access to — runs with elevated system privilege to do so.',
              typeJustification:
                'Needs to update related Task records server-side; a Client Script only affects the form in front of the user.',
            },
          },
        ],
      };
    },
  },
};

test('generateApprovalStatement renders the fixed Business Rule template', async (t) => {
  const context = {
    table: 'incident',
    when: 'after',
    action: ['update'],
    filterCondition: 'state=6',
    name: 'Auto-close related tasks',
    description: 'Close every related task when the incident is closed.',
  };

  const artifact = await generateBusinessRule(context, { claudeClient: codegenBrClient });
  t.after(() => {
    fs.rmSync(artifact.fluentFilePath, { force: true });
    fs.rmSync(artifact.serverFilePath, { force: true });
  });
  assert.equal(artifact.validation.valid, true, `now-sdk build failed:\n${artifact.validation.output}`);

  const { text } = await generateApprovalStatement(context, artifact, { claudeClient: narrativeBrClient });

  assert.match(text, /^Business Rule: "Auto-close related tasks" — Table: incident$/m);
  assert.match(text, /Runs after a record is updated on incident\. Order: 100 \(not verified against a live/);
  assert.match(text, /Condition: Runs when the Incident's state changes to Closed\./);
  assert.match(text, /Logic:\n1\. Look up all Task records related to this Incident\.\n2\. For each related task still open, set its state to Closed\.\n3\. Update each task record\./);
  assert.match(text, /Data touched: reads Incident\.state; reads and writes Task\.state for all child tasks\./);
  assert.match(text, /Privilege flag: Updates Task records the current user may not have direct write access to/);
  assert.match(text, /New or modifying: new Business Rule\./);
  assert.match(text, /Why Business Rule, not Client Script: Needs to update related Task records server-side/);
  assert.match(text, /Approve \/ Revise \/ Reject\?$/);
});

const codegenCsClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_client_script',
            input: {
              scriptBody:
                "  if (newValue === '1' && g_form.getValue('justification') === '') {\n" +
                "    g_form.showFieldMsg('justification', 'Please provide a justification.', 'info');\n" +
                '  }',
              summary: 'Warns the user when priority is set to Critical without a justification.',
            },
          },
        ],
      };
    },
  },
};

const narrativeCsClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_client_script_approval_narrative',
            input: {
              logicSteps: [
                'When Priority changes to "1 - Critical", check the Justification field.',
                'If Justification is empty, show an on-screen message asking the user to complete it.',
              ],
              dataTouched: 'reads Priority and Justification on the form only. No server-side records touched.',
              securityFlag:
                'This only nudges the user in the browser — it does not stop the record being saved via API or import with Justification still empty.',
              typeJustification:
                'This is a real-time prompt while the user is editing the form; a Business Rule can only intervene after save.',
            },
          },
        ],
      };
    },
  },
};

test('generateApprovalStatement renders the fixed Client Script template', async (t) => {
  const context = {
    table: 'incident',
    type: 'onChange',
    field: 'priority',
    name: 'Require justification for high priority',
    description: 'Warn when priority is set to Critical without a justification.',
  };

  const artifact = await generateClientScript(context, { claudeClient: codegenCsClient });
  t.after(() => fs.rmSync(artifact.fluentFilePath, { force: true }));
  assert.equal(artifact.validation.valid, true, `now-sdk build failed:\n${artifact.validation.output}`);

  const { text } = await generateApprovalStatement(context, artifact, { claudeClient: narrativeCsClient });

  assert.match(text, /^Client Script: "Require justification for high priority" — Table: incident$/m);
  assert.match(text, /^Type: onChange, field: priority$/m);
  assert.match(text, /^Condition: Desktop and Mobile UI, isolate scope: global\.$/m);
  assert.match(text, /Logic:\n1\. When Priority changes to "1 - Critical", check the Justification field\.\n2\. If Justification is empty/);
  assert.match(text, /Data touched: reads Priority and Justification on the form only\./);
  assert.match(text, /Security flag: This only nudges the user in the browser/);
  assert.match(text, /New or modifying: new Client Script\./);
  assert.match(text, /Why Client Script, not Business Rule: This is a real-time prompt/);
  assert.match(text, /Approve \/ Revise \/ Reject\?$/);
});

test('generateApprovalStatement rejects an artifact missing scriptBody', async () => {
  await assert.rejects(
    () => generateApprovalStatement({}, { summary: { artifactType: 'Business Rule' } }),
    /artifact must be the return value of/,
  );
});
