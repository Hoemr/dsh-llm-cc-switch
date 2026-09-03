// dsh-llm-cc-switch: minimal TOML subset parser.
//
// Used by grokbuild and codex config profiles. Intentionally narrow:
// supports `key = "string" | 'literal' | integer | boolean` and
// `[section]` / `[section.subsection]` tables, which is all CC Switch
// writes to a single TOML string for these harnesses. Anything more
// elaborate (multi-line strings, tables-of-arrays, inline tables)
// lives in the original `smol-toml` upstream; we don't need it here.

const LINE_SEP = /\r?\n/;
const KEY_VALUE = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/;
const TABLE_HEADER = /^\s*\[\s*([^\]]+?)\s*\]\s*$/;

/**
 * Parse a flat `key = value` line. Supports:
 *   - "quoted"  → contents (no escape decoding)
 *   - 'literal' → contents
 *   - 1234      → number (integer only; we don't need floats here)
 *   - true|false → boolean
 * Anything else returns undefined.
 */
export function tomlValue(line) {
  const match = KEY_VALUE.exec(line);
  if (!match) return undefined;
  const raw = match[2];
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) return raw.slice(1, -1);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  return undefined;
}

/**
 * Return the value of `key = ...` on the first matching line of `text`.
 * Useful for one-off lookups (`models.default`, `model_provider`, ...).
 * Accepts dotted keys; trailing dots inside a key are NOT supported —
 * callers should pass a complete key like `models.default`.
 */
export function tomlLookup(text, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`);
  for (const line of String(text ?? "").split(LINE_SEP)) {
    const match = re.exec(line);
    if (!match) continue;
    // Re-parse just this line through tomlValue to share its semantics.
    return tomlValue(line);
  }
  return undefined;
}

/**
 * Read one `[section]` table from `text` and return its key/value pairs.
 * Dotted headers (`[a.b]`) are matched literally; consumers wanting
 * the inner table should pass `"a.b"` here.
 */
export function tomlSection(text, header) {
  const out = {};
  let inside = false;
  for (const line of String(text ?? "").split(LINE_SEP)) {
    const headerMatch = TABLE_HEADER.exec(line);
    if (headerMatch) {
      inside = headerMatch[1].trim() === header;
      continue;
    }
    if (!inside) continue;
    const value = tomlValue(line);
    if (value === undefined) continue;
    const keyMatch = /^\s*([A-Za-z0-9_.]+)\s*=/.exec(line);
    if (keyMatch) out[keyMatch[1]] = value;
  }
  return out;
}

/**
 * Read every `[section]` header and its k/v body. Useful when only
 * `models.default` is named in-line and the rest of the data is in
 * tables keyed elsewhere.
 */
export function tomlSections(text) {
  const out = {};
  let current;
  for (const line of String(text ?? "").split(LINE_SEP)) {
    const headerMatch = TABLE_HEADER.exec(line);
    if (headerMatch) {
      current = headerMatch[1].trim();
      if (out[current] === undefined) out[current] = {};
      continue;
    }
    if (current === undefined) continue;
    const value = tomlValue(line);
    if (value === undefined) continue;
    const keyMatch = /^\s*([A-Za-z0-9_.]+)\s*=/.exec(line);
    if (keyMatch) out[current][keyMatch[1]] = value;
  }
  return out;
}
