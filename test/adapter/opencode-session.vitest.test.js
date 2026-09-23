// dsh-llm-cc-switch: OpenCode Go / Zen session-header tests.
//
// Since 2026-09-06 opencode.ai rejects requests that carry no stable
// per-conversation session id (`400 MissingSessionID`), and it only accepts
// that id under `x-opencode-session` / `session_id` / `x-session-id` — not
// under `x-session-affinity`, which is what the pi-ai session-affinity feature
// emits on the Anthropic transport. DSH's own adapters do not send the header
// yet (upstream: deepseek-harness discussion #5495), so an OpenCode Go account
// bridged through this plugin fails on every request unless this adapter
// stamps it.
//
// These tests capture the real outgoing request by stubbing `globalThis.fetch`
// (the pi-ai SDKs default to it) instead of asserting on private state, so they
// also cover the header surviving the pi-ai profile/options merge.

import { afterEach, describe, expect, it } from "vitest";

import { CcSwitchAdapter, Config } from "../../lib/index.js";
import { encodeModelId, registerAccountSource } from "../../lib/source/index.js";

const OPENCODE = {
  accountId: "oc-1",
  appType: "claude",
  name: "OpenCode Go",
  protocol: "anthropic-messages",
  baseURL: "https://opencode.ai/zen/go",
  apiKey: "sk-fixture-opencode",
  bearer: false,
  models: [{ id: "glm-5.3-flash", name: "GLM 5.3 Flash", contextWindow: 200000 }],
  current: true,
};

const OTHER = {
  accountId: "ds-1",
  appType: "claude",
  name: "DeepSeek",
  protocol: "anthropic-messages",
  baseURL: "https://api.deepseek.com/anthropic",
  apiKey: "sk-fixture-deepseek",
  bearer: false,
  models: [{ id: "deepseek-flash", name: "DeepSeek Flash", contextWindow: 200000 }],
  current: true,
};

registerAccountSource("fixture-mixed", () => ({
  stamp: "fixture-stamp",
  lastError: undefined,
  sourceLocation: "<fixture>",
  accounts: async () => [OPENCODE, OTHER],
  accountsOf: async (appType) => (appType === "claude" ? [OPENCODE, OTHER] : []),
  account: async (accountId) => [OPENCODE, OTHER].find((a) => a.accountId === accountId),
  routes: async () => ["cc-switch/claude"],
}));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Replace the global fetch with a recorder that answers 400 (the request is
 *  already on the wire by then, which is all these tests need). */
function recordFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const headers = new Headers(init?.headers ?? (typeof input === "string" ? undefined : input.headers));
    calls.push({ url, headers });
    return new Response(
      JSON.stringify({ type: "error", error: { type: "captured", message: "test stub" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  };
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

afterEach(() => { /* every test restores its own stub */ });

async function fixtureAdapter(overrides = {}) {
  const adapter = new CcSwitchAdapter(
    Config({ source: "fixture-mixed", appTypes: ["claude"], ...overrides }),
    silentLogger,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return adapter;
}

const MESSAGE = {
  id: "opencode-session-test-message",
  role: "user",
  content: [{ type: "text", text: "hi" }],
  source: { kind: "user" },
};

/** Dispatch one call through the prepared-call path the DSH loop uses. */
async function dispatch(adapter, accountId, wireModelId, sessionId) {
  const modelId = encodeModelId(accountId, wireModelId);
  const prepared = await adapter.prepareCall("cc-switch/claude", modelId, undefined);
  const stream = prepared.stream({
    provider: "cc-switch/claude",
    model: modelId,
    messages: [MESSAGE],
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  try {
    for await (const _chunk of stream) { /* drain */ }
  } catch {
    // The stub answers 400; the captured request is what matters.
  }
}

describe("opencode session header", () => {
  it("stamps x-opencode-session from the DSH session id", async () => {
    const recorder = recordFetch();
    try {
      await dispatch(await fixtureAdapter(), OPENCODE.accountId, "glm-5.3-flash", "session-abc");
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0].url).toContain("opencode.ai");
      expect(recorder.calls[0].headers.get("x-opencode-session")).toBe("session-abc");
    } finally {
      recorder.restore();
    }
  });

  it("leaves non-OpenCode endpoints untouched", async () => {
    const recorder = recordFetch();
    try {
      await dispatch(await fixtureAdapter(), OTHER.accountId, "deepseek-flash", "session-abc");
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0].url).toContain("api.deepseek.com");
      expect(recorder.calls[0].headers.get("x-opencode-session")).toBeNull();
    } finally {
      recorder.restore();
    }
  });

  it("falls back to a stable per-adapter id when no session id arrives", async () => {
    const recorder = recordFetch();
    try {
      const adapter = await fixtureAdapter();
      await dispatch(adapter, OPENCODE.accountId, "glm-5.3-flash", undefined);
      await dispatch(adapter, OPENCODE.accountId, "glm-5.3-flash", undefined);
      expect(recorder.calls).toHaveLength(2);
      const first = recorder.calls[0].headers.get("x-opencode-session");
      const second = recorder.calls[1].headers.get("x-opencode-session");
      expect(first).toBeTruthy();
      expect(second).toBe(first);
    } finally {
      recorder.restore();
    }
  });

  it("gives concurrent-ish sessions their own ids", async () => {
    const recorder = recordFetch();
    try {
      const adapter = await fixtureAdapter();
      await dispatch(adapter, OPENCODE.accountId, "glm-5.3-flash", "session-one");
      await dispatch(adapter, OPENCODE.accountId, "glm-5.3-flash", "session-two");
      expect(recorder.calls.map((c) => c.headers.get("x-opencode-session")))
        .toEqual(["session-one", "session-two"]);
    } finally {
      recorder.restore();
    }
  });

  it("sends nothing when disabled", async () => {
    const recorder = recordFetch();
    try {
      await dispatch(
        await fixtureAdapter({ opencodeSession: { enabled: false } }),
        OPENCODE.accountId, "glm-5.3-flash", "session-abc",
      );
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0].headers.get("x-opencode-session")).toBeNull();
    } finally {
      recorder.restore();
    }
  });

  it("honours a custom header name and host list", async () => {
    const recorder = recordFetch();
    try {
      await dispatch(
        await fixtureAdapter({ opencodeSession: { header: "x-session-id", hosts: ["api.deepseek.com"] } }),
        OTHER.accountId, "deepseek-flash", "session-abc",
      );
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0].headers.get("x-session-id")).toBe("session-abc");
    } finally {
      recorder.restore();
    }
  });
});
