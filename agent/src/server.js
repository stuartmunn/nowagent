'use strict';

/**
 * Agent container shell (NOW-8).
 *
 * No business logic here yet — this proves the container plumbing:
 * it starts, binds to the host network on a high port, and exposes a
 * health-check endpoint. now-sdk auth, codegen, and the plugin-facing
 * API land in later stories (NOW-9 onward).
 *
 * Secrets handling: the now-sdk credential is supplied via a Docker
 * Compose file-based secret, mounted read-only at the path named by
 * NOW_SDK_CREDENTIAL_FILE (see docker-compose.yml). At this stage we
 * only check the file *exists* — we never read or log its contents.
 * Never log the credential value, the file's contents, or the path's
 * contents in any error message.
 */

const http = require('node:http');
const fs = require('node:fs');

const HOST = '0.0.0.0'; // bind to the container's network interface, not loopback-only
// Default to 8791 (high port, per DESIGNPRINCIPLES.md #11) only when PORT is
// unset or not a valid number — `|| 8791` would also override an explicit,
// intentional `PORT=0` (let the OS pick a port), which we don't want.
const PARSED_PORT = Number(process.env.PORT);
const PORT = process.env.PORT !== undefined && !Number.isNaN(PARSED_PORT) ? PARSED_PORT : 8791;
const CREDENTIAL_FILE = process.env.NOW_SDK_CREDENTIAL_FILE || '/run/secrets/now_sdk_credential';

function credentialFilePresent() {
  try {
    return fs.existsSync(CREDENTIAL_FILE);
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    const body = JSON.stringify({
      status: 'ok',
      credentialFilePresent: credentialFilePresent(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.on('error', (err) => {
  console.error(`nowagent agent failed to start: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  // Never log CREDENTIAL_FILE's contents — only whether it's present.
  console.log(`nowagent agent listening on http://${HOST}:${PORT}`);
  console.log(`credential file present: ${credentialFilePresent()}`);
});
