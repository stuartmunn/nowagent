'use strict';

/**
 * NOW-11 acceptance test: given a sample context input, the pipeline
 * produces a syntactically valid Client Script .now.ts that passes
 * now-sdk's own validation, with a summary shape matching
 * generateBusinessRule.js's (NOW-10) exactly — same field names, so
 * NOW-12 can consume either artifact type without branching.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { generateClientScript } = require('../src/codegen/generateClientScript');

const stubClaudeClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_client_script',
            input: {
              scriptBody: "  g_form.addInfoMessage('Table loaded successfully!!');",
              summary: 'Shows a message when the incident form loads.',
            },
          },
        ],
      };
    },
  },
};

test('generateClientScript produces a valid onLoad .now.ts that passes now-sdk build', async (t) => {
  const context = {
    table: 'incident',
    type: 'onLoad',
    description: 'Show a message when the incident form loads.',
  };

  const result = await generateClientScript(context, { claudeClient: stubClaudeClient });
  t.after(() => fs.rmSync(result.fluentFilePath, { force: true }));

  assert.ok(fs.existsSync(result.fluentFilePath), '.now.ts file was written');
  assert.match(result.fluentSource, /ClientScript\(\{/);
  assert.match(result.fluentSource, /type: 'onLoad'/);
  assert.match(result.fluentSource, /script: script`function onLoad\(\) \{/);

  assert.equal(result.validation.valid, true, `now-sdk build failed:\n${result.validation.output}`);

  assert.deepEqual(result.summary, {
    artifactType: 'Client Script',
    name: context.description,
    table: 'incident',
    trigger: 'onLoad',
    filterCondition: null,
    whatItDoes: 'Shows a message when the incident form loads.',
  });
});

test('generateClientScript produces a valid onChange .now.ts with the field property set', async (t) => {
  const onChangeClient = {
    messages: {
      async create() {
        return {
          content: [
            {
              type: 'tool_use',
              name: 'emit_client_script',
              input: {
                scriptBody: "  if (newValue === '1') { g_form.addInfoMessage('Critical priority selected'); }",
                summary: 'Warns the user when priority is set to Critical.',
              },
            },
          ],
        };
      },
    },
  };

  const result = await generateClientScript(
    { table: 'incident', type: 'onChange', field: 'priority', description: 'Warn on critical priority.' },
    { claudeClient: onChangeClient },
  );
  t.after(() => fs.rmSync(result.fluentFilePath, { force: true }));

  assert.match(result.fluentSource, /type: 'onChange'/);
  assert.match(result.fluentSource, /field: 'priority'/);
  assert.match(result.fluentSource, /function onChange\(control, oldValue, newValue, isLoading\) \{/);
  assert.equal(result.validation.valid, true, `now-sdk build failed:\n${result.validation.output}`);
  assert.equal(result.summary.trigger, 'onChange of priority');
});

test('generateClientScript rejects onChange without a field before calling Claude', async () => {
  await assert.rejects(
    () => generateClientScript({ table: 'incident', type: 'onChange', description: 'x' }),
    /context\.field is required when context\.type is "onChange"/,
  );
});

test('generateClientScript rejects an invalid type', async () => {
  await assert.rejects(
    () => generateClientScript({ table: 'incident', type: 'onHover', description: 'x' }),
    /context\.type must be one of/,
  );
});

// NOTE on what now-sdk build actually validates for Client Scripts: unlike
// Business Rules (a real imported .ts function, fully type-checked), a
// Client Script's body is embedded as a `script\`...\`` tagged template —
// verified hands-on that now-sdk build does NOT type-check or even
// syntax-check that string; literally invalid JavaScript inside it still
// built successfully. now-sdk build only validates the surrounding
// ClientScript({...}) call's structural fields (e.g. table, a valid `type`
// enum value, required props). So there's no way to make generateClientScript
// itself produce a script-body validation failure to test against — the
// cross-poisoning test below instead uses a genuinely-catchable Business
// Rule failure (its script IS type-checked) to prove the shared lock/
// workspace-clearing works in the other direction too.
test('a failed Business Rule generation does not poison a later successful Client Script generation (shared workspace lock)', async (t) => {
  const { generateBusinessRule } = require('../src/codegen/generateBusinessRule');

  const badBrClient = {
    messages: {
      async create() {
        return {
          content: [
            {
              type: 'tool_use',
              name: 'emit_business_rule_script',
              input: {
                functionName: 'broken',
                scriptBody: "  current.thisMethodDoesNotExist('x');",
                summary: 'broken',
              },
            },
          ],
        };
      },
    },
  };

  const failedBr = await generateBusinessRule(
    { table: 'incident', when: 'before', action: ['insert'], description: 'broken' },
    { claudeClient: badBrClient },
  );
  assert.equal(failedBr.validation.valid, false, 'sanity: the BR failure must be real before it can prove anything');

  const succeededCs = await generateClientScript(
    { table: 'incident', type: 'onLoad', description: 'Show a message when the form loads.' },
    { claudeClient: stubClaudeClient },
  );
  t.after(() => fs.rmSync(succeededCs.fluentFilePath, { force: true }));

  assert.equal(
    succeededCs.validation.valid,
    true,
    `cross-artifact-type generation should not be poisoned by a prior failure:\n${succeededCs.validation.output}`,
  );
});
