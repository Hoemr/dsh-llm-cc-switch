// dsh-llm-cc-switch: parser for claude / claude-desktop accounts.
//
// CC Switch stores each row's provider config under `settings_config` as
// JSON with the shape:
//
//   { "env": { "ANTHROPIC_AUTH_TOKEN": "...",
//              "ANTHROPIC_BASE_URL":   "https://...",
//              "ANTHROPIC_DEFAULT_*_MODEL": "model-id",
//              "ANTHROPIC_DEFAULT_*_MODEL_NAME": "Display Name" } }
//
// Multiple `_NAME` pairs alias the raw model id with a UI label. We
// surface those so the picker has something readable.

import { MAX_MODELS_PER_ACCOUNT } from "./index.js";

/** Claude Code model-aliasing suffix (`model[1M]`) is a UI hint, not the wire id. */
function stripModelSuffix(raw) {
  return String(raw).replace(/\[[^\]]*\]\s*$/, "").trim();
}

/** A trailing `[1M]` / `[200k]` / `[1000000]` alias, read as a token window. */
const CONTEXT_SUFFIX = /\[\s*(\d+(?:\.\d+)?)\s*([km]?)\s*\]\s*$/i;

/**
 * Read the context window a CC Switch row advertises through its model id.
 *
 * CC Switch marks the long-context variant of a model in the id itself
 * (`deepseek-v4.1-flash[1M]`), the same alias Claude Code renders as a badge.
 * The suffix never reaches the wire, so the only place the advertised window
 * exists is here — dropping it left every such model on the profile-wide
 * fallback (`contextWindow: 200000`, shown as "[195k]") and made the picker
 * understate a 1M model eightfold.
 *
 * Units are decimal: `k` = 1_000, `m` = 1_000_000, no unit = a bare token
 * count. A window the suffix does not name (`[preview]`, `[thinking]`) leaves
 * the model on the profile fallback rather than guessing.
 * @param raw - Model id as stored, suffix included.
 * @returns Token window, or undefined when the suffix names none.
 */
function contextWindowFromSuffix(raw) {
  const match = CONTEXT_SUFFIX.exec(String(raw));
  if (match === null) return undefined;
  const value = Number(match[1]) * (match[2].toLowerCase() === "m" ? 1_000_000 : match[2].toLowerCase() === "k" ? 1_000 : 1);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parseClaude(cfg) {
  const env = (cfg && cfg.env) || {};
  const apiKey = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;
  const baseURL = typeof env.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL.length > 0
    ? env.ANTHROPIC_BASE_URL
    : "https://api.anthropic.com";

  // Display-name map keyed by raw wire model id.
  const names = new Map();
  for (const key of [
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
  ]) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const base = env[key.replace("_NAME", "")];
    if (typeof base !== "string") continue;
    names.set(stripModelSuffix(base), value);
  }

  const seen = new Set();
  const models = [];
  for (const key of [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
  ]) {
    const raw = env[key];
    if (typeof raw !== "string" || raw.length === 0) continue;
    const id = stripModelSuffix(raw);
    if (id.length === 0 || seen.has(id)) continue;
    const contextWindow = contextWindowFromSuffix(raw);
    seen.add(id);
    models.push({
      id,
      name: names.get(id) ?? id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
    });
    if (models.length >= MAX_MODELS_PER_ACCOUNT) break;
  }
  if (models.length === 0) return undefined;
  return { protocol: "anthropic-messages", baseURL, apiKey, models };
}
