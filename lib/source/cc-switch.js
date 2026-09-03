// dsh-llm-cc-switch: CcSwitchStore — SQLite-backed AccountStore implementation.
//
// Reads ~/.cc-switch/cc-switch.db (readOnly connection) and maps each
// providers row through the matching parser in `./parsers/`. The database
// is re-read whenever its file stamp (mtime + size) changes, so a CC
// Switch edit reaches DSH without a restart. A failing read keeps the
// previous good snapshot and surfaces the reason through `lastError`.

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AccountStore } from "./store.js";
import { PARSERS, MAX_MODELS_PER_ACCOUNT } from "./parsers/index.js";
import { allowBaseUrl } from "./url.js";

// Loaded on the first `#read()` to keep `node:sqlite` out of the static
// module graph. The path is built at runtime via URL — Vite's static
// analyser cannot follow a spec it cannot see as a string literal.
async function dbClass() {
  const here = new URL(".", import.meta.url);
  const target = new URL("./db.js", here);
  const mod = await import(target.href);
  return mod.loadDatabaseSync();
}

export class CcSwitchStore extends AccountStore {
  #config;
  #cached = null;
  #stamp = "";
  #lastError;

  constructor(config = {}) {
    super();
    this.#config = {
      dbPath: "",
      appTypes: ["claude", "claude-desktop", "codex", "opencode", "grokbuild"],
      bearerAuthPrefixes: ["tp-"],
      ...config,
    };
  }

  get stamp() {
    return this.#stamp;
  }

  get lastError() {
    return this.#lastError;
  }

  get sourceLocation() {
    return this.dbPath;
  }

  get dbPath() {
    const { dbPath } = this.#config;
    return dbPath && dbPath.length > 0 ? dbPath : join(homedir(), ".cc-switch", "cc-switch.db");
  }

  /** Pure: returns true if a key should travel as `Authorization: Bearer`. */
  isBearerKey(apiKey) {
    if (typeof apiKey !== "string") return false;
    return this.#config.bearerAuthPrefixes.some((prefix) => prefix.length > 0 && apiKey.startsWith(prefix));
  }

  /**
   * Read-and-cache the database. Returns a list of Account-shaped rows in
   * the store's display order. Caching key is `${mtimeMs}:${size}` so any
   * write by the CC Switch app bumps it.
   */
  async #read() {
    const path = this.dbPath;
    let stamp;
    try {
      const info = statSync(path);
      stamp = `${info.mtimeMs}:${info.size}`;
    } catch {
      throw new Error(`CC Switch database not found at ${path}`);
    }
    const DatabaseSync = await dbClass();
    const db = new DatabaseSync(path, { readOnly: true });
    const skipped = [];
    try {
      db.exec("PRAGMA busy_timeout = 3000");
      const rows = db.prepare(
        "SELECT id, app_type, name, category, settings_config, sort_index, is_current FROM providers",
      ).all();
      const accounts = [];
      for (const row of rows) {
        const parse = PARSERS[row.app_type];
        if (!parse) {
          skipped.push({ id: row.id, appType: row.app_type, reason: "no-parser" });
          continue;
        }
        if (!this.#config.appTypes.includes(row.app_type)) {
          skipped.push({ id: row.id, appType: row.app_type, reason: "appType-disabled" });
          continue;
        }
        let cfg;
        try {
          cfg = JSON.parse(row.settings_config);
        } catch (error) {
          skipped.push({ id: row.id, appType: row.app_type, reason: `settings_config not JSON: ${error.message}` });
          continue;
        }
        const parsed = parse(cfg);
        if (!parsed || parsed.models.length === 0) {
          skipped.push({ id: row.id, appType: row.app_type, reason: parsed ? "no-models" : "parser-rejected" });
          continue;
        }
        // Defensive: baseURL goes through allowlist before any request fires.
        const gate = allowBaseUrl(parsed.baseURL, this.#config.urlAllowlist);
        if (!gate.ok) {
          skipped.push({ id: row.id, appType: row.app_type, reason: gate.reason });
          continue;
        }
        accounts.push({
          accountId: row.id,
          appType: row.app_type,
          name: row.name,
          protocol: parsed.protocol,
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
      return { stamp, accounts, skipped };
    } finally {
      try { db.close(); } catch { /* readOnly — close is best-effort */ }
    }
  }

  /** Re-reads the DB when its stamp changed. Async because the underlying
   *  sqlite binding is loaded lazily on the first use. */
  async accounts() {
    let currentStamp;
    try {
      const info = statSync(this.dbPath);
      currentStamp = `${info.mtimeMs}:${info.size}`;
    } catch (error) {
      this.#lastError = new Error(`CC Switch database not found at ${this.dbPath}`);
      if (this.#cached === null) {
        this.#cached = [];
      }
      return this.#cached;
    }
    if (this.#cached !== null && currentStamp === this.#stamp) {
      return this.#cached;
    }
    try {
      const next = await this.#read();
      this.#stamp = next.stamp;
      this.#cached = next.accounts;
      this.#lastError = undefined;
      if (next.skipped.length > 0 && this.#config.logger !== undefined) {
        this.#config.logger.warn(
          "dsh-llm-cc-switch: skipped %s row(s) out of %s: %s",
          next.skipped.length,
          next.accounts.length + next.skipped.length,
          next.skipped.map((s) => `${s.id}(${s.appType}:${s.reason})`).join(", "),
        );
      }
    } catch (error) {
      this.#lastError = error;
      if (this.#cached === null) this.#cached = [];
    }
    return this.#cached;
  }

  async routes() {
    const ordered = [];
    const seen = new Set();
    const accounts = await this.accounts();
    for (const appType of this.#config.appTypes) {
      if (seen.has(appType)) continue;
      const present = accounts.some((account) => account.appType === appType);
      if (!present) continue;
      seen.add(appType);
      ordered.push(`cc-switch/${appType}`);
    }
    return ordered;
  }

  async account(accountId) {
    return (await this.accounts()).find((account) => account.accountId === accountId);
  }

  async accountsOf(appType) {
    return (await this.accounts()).filter((account) => account.appType === appType);
  }
}
