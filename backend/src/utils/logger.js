// Minimal structured logger. Writes one JSON line per event to stdout/stderr.
// Sensitive keys are redacted so passwords, tokens and biometric vectors can
// never end up in log files even if a caller passes them by mistake.
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.LOG_LEVEL] ?? LEVELS.info;
const REDACT = /pass(word)?|token|secret|cookie|authorization|descriptor|embedding|^samples$|^enc$|biometric|apikey/i;

function sanitize(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: value.stack };
  }
  if (ArrayBuffer.isView(value)) return `[binary ${value.length}]`;
  if (Array.isArray(value)) return value.length > 20 ? `[array ${value.length}]` : value.map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? '[redacted]' : sanitize(v, depth + 1);
    return out;
  }
  return value;
}

function write(level, msg, meta) {
  if (LEVELS[level] < threshold || config.NODE_ENV === 'test') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...sanitize(meta || {}) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  sanitize,
};
