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
 *
 * "Immutable-ish" was only true by convention until PR Agent pointed out
 * nothing actually stopped a caller from doing `session.state = 'approved'`
 * directly, bypassing decide() entirely — a real problem for a module whose
 * whole job is being a trustworthy governance gate. A first pass only
 * shallow-froze the top-level session object; PR Agent correctly escalated
 * that this still let `session.artifact.scriptBody` or a `narrative` field
 * be mutated post-approval without touching state/readyToApply at all —
 * silently changing what would actually get applied versus what a
 * consultant approved, which is the exact guarantee this module exists to
 * provide. Every session object is now deep-frozen (context/artifact/
 * narrative/history, recursively) — a mutation attempt anywhere in that
 * tree now throws (this file is 'use strict') instead of silently
 * succeeding. `generate` (a function) and `opts` (may hold a caller-owned
 * Claude client) are deliberately left out of the freeze — they're
 * operational plumbing this module doesn't own, not approved content.
 */

const crypto = require('node:crypto');
const { generateApprovalStatement } = require('./generateApprovalStatement');

const TERMINAL_STATES = new Set(['approved', 'rejected']);

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

function freezeSession(session) {
  deepFreeze(session.context);
  deepFreeze(session.artifact);
  deepFreeze(session.narrative);
  deepFreeze(session.history);
  return Object.freeze(session);
}

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

  return freezeSession({
    id: crypto.randomUUID(),
    state: 'pending',
    // Explicit false, not left undefined — decide() always sets this
    // field explicitly (true on approve, false on reject/revise), so a
    // freshly-started session must too. Any downstream consumer (NOW-13's
    // deploy gate) should only ever need `readyToApply === true` to decide
    // whether to apply, but this keeps the field's presence consistent
    // across every state rather than relying on that (PR Agent caught the
    // inconsistency).
    readyToApply: false,
    generate,
    // A deep clone, not the caller's own object — freezeSession deep-
    // freezes this field, and freezing an object we don't own out from
    // under the caller (who may want to reuse it elsewhere) would be a
    // surprising side effect of just calling startApprovalSession(). A
    // shallow `{ ...context }` isn't enough: nested fields like context's
    // `action` array would still be the *same* array the caller owns, so
    // deep-freezing session.context would freeze that shared reference too
    // (PR Agent caught this — the shallow-copy fix from the previous
    // commit was itself incomplete). context is plain structured data
    // (strings/arrays/null per generateBusinessRule.js/generateClientScript.js's
    // assertValidContext), so structuredClone is a correct, simple deep copy.
    context: structuredClone(context),
    opts,
    artifact,
    statement,
    narrative,
    // One entry per Revise, in order — the plain-English feedback given and
    // which artifact id it was feedback on. No cap for MVP (per the fixed
    // template's own note: "no cap set for MVP; revisit if it becomes a
    // problem in practice").
    history: [],
  });
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
    return freezeSession({ ...session, state: 'approved', readyToApply: true });
  }

  if (action === 'reject') {
    // Discard the artifact/statement/narrative *content* outright (per
    // NOW-12's acceptance criteria: "artifact and statement are discarded,
    // nothing queued for deploy") — but keep every field present, set to
    // null, rather than omitting the keys entirely. A rejected session
    // previously had a different shape from a pending/approved one (PR
    // Agent caught this) — code that inspects a session generically
    // without checking state first (future logging/debugging tooling, or
    // NOW-13) shouldn't have to special-case which keys exist per state.
    // generate/opts aren't "content" that was approved/rejected — they're
    // the plumbing that produced it — so they're kept as-is, not nulled.
    return freezeSession({
      id: session.id,
      state: 'rejected',
      readyToApply: false,
      generate: session.generate,
      context: session.context,
      opts: session.opts,
      artifact: null,
      statement: null,
      narrative: null,
      history: session.history,
    });
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

    return freezeSession({
      ...session,
      state: 'pending',
      readyToApply: false,
      context: revisedContext,
      artifact,
      statement,
      narrative,
      history: [...session.history, { feedback, previousArtifactId: session.artifact.id }],
    });
  }

  throw new Error(`Unknown decision "${action}" — must be one of: approve, revise, reject`);
}

module.exports = { startApprovalSession, decide };
