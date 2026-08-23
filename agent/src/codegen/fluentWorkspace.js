'use strict';

/**
 * Shared Fluent workspace scratch-space + lock, used by every codegen
 * artifact type (Business Rule, Client Script, ...).
 *
 * now-sdk build type-checks the *entire* Fluent workspace, not just the
 * artifact just written — so every generator treats FLUENT_DIR/SERVER_DIR
 * as single-slot scratch space (cleared before every generation) and
 * serializes on this ONE shared lock. This must stay shared across artifact
 * types, not per-type: a Business Rule generation and a Client Script
 * generation both write into and validate the same workspace, so two
 * separate locks would defeat the point (see NOW-10's PR Agent review,
 * where a per-call-unaware design let concurrent/leftover files
 * cross-contaminate unrelated builds).
 */

const fs = require('node:fs');
const path = require('node:path');
const { FLUENT_WORKSPACE_DIR } = require('./fluentValidate');

const FLUENT_DIR = path.join(FLUENT_WORKSPACE_DIR, 'src', 'fluent', 'generated');
const SERVER_DIR = path.join(FLUENT_WORKSPACE_DIR, 'src', 'server', 'generated');

// This lock only serializes calls within one Node process — correct for
// the current deployment (one `node src/server.js` process per container,
// see docker-compose.yml). It would NOT protect against a multi-process
// deployment (e.g. Node cluster mode) sharing this same fluent-workspace
// directory; that would need a cross-process lock (e.g. a lockfile). Not
// needed for NOW-10/11's scope, but don't assume this covers that case if
// the deployment model ever changes. (Discovered via this project's own
// test suite: `node --test` runs multiple test *files* as separate
// processes by default, which is why `npm test` pins
// --test-concurrency=1 — otherwise two files' generation calls raced on
// this same on-disk directory despite the in-process lock.)
let lock = Promise.resolve();
function withLock(fn) {
  const result = lock.then(fn, fn);
  lock = result.catch(() => {});
  return result;
}

function clearGeneratedDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = { FLUENT_DIR, SERVER_DIR, withLock, clearGeneratedDir };
