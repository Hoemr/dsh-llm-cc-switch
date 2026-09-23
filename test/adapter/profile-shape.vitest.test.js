// dsh-llm-cc-switch: CcSwitchAdapter ↔ @deepseek-ai/dsh-llm-pi-ai seam tests.
//
// `CcSwitchAdapter` is not a wire adapter: it synthesizes one
// `ResolvedPiAiProviderProfile` per account and hands the real work to
// `PiAiAdapter`. That makes the *shape* of the profile object load-bearing,
// and the failure mode is nasty — the harness seam reads fields such as
// `modelErrors` and `configuredMaxTokens` long after `apply()` has already
// registered routes, so a profile missing one of them registers cleanly and
// then throws on the first `resolveModel()` / `prepareCall()` / `stream()`.
// `0.2.2` was exactly that bug against DeepSeek Harness `0.1.5-rc.3`.
//
// These tests drive the adapter through the seams it actually calls
// (`listModels`, `resolveModel`, `prepareCall`, `providerRetryPolicy`) with a
// stub `AccountStore`, so a future harness changing what it reads from a
// profile fails here instead of in a user's picker.

import { describe, expect, it } from "vitest";

import { CcSwitchAdapter, Config } from "../../lib/index.js";
import { encodeModelId, registerAccountSource } from "../../lib/source/index.js";

const ACCOUNT = {
  accountId: "acct-1",
  appType: "claude",
  name: "Fixture Co",
  protocol: "anthropic-messages",
  baseURL: "https://api.example.test",
  apiKey: "sk-fixture-not-a-real-key",
  bearer: false,
  models: [{ id: "claude-fixture", name: "Claude Fixture", contextWindow: 200000 }],
  current: true,
};

/** A store with one claude account, resolved without touching SQLite. */
registerAccountSource("fixture-one", () => ({
  stamp: "fixture-stamp",
  lastError: undefined,
  sourceLocation: "<fixture>",
  accounts: async () => [ACCOUNT],
  accountsOf: async (appType) => (appType === "claude" ? [ACCOUNT] : []),
  account: async (accountId) => (accountId === ACCOUNT.accountId ? ACCOUNT : undefined),
  routes: async () => ["cc-switch/claude"],
}));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Construct an adapter and let its async profile cache warm once. */
async function fixtureAdapter() {
  const adapter = new CcSwitchAdapter(
    Config({ source: "fixture-one", appTypes: ["claude"] }),
    silentLogger,
  );
  // The constructor pre-warms the cache asynchronously; the sync `profiles()`
  // hook the pi-ai seam calls only sees a populated map after that settles.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return adapter;
}

describe("adapter/profile shape", () => {
  it("lists the account's models under its harness route", async () => {
    const adapter = await fixtureAdapter();
    const models = await adapter.listModels("cc-switch/claude");
    expect(models.map((model) => model.id)).toEqual([
      encodeModelId(ACCOUNT.accountId, "claude-fixture"),
    ]);
    expect(models[0].name).toContain("[195k · anthropic]");
  });

  it("resolves a model without the profile missing seam-required fields", async () => {
    const adapter = await fixtureAdapter();
    const info = await adapter.resolveModel(
      "cc-switch/claude",
      encodeModelId(ACCOUNT.accountId, "claude-fixture"),
    );
    expect(info.provider).toBe("cc-switch/claude");
    expect(info.name).toBe("Fixture Co · Claude Fixture  [195k · anthropic]");
    // `LlmResolvedModelInfo.context` is an object, not a bare number.
    expect(info.context).toEqual({ contextWindow: 200000 });
  });

  it("prepares a call with bound model metadata and a stream entry point", async () => {
    const adapter = await fixtureAdapter();
    const prepared = await adapter.prepareCall(
      "cc-switch/claude",
      encodeModelId(ACCOUNT.accountId, "claude-fixture"),
    );
    expect(prepared.model.id).toBe(encodeModelId(ACCOUNT.accountId, "claude-fixture"));
    expect(typeof prepared.stream).toBe("function");
  });

  it("defers the retry policy to the harness default", async () => {
    const adapter = await fixtureAdapter();
    expect(adapter.providerRetryPolicy("cc-switch/claude")).toBeUndefined();
  });

  it("names the harness category in providerInfo", async () => {
    const adapter = await fixtureAdapter();
    expect(adapter.providerInfo("cc-switch/claude")).toEqual({
      id: "cc-switch/claude",
      name: "Claude Code",
    });
  });

  it("rejects a model id that does not belong to the route", async () => {
    const adapter = await fixtureAdapter();
    await expect(
      adapter.resolveModel("cc-switch/claude", encodeModelId("someone-else", "claude-fixture")),
    ).rejects.toThrow(/not an account of/);
    await expect(
      adapter.resolveModel("cc-switch/claude", "not-an-encoded-model-id"),
    ).rejects.toThrow(/has no model/);
  });
});
