'use strict';

/**
 * NOW-12: Approve / Revise / Reject state machine.
 *
 * Wraps a codegen function (generateBusinessRule or generateClientScript)
 * + generateApprovalStatement into a session that tracks one artifact
 * proposal through its lifecycle. This module is the enforcement point for
 * "nothing is applied on anything other than an explicit Approve" (per
 * DESIGNPRINCIPLES.md #2) — deploy (NOW-13) doesn't exist yet, but when it
 * does, it must only ever act on a session whose state is 'approved',
 * never left to the plugin/caller to remember to check.
 *
 * Sessions are plain immutable-ish objects, not a class — decide() returns
 * a new session object rather than mutating in place, consistent with the
 * rest of this codebase's function-based module style. The caller is
 * responsible for holding onto whichever session object is current (e.g.
 * keyed by session id in whatever calls this — the plugin-facing API,
 * NOW-14 — once it exists).
 */

const crypto = require('node:crypto');
const { generateApprovalStatement } = require('./generateApprovalStatement');

const TERMINAL_STATES = new Set(['approved', 'rejected']);

/**
 * @param {object} params
 * @param {Function} params.generate - generateBusinessRule or generateClientScript
 * @param {object} params.context - context object for `generate` (table, when/action or
 *   type/field, description, filterCondition, name)
 * @param {object} [params.opts] - passed through to `generate` and generateApprovalStatement
 *   (e.g. { claudeClient } for testing)
 * @returns {Promise<object>} a new session in state 'pending'
 */
async function startApprovalSession({ generate, context, opts = {} }) {
  if (typeof generate !== 'function') {
    throw new Error('generate must be generateBusinessRule or generateClientScript');
  }
  const artifact = await generate(context, opts);
  const { text: statement, narrative } = await generateApprovalStatement(context, artifact, opts);

  return {
    id: crypto.randomUUID(),
    state: 'pending',
    generate,
    context,
    opts,
    artifact,
    statement,
    narrative,
    // One entry per Revise, in order — the plain-English feedback given and
    // which artifact id it was feedback on. No cap for MVP (per the fixed
    // template's own note: "no cap set for MVP; revisit if it becomes a
    // problem in practice").
    history: [],
  };
}

/**
 * @param {object} session - a session from startApprovalSession() or a prior decide()
 * @param {'approve'|'revise'|'reject'} action
 * @param {object} [params]
 * @param {string} [params.feedback] - required for 'revise': the consultant's plain-English feedback
 * @returns {Promise<object>} the new session state
 */
async function decide(session, action, { feedback } = {}) {
  if (!session || typeof session.state !== 'string') {
    throw new Error('session must be the return value of startApprovalSession() or decide()');
  }
  if (TERMINAL_STATES.has(session.state)) {
    throw new Error(`Cannot decide on a session already in terminal state "${session.state}"`);
  }

  if (action === 'approve') {
    // Applying the change is NOW-13's job, not this module's — this only
    // marks the session as cleared to apply. No file is written, no
    // now-sdk command is run here.
    return { ...session, state: 'approved', readyToApply: true };
  }

  if (action === 'reject') {
    // Discard the artifact and statement outright — a rejected session
    // carries nothing forward that a caller could accidentally apply.
    return {
      id: session.id,
      state: 'rejected',
      readyToApply: false,
      context: session.context,
      history: session.history,
    };
  }

  if (action === 'revise') {
    if (!feedback || typeof feedback !== 'string') {
      throw new Error('feedback (a non-empty string) is required for a revise decision');
    }
    const revisedContext = {
      ...session.context,
      description: `${session.context.description}\n\nConsultant revision feedback: ${feedback}`,
    };
    const artifact = await session.generate(revisedContext, session.opts);
    const { text: statement, narrative } = await generateApprovalStatement(revisedContext, artifact, session.opts);

    return {
      ...session,
      state: 'pending',
      readyToApply: false,
      context: revisedContext,
      artifact,
      statement,
      narrative,
      history: [...session.history, { feedback, previousArtifactId: session.artifact.id }],
    };
  }

  throw new Error(`Unknown decision "${action}" — must be one of: approve, revise, reject`);
}

module.exports = { startApprovalSession, decide };
