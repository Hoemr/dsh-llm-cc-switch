// dsh-llm-cc-switch: CC Switch account source.
//
// Pure Node (no @deepseek-ai imports) so it can be exercised standalone.
// Reads the CC Switch SQLite database (farion1231/cc-switch) and turns each
// provider row into a harness/endpoint/protocol description the adapter can
// turn into pi-ai providers. The database is re-read whenever its file stamp
// (mtime + size) changes, so edits made in CC Switch are picked up by DSH on
// the next model listing or request without a restart.

import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Human-readable harness name per CC Switch app_type. */
export const APP_DISPLAY = Object.freeze({
  claude: "Claude Code",
  "claude-desktop": "Claude Code (Desktop)",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  grokbuild: "Grok Build",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  pi: "Pi",
});

/** Harness routes handed to ctx.llm (`cc-switch/claude`, ...). */
export const ROUTE_PREFIX = "cc-switch/";
export const ACCOUNT_ROUTE_PREFIX = "cc-switch-account/";

export function routeFor(appType) {
  return `${ROUTE_PREFIX}${appType}`;
}

export function appTypeOf(route) {
  return route.startsWith(ROUTE_PREFIX) ? route.slice(ROUTE_PREFIX.length) : undefined;
}

export function accountRouteFor(accountId) {
  return `${ACCOUNT_ROUTE_PREFIX}${accountId}`;
}

export function accountIdOf(route) {
  return route.startsWith(ACCOUNT_ROUTE_PREFIX) ? route.slice(ACCOUNT_ROUTE_PREFIX.length) : undefined;
}

/** Model ids handed to the picker: `<account-uuid>::<wire model id>`. */
export const MODEL_SEP = "::";

export function encodeModelId(accountId, wireModelId) {
  return `${accountId}${MODEL_SEP}${wireModelId}`;
}

export function decodeModelId(modelId) {
  const at = modelId.indexOf(MODEL_SEP);
  if (at <= 0 || at + MODEL_SEP.length >= modelId.length) return undefined;
  return { accountId: modelId.slice(0, at), wireModelId: modelId.slice(at + MODEL_SEP.length) };
}

/** Claude Code model-aliasing suffix (`model[1M]`) is a UI hint, not part of the wire id. */
function stripModelSuffix(raw) {
  return String(raw).replace(/\[[^\]]*\]\s*$/, "").trim();
}

/**
 * Clamp the model list so no malicious/broken config can hang the picker.
 * The real cc-switch entry lists stay tiny; this is a sanity bound only.
 */
const MAX_MODELS_PER_ACCOUNT = 16;

/** Parse a claude / claude-desktop CC Switch provider row. */
function parseClaude(cfg) {
  const env = (cfg && cfg.env) || {};
  const apiKey = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;
  const baseURL = typeof env.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL.length > 0
    ? env.ANTHROPIC_BASE_URL
    : "https://api.anthropic.com";
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
    seen.add(id);
    models.push({ id, name: names.get(id) ?? id });
    if (models.length >= MAX_MODELS_PER_ACCOUNT) break;
  }
  if (models.length === 0) return undefined;
  return { protocol: "anthropic-messages", baseURL, apiKey, models };
}

function tomlValue(line) {
  const match = /^\s*[A-Za-z0-9_.]+\s*=\s*("([^"]*)"|'([^']*)')/.exec(line);
  if (match) return match[2] ?? match[3] ?? "";
  return undefined;
}

/** Extract one TOML table `[name.sub]` and return its key/value pairs. */
function tomlSection(toml, header) {
  const lines = String(toml).split(/\r?\n/);
  let inside = false;
  const out = {};
  for (const line of lines) {
    const headerMatch = /^\s*\[([^\]]+)\]\s*/.exec(line);
    if (headerMatch) {
      inside = headerMatch[1].trim() === header;
      continue;
    }
    if (!inside) continue;
    const value = tomlValue(line);
    if (value !== undefined) {
      const key = /^\s*([A-Za-z0-9_.]+)\s*=/.exec(line);
      if (key) out[key[1]] = value;
    }
  }
  return out;
}

/** Parse a codex CC Switch provider row: auth.json + config.toml + modelCatalog. */
function parseCodex(cfg) {
  const auth = (cfg && cfg.auth) || {};
  if (auth.auth_mode === "chatgpt") return undefined; // OpenAI OAuth login; no bearer API key to use
  const apiKey = auth.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;
  const toml = cfg && typeof cfg.config === "string" ? cfg.config : "";
  const providerName = tomlValue(toml.split("\n").find((line) => /^\s*model_provider\s*=/.test(line))) ?? "custom";
  const section = tomlSection(toml, `model_providers.${providerName}`);
  const baseURL = section.base_url ?? (providerName === "custom" ? "https://api.openai.com/v1" : "https://api.openai.com/v1");
  const wireApi = String(section.wire_api ?? "chat").toLowerCase();
  const protocol = wireApi === "responses" ? "openai-responses" : "openai-completions";
  const catalog = cfg && Array.isArray(cfg.modelCatalog?.models) ? cfg.modelCatalog.models : undefined;
  const seen = new Set();
  const models = [];
  const push = (id, name, contextWindow) => {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) return;
    seen.add(id);
    models.push({ id, name: name ?? id, ...(Number.isInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {}) });
  };
  if (catalog && catalog.length > 0) {
    for (const entry of catalog) push(entry.model, entry.displayName, entry.contextWindow);
  } else {
    const model = tomlValue(toml.split("\n").find((line) => /^\s*model\s*=/.test(line))) ?? "gpt-5";
    push(model, undefined, undefined);
  }
  if (models.length === 0) push("gpt-5", undefined, undefined);
  return { protocol, baseURL, apiKey, models: models.slice(0, MAX_MODELS_PER_ACCOUNT) };
}

/** Parse an opencode CC Switch provider row (AI-SDK provider shape). */
function parseOpenCode(cfg) {
  const options = (cfg && cfg.options) || {};
  const apiKey = options.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;
  const npm = typeof cfg.npm === "string" ? cfg.npm : "";
  const isAnthropic = npm.includes("anthropic");
  const protocol = isAnthropic ? "anthropic-messages" : "openai-completions";
  let baseURL = typeof options.baseURL === "string" && options.baseURL.length > 0 ? options.baseURL
    : isAnthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1";
  // AI-SDK providers append `/messages` to their baseURL; pi-ai's Anthropic
  // SDK client appends `/v1/messages`, so a trailing `/v1` must be dropped
  // for the wire URL to agree.
  if (isAnthropic && baseURL.endsWith("/v1")) baseURL = baseURL.slice(0, -"/v1".length);
  const entries = (cfg && cfg.models) || {};
  const models = [];
  for (const [id, entry] of Object.entries(entries)) {
    models.push({ id, name: typeof entry?.name === "string" && entry.name.length > 0 ? entry.name : id });
    if (models.length >= MAX_MODELS_PER_ACCOUNT) break;
  }
  if (models.length === 0) return undefined;
  return { protocol, baseURL, apiKey, models };
}

const PARSERS = {
  claude: parseClaude,
  "claude-desktop": parseClaude,
  codex: parseCodex,
  opencode: parseOpenCode,
};

/**
 * Live view over the CC Switch database.
 *
 * `accounts()` re-reads the file whenever its mtime/size stamp changes, so
 * every DSH model listing or LLM request sees the accounts CC Switch holds
 * right now. A failing read keeps the previous snapshot and exposes the
 * reason through `lastError`.
 */
export class CcSwitchStore {
  #options;
  #cached = null;
  #stamp = null;
  #lastError;

  constructor(options) {
    this.#options = {
      dbPath: "",
      appTypes: ["claude", "claude-desktop", "codex", "opencode"],
      bearerAuthPrefixes: ["tp-"],
      contextWindow: 200000,
      maxTokens: 64000,
      ...options,
    };
  }

  get lastError() {
    return this.#lastError;
  }

  /** Stamp of the snapshot currently in memory ("" before the first read). */
  get stamp() {
    return this.#stamp ?? "";
  }

  get dbPath() {
    const { dbPath } = this.#options;
    return dbPath && dbPath.length > 0 ? dbPath : join(homedir(), ".cc-switch", "cc-switch.db");
  }

  isBearerKey(apiKey) {
    return this.#options.bearerAuthPrefixes.some((prefix) => prefix.length > 0 && apiKey.startsWith(prefix));
  }

  #read() {
    const path = this.dbPath;
    let stamp;
    try {
      const info = statSync(path);
      stamp = `${info.mtimeMs}:${info.size}`;
    } catch {
      throw new Error(`CC Switch database not found at ${path}`);
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 3000");
      const rows = db.prepare(
        "SELECT id, app_type, name, category, settings_config, sort_index, is_current FROM providers",
      ).all();
      const accounts = [];
      for (const row of rows) {
        const parse = PARSERS[row.app_type];
        if (!parse) continue;
        let cfg;
        try {
          cfg = JSON.parse(row.settings_config);
        } catch {
          continue;
        }
        const parsed = parse(cfg);
        if (!parsed) continue;
        if (!this.#options.appTypes.includes(row.app_type)) continue;
        const protocol = parsed.protocol;
        if (protocol !== "anthropic-messages" && protocol !== "openai-completions" && protocol !== "openai-responses") continue;
        accounts.push({
          accountId: row.id,
          appType: row.app_type,
          name: row.name,
          protocol,
          baseURL: parsed.baseURL,
          apiKey: parsed.apiKey,
          bearer: this.isBearerKey(parsed.apiKey),
          models: parsed.models,
          current: row.is_current === 1,
        });
      }
      accounts.sort((a, b) => {
        if (a.appType !== b.appType) return a.appType.localeCompare(b.appType);
        if (a.current !== b.current) return a.current ? -1 : 1;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
      return { stamp, accounts };
    } finally {
      db.close();
    }
  }

  /** All usable accounts; re-reads the database whenever its file stamp changes. */
  accounts() {
    const current = (() => {
      try {
        const info = statSync(this.dbPath);
        return `${info.mtimeMs}:${info.size}`;
      } catch {
        return undefined;
      }
    })();
    if (this.#cached !== null && current === this.#stamp) return this.#cached;
    if (current === undefined) {
      this.#lastError = new Error(`CC Switch database not found at ${this.dbPath}`);
      if (this.#cached === null) this.#cached = [];
      return this.#cached;
    }
    try {
      const next = this.#read();
      this.#stamp = next.stamp;
      this.#cached = next.accounts;
      this.#lastError = undefined;
    } catch (error) {
      // The database was there a moment ago; keep serving the last snapshot.
      this.#lastError = error;
      if (this.#cached === null) this.#cached = [];
    }
    return this.#cached;
  }

  /** The harness routes to register: enabled app types that currently hold accounts. */
  routes() {
    const ordered = [];
    const seen = new Set();
    for (const appType of this.#options.appTypes) {
      if (seen.has(appType)) continue;
      const present = this.accounts().some((account) => account.appType === appType);
      if (!present) continue;
      seen.add(appType);
      ordered.push(routeFor(appType));
    }
    return ordered;
  }

  account(accountId) {
    return this.accounts().find((account) => account.accountId === accountId);
  }

  accountsOf(appType) {
    return this.accounts().filter((account) => account.appType === appType);
  }
}
