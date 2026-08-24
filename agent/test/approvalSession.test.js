'use strict';

/**
 * NOW-12 acceptance test: the Approve / Revise / Reject state machine.
 *
 * Uses a fake `generate` function (not the real generateBusinessRule/
 * generateClientScript) so these tests exercise session-transition logic
 * in isolation, fast, without shelling out to now-sdk build each time —
 * that pipeline is already covered by generateApprovalStatement.test.js
 * and the NOW-10/11 suites. A stub Claude client stands in for the
 * narrative-generation call either way.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startApprovalSession, decide } = require('../src/approval/approvalSession');

// Fake codegen function matching generateBusinessRule/generateClientScript's
// shape closely enough for generateApprovalStatement to consume, whose
// scriptBody visibly reflects the description it was given — lets tests
// assert that a Revise actually regenerated from the new description
// rather than replaying the old artifact.
let fakeGenerateCallCount = 0;
async function fakeGenerate(context) {
  fakeGenerateCallCount += 1;
  return {
    id: `fake-${fakeGenerateCallCount}`,
    fluentSource: '// fake',
    scriptBody: `GENERATED FOR: ${context.description}`,
    validation: { valid: true, output: '' },
    summary: {
      artifactType: 'Business Rule',
      name: context.name || 'Test Business Rule',
      table: context.table,
      trigger: `${context.when} ${context.action.join(', ')}`,
      filterCondition: context.filterCondition || null,
      whatItDoes: 'A fake artifact for approvalSession tests.',
      order: 100,
    },
  };
}

const stubNarrativeClient = {
  messages: {
    async create() {
      return {
        content: [
          {
            type: 'tool_use',
            name: 'emit_business_rule_approval_narrative',
            input: {
              logicSteps: ['Step one.'],
              dataTouched: 'reads and writes nothing real — this is a test stub.',
              conditionEnglish: 'Runs on every matching trigger.',
              privilegeFlag: 'No elevated-access concern identified.',
              typeJustification: 'Business Rule chosen arbitrarily for this test.',
            },
          },
        ],
      };
    },
  },
};

function baseContext(overrides = {}) {
  return {
    table: 'incident',
    when: 'after',
    action: ['update'],
    description: 'Do the test thing.',
    ...overrides,
  };
}

test('startApprovalSession produces a pending session with an artifact and statement', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });

  assert.equal(session.state, 'pending');
  assert.ok(session.id);
  assert.match(session.artifact.scriptBody, /^GENERATED FOR: Do the test thing\.$/);
  assert.match(session.statement, /Approve \/ Revise \/ Reject\?$/);
  assert.deepEqual(session.history, []);
});

test('approve marks the session approved and ready to apply, without touching the artifact', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });

  const approved = await decide(session, 'approve');

  assert.equal(approved.state, 'approved');
  assert.equal(approved.readyToApply, true);
  assert.equal(approved.artifact, session.artifact, 'approve must not regenerate the artifact');
});

test('reject discards the artifact and statement, leaving nothing to apply', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });

  const rejected = await decide(session, 'reject');

  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.readyToApply, false);
  assert.equal(rejected.artifact, undefined, 'a rejected session must not carry the artifact forward');
  assert.equal(rejected.statement, undefined, 'a rejected session must not carry the statement forward');
});

test('revise regenerates from the consultant feedback and stays pending', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });
  const originalArtifactId = session.artifact.id;

  const revised = await decide(session, 'revise', { feedback: 'Use a different table instead.' });

  assert.equal(revised.state, 'pending');
  assert.equal(revised.readyToApply, false);
  assert.notEqual(revised.artifact.id, originalArtifactId, 'revise must actually regenerate, not re-show the old artifact');
  assert.match(revised.artifact.scriptBody, /Use a different table instead\./, 'feedback must reach the regeneration call');
  assert.equal(revised.history.length, 1);
  assert.equal(revised.history[0].feedback, 'Use a different table instead.');
  assert.equal(revised.history[0].previousArtifactId, originalArtifactId);
});

test('revise can loop more than once, accumulating history', async () => {
  let session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });

  session = await decide(session, 'revise', { feedback: 'First round of feedback.' });
  session = await decide(session, 'revise', { feedback: 'Second round of feedback.' });

  assert.equal(session.state, 'pending');
  assert.equal(session.history.length, 2);
  assert.equal(session.history[0].feedback, 'First round of feedback.');
  assert.equal(session.history[1].feedback, 'Second round of feedback.');
  assert.match(session.artifact.scriptBody, /Second round of feedback\./);
});

test('revise without feedback is rejected before any regeneration', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });

  await assert.rejects(() => decide(session, 'revise'), /feedback \(a non-empty string\) is required/);
});

test('an unknown decision is rejected', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });

  await assert.rejects(() => decide(session, 'maybe'), /Unknown decision "maybe"/);
});

test('deciding on an approved (terminal) session is rejected — approve cannot be re-applied', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });
  const approved = await decide(session, 'approve');

  await assert.rejects(() => decide(approved, 'approve'), /already in terminal state "approved"/);
  await assert.rejects(() => decide(approved, 'revise', { feedback: 'x' }), /already in terminal state "approved"/);
});

test('deciding on a rejected (terminal) session is rejected', async () => {
  const session = await startApprovalSession({
    generate: fakeGenerate,
    context: baseContext(),
    opts: { claudeClient: stubNarrativeClient },
  });
  const rejected = await decide(session, 'reject');

  await assert.rejects(() => decide(rejected, 'approve'), /already in terminal state "rejected"/);
});
