// dsh-llm-cc-switch: log / display redaction helpers.
//
// Logger output for a CC Switch account should never include the raw
// API key. Headers, URLs with embedded tokens, and bearer strings all
// pass through here before they hit ctx.logger or the model picker.

const PREFIX_VISIBLE = 4;
const SUFFIX_VISIBLE = 4;
const MIN_KEY_LENGTH = 16;
const REDACTED = "***redacted***";

/**
 * Render a key as `${first4}…${last4}` so it survives a log search
 * without leaking. Empty / short strings collapse to REDACTED.
 */
export function redactKey(key) {
  if (typeof key !== "string" || key.length < MIN_KEY_LENGTH) return REDACTED;
  return `${key.slice(0, PREFIX_VISIBLE)}…${key.slice(-SUFFIX_VISIBLE)}`;
}

/**
 * Replace the value of any `Authorization` / `api-key` / `x-api-key`
 * header in an object. Returns a shallow clone so the input is not
 * mutated.
 */
export function redactHeaders(headers) {
  if (headers === undefined) return undefined;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      const bearer = /^(Bearer)\s+(\S+)\s*$/i.exec(value);
      if (bearer) {
        out[name] = `Bearer ${REDACTED}`;
        continue;
      }
    }
    if (/^(authorization|x-api-key|api-key|proxy-authorization)$/i.test(name)) {
      out[name] = REDACTED;
    } else if (typeof value === "string" && /\bBearer\s+(\S+)/i.test(value)) {
      out[name] = value.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);
    } else {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Walk an object one level deep and redact string fields whose *name*
 * smells like a credential. Best-effort; the consumer is expected to
 * pass narrow slices, not the whole account.
 */
export function redactAccountShape(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactAccountShape);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/^(apiKey|api_key|token|secret|password|key)$/i.test(k) && typeof v === "string") {
      out[k] = redactKey(v);
    } else if (typeof v === "object" && v !== null) {
      out[k] = redactAccountShape(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
