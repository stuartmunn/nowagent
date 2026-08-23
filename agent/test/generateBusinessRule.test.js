'use strict';

/**
 * NOW-10 acceptance test: given a sample context input, the pipeline
 * produces a syntactically valid .now.ts Business Rule that passes
 * now-sdk's own validation, plus a structured summary.
 *
 * We stub the Claude client (no live ANTHROPIC_API_KEY needed to run this
 * suite) but the now-sdk validation step is real — it actually shells out
 * to `npm run build` in fluent-workspace, the same now-sdk build verified
 * hands-on for this story (see CODING_STANDARDS.md).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { generateBusinessRule } = require('../src/codegen/generateBusinessRule');
const { FLUENT_WORKSPACE_DIR } = require('../src/codegen/fluentValidate');

// A stub matching the Anthropic SDK client shape (`messages.create`), so
// this test never calls the real API.
const stubClaudeClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_business_rule_script',
            input: {
              functionName: 'blockEmptyCategory',
              scriptBody: "  if (!current.getValue('category')) {\n    current.setAbortAction(true);\n  }",
              summary: 'Blocks the record from saving if the category field is empty.',
            },
          },
        ],
      };
    },
  },
};

test('generateBusinessRule produces a valid .now.ts that passes now-sdk build', async (t) => {
  const context = {
    table: 'incident',
    when: 'before',
    action: ['insert', 'update'],
    filterCondition: 'category=',
    description: 'Prevent saving an incident if the category field is empty.',
  };

  const result = await generateBusinessRule(context, { claudeClient: stubClaudeClient });

  t.after(() => {
    // Generated files are runtime output, not fixtures — clean up after the test.
    fs.rmSync(result.fluentFilePath, { force: true });
    fs.rmSync(result.serverFilePath, { force: true });
  });

  assert.ok(fs.existsSync(result.fluentFilePath), '.now.ts file was written');
  assert.ok(fs.existsSync(result.serverFilePath), 'server script file was written');
  assert.match(result.fluentSource, /BusinessRule\(\{/);
  assert.match(result.fluentSource, /table: 'incident'/);
  assert.match(result.fluentSource, /when: 'before'/);

  assert.equal(result.validation.valid, true, `now-sdk build failed:\n${result.validation.output}`);

  assert.deepEqual(result.summary, {
    artifactType: 'Business Rule',
    name: context.description.slice(0, 80),
    table: 'incident',
    when: 'before',
    action: ['insert', 'update'],
    filterCondition: 'category=',
    whatItDoes: 'Blocks the record from saving if the category field is empty.',
  });
});

test('generateBusinessRule surfaces a real now-sdk build failure for invalid generated script', async (t) => {
  const badClient = {
    messages: {
      async create() {
        return {
          content: [
            {
              type: 'tool_use',
              name: 'emit_business_rule_script',
              input: {
                functionName: 'broken',
                // Deliberately invalid TypeScript: calling a GlideRecord
                // method that doesn't exist, to prove now-sdk build's type
                // checking is real and not a rubber stamp.
                scriptBody: "  current.thisMethodDoesNotExist('category');",
                summary: 'Deliberately broken for the NOW-10 test.',
              },
            },
          ],
        };
      },
    },
  };

  const context = {
    table: 'incident',
    when: 'before',
    action: ['insert'],
    description: 'Deliberately broken script to prove validation is real.',
  };

  const result = await generateBusinessRule(context, { claudeClient: badClient });
  t.after(() => {
    fs.rmSync(result.fluentFilePath, { force: true });
    fs.rmSync(result.serverFilePath, { force: true });
  });

  assert.equal(result.validation.valid, false, 'a bad script must fail now-sdk build, not pass silently');
  assert.match(result.validation.output, /thisMethodDoesNotExist/);
});

test('generateBusinessRule rejects an invalid context before calling Claude', async () => {
  await assert.rejects(
    () => generateBusinessRule({ table: 'incident', when: 'sometime', action: ['insert'], description: 'x' }),
    /context\.when must be one of/,
  );
});

test('sanity: fluent workspace directory resolves inside the agent package', () => {
  assert.match(FLUENT_WORKSPACE_DIR, /fluent-workspace$/);
});
