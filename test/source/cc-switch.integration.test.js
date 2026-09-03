// dsh-llm-cc-switch: integration test against a real CC Switch database.
//
// This file is loaded ONLY by the `test:integration` script, which runs
// it through `node --experimental-sqlite --test test/source/integration`,
// NOT through vitest. Vitest cannot use `node:sqlite` on Windows; the
// union/runtime tests in `test/source/parsers/*` still cover the same
// surface using JSON fixtures.
//
// See `scripts/run-integration.mjs` for the runner. The rest of the
// vitest suite does not touch this file.

import { mkdtempSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import test from "node:test";
import assert from "node:assert/strict";

const { CcSwitchStore } = await import("../../lib/source/index.js");
const { DatabaseSync } = await import("node:sqlite");

function buildFixtureDb() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-cc-switch-test-"));
  const dbPath = join(dir, "cc-switch.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        settings_config TEXT NOT NULL,
        sort_index INTEGER,
        is_current INTEGER NOT NULL DEFAULT 0
      );
    `);
    const insert = db.prepare(`
      INSERT INTO providers (id, app_type, name, settings_config, is_current)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run("acc-claude-1", "claude", "Anthropic",
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-claude-test",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4",
        },
      }), 1);
    insert.run("acc-codex-1", "codex", "OpenAI",
      JSON.stringify({
        auth: { OPENAI_API_KEY: "sk-codex-test" },
        config: `
model_provider = "openai"
[model_providers.openai]
base_url = "https://api.openai.com/v1"
wire_api = "chat"
`,
        modelCatalog: { models: [{ model: "gpt-5", displayName: "GPT 5", contextWindow: 200000 }] },
      }), 0);
    insert.run("acc-opencode-1", "opencode", "OSDK",
      JSON.stringify({
        npm: "@ai-sdk/openai",
        options: { apiKey: "sk-openai-test", baseURL: "https://api.example.com/v1" },
        models: { "gpt-5": { name: "GPT 5" } },
      }), 0);
    insert.run("acc-grok-1", "grokbuild", "Grok",
      JSON.stringify({
        config: `
models.default = "main"
[model.main]
model = "grok-4.5"
base_url = "https://api.example/v1"
name = "Main"
api_key = "xai-test"
api_backend = "responses"
context_window = 500000
`,
      }), 0);
    insert.run("acc-bad", "claude", "Bad",
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } }), 0);
    insert.run("acc-skip", "unknownapp", "Skip", JSON.stringify({}), 0);
    insert.run("acc-bad-json", "claude", "BadJson", "{ not json", 0);
    insert.run("acc-bearer", "claude", "Token-plan",
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "tp-abcd-1234-5678",
          ANTHROPIC_BASE_URL: "https://api.anthropic.com",
          ANTHROPIC_MODEL: "claude-sonnet-4",
        },
      }), 0);
  } finally {
    db.close();
  }
  return { dir, dbPath };
}

test("CcSwitchStore parses providers rows", async () => {
  const fixture = buildFixtureDb();
  const store = new CcSwitchStore({ dbPath: fixture.dbPath });
  const accounts = await store.accounts();
  assert.deepEqual(accounts.map((a) => a.appType).sort(), ["claude", "claude", "codex", "grokbuild", "opencode"]);
  assert.ok(accounts.find((a) => a.appType === "claude" && a.name === "Anthropic"));
  assert.equal(accounts.find((a) => a.appType === "codex")?.models[0].id, "gpt-5");
});

test("CcSwitchStore returns routes in enabled appTypes order", async () => {
  const fixture = buildFixtureDb();
  const store = new CcSwitchStore({ dbPath: fixture.dbPath });
  assert.deepEqual(await store.routes(), [
    "cc-switch/claude",
    "cc-switch/codex",
    "cc-switch/opencode",
    "cc-switch/grokbuild",
  ]);
});

test("CcSwitchStore filters disabled appTypes", async () => {
  const fixture = buildFixtureDb();
  const store = new CcSwitchStore({ dbPath: fixture.dbPath, appTypes: ["codex"] });
  assert.deepEqual(await store.routes(), ["cc-switch/codex"]);
});

test("CcSwitchStore treats tp- prefix keys as bearer auth", async () => {
  const fixture = buildFixtureDb();
  const store = new CcSwitchStore({ dbPath: fixture.dbPath });
  const bearer = (await store.accounts()).find((a) => a.accountId === "acc-bearer");
  assert.equal(bearer?.bearer, true);
});

test("CcSwitchStore caches the snapshot and re-reads on (mtime,size) change", async () => {
  const fixture = buildFixtureDb();
  const store = new CcSwitchStore({ dbPath: fixture.dbPath });
  // Stamp "" before the first read; trigger a read so the cache is warm.
  await store.accounts();
  const stamp1 = store.stamp;
  assert.notEqual(stamp1, "");
  const same = await store.accounts();
  assert.equal(store.stamp, stamp1);

  const info = statSync(fixture.dbPath);
  utimesSync(fixture.dbPath, info.atime / 1000, info.mtime / 1000 + 5);
  const after = await store.accounts();
  assert.notEqual(after, same);
  assert.notEqual(store.stamp, stamp1);
});

test("CcSwitchStore applies a baseURL allowlist", async () => {
  const fixture = buildFixtureDb();
  const store = new CcSwitchStore({
    dbPath: fixture.dbPath,
    urlAllowlist: { hosts: ["api.openai.com"] },
  });
  const accounts = await store.accounts();
  assert.deepEqual(accounts.map((a) => a.appType), ["codex"]);
});

test("CcSwitchStore surfaces a missing-file error and serves an empty list", async () => {
  const fixture = buildFixtureDb();
  const missing = join(fixture.dir, "does-not-exist.db");
  const store = new CcSwitchStore({ dbPath: missing });
  assert.deepEqual(await store.accounts(), []);
  assert.match(store.lastError?.message ?? "", /not found/i);
});
