/**
 * Debug logging with sensitive data masked.
 * Set LOG_LEVEL=debug (or DEBUG=1) to enable debug logs.
 * Sensitive keys are always redacted when logging objects.
 */

const MASK = '***';
const LOG_LEVEL = (process.env.LOG_LEVEL || '').toLowerCase();
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true' || LOG_LEVEL === 'debug';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmNewPassword',
  'confirm_password',
  'confirmNewPassword',
  'token',
  'accessToken',
  'verificationToken',
  'emailVerificationToken',
  'Verification_token',
  'reset_token',
  'verification_token',
  'cardNumber',
  'cvv',
  'otp_code',
  'code',
  'password_hash',
  'authorization',
  'cookie',
]);

const PARTIAL_MASK_KEYS = new Set([
  'email',
  'phone_number',
  'phonenumber',
]);

function maskValue(key, value) {
  if (value == null || value === '') return value;
  const k = String(key).toLowerCase();
  const kNorm = k.replace(/_/g, '');
  if (SENSITIVE_KEYS.has(k) || SENSITIVE_KEYS.has(kNorm)) return MASK;
  if (PARTIAL_MASK_KEYS.has(k) || PARTIAL_MASK_KEYS.has(kNorm)) {
    const s = String(value);
    if (s.length <= 4) return MASK;
    return s.slice(0, 2) + '***' + s.slice(-2);
  }
  return value;
}

/**
 * Returns a shallow copy of obj with sensitive keys replaced by MASK (or partial mask for email/phone).
 */
function maskObject(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => (typeof item === 'object' && item !== null ? maskObject(item) : item));
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    const lowerNorm = lower.replace(/_/g, '');
    const isSensitive = SENSITIVE_KEYS.has(lower) || SENSITIVE_KEYS.has(lowerNorm);
    const isPartial = PARTIAL_MASK_KEYS.has(lower) || PARTIAL_MASK_KEYS.has(lowerNorm);
    if (isSensitive || isPartial) {
      out[key] = maskValue(key, value);
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      out[key] = maskObject(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function maskHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = { ...headers };
  if (out.authorization) out.authorization = 'Bearer ***';
  if (out.cookie) out.cookie = '***';
  return out;
}

function formatMeta(meta) {
  if (meta == null) return '';
  if (typeof meta === 'object') return ' ' + JSON.stringify(maskObject(meta));
  return ' ' + String(meta);
}

function debug(msg, meta) {
  if (!DEBUG) return;
  const prefix = '[debug]';
  process.stdout.write(prefix + ' ' + msg + formatMeta(meta) + '\n');
}

function info(msg, meta) {
  const prefix = '[info]';
  process.stdout.write(prefix + ' ' + msg + formatMeta(meta) + '\n');
}

function warn(msg, meta) {
  const prefix = '[warn]';
  process.stderr.write(prefix + ' ' + msg + formatMeta(meta) + '\n');
}

function error(msg, meta) {
  const prefix = '[error]';
  const payload = meta instanceof Error ? (meta.stack || meta.message) : formatMeta(meta);
  process.stderr.write(prefix + ' ' + msg + (payload ? ' ' + payload : '') + '\n');
}

module.exports = {
  maskObject,
  maskHeaders,
  maskValue,
  isDebug: () => DEBUG,
  debug,
  info,
  warn,
  error,
};
