'use strict';

const SAFE_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'artifact';
}

function escapeSingleQuotes(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Throws if `name` isn't a plain JS identifier. Use before injecting any
 * LLM-supplied string into generated source as an identifier (function
 * name, export name, import specifier) — it's untrusted model output.
 */
function assertSafeIdentifier(name, label = 'identifier') {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe ${label}: ${JSON.stringify(name)}`);
  }
}

module.exports = { slugify, escapeSingleQuotes, assertSafeIdentifier, SAFE_IDENTIFIER };
