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
 * Escapes a string for safe embedding inside a JS/TS template literal
 * (`...`). Use this — not escapeSingleQuotes — for any untrusted content
 * placed inside a backtick-delimited template, e.g. a Client Script's
 * `script\`...\`` body: an unescaped backtick or `${` would otherwise let
 * the content break out of the template and alter the surrounding
 * generated source.
 */
function escapeTemplateLiteral(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
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

module.exports = { slugify, escapeSingleQuotes, escapeTemplateLiteral, assertSafeIdentifier, SAFE_IDENTIFIER };
