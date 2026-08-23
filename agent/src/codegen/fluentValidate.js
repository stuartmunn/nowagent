'use strict';

/**
 * Validates the Fluent workspace by running its own `now-sdk build` — the
 * real now-sdk validation/compile step, not a hand-rolled syntax check.
 *
 * Verified hands-on (SDK v4.11.0, Aug 2026): `now-sdk build` type-checks
 * every .now.ts file against Fluent's actual type definitions and reports
 * real diagnostics on invalid input. It runs entirely offline — no
 * ServiceNow instance or credentials required. See CODING_STANDARDS.md /
 * NOW-10 for how this was confirmed (not assumed).
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const FLUENT_WORKSPACE_DIR =
  process.env.FLUENT_WORKSPACE_DIR || path.join(__dirname, '..', '..', 'fluent-workspace');

/**
 * @returns {Promise<{valid: boolean, exitCode: number|null, output: string}>}
 */
function validateFluentWorkspace() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], { cwd: FLUENT_WORKSPACE_DIR });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('close', (exitCode) => {
      resolve({ valid: exitCode === 0, exitCode, output });
    });

    child.on('error', (err) => {
      resolve({ valid: false, exitCode: null, output: `Failed to run now-sdk build: ${err.message}` });
    });
  });
}

module.exports = { validateFluentWorkspace, FLUENT_WORKSPACE_DIR };
