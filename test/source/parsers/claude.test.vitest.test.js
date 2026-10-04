// dsh-llm-cc-switch: claude / claude-desktop parser tests.

import { describe, expect, it } from "vitest";

import { parseClaude } from "../../../lib/source/parsers/claude.js";

describe("parsers/claude", () => {
  it("returns anthropic-messages accounts with the listed models", () => {
    const cfg = {
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-test",
        ANTHROPIC_BASE_URL: "https://api.example/v1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4",
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "Opus",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4",
      },
    };
    const out = parseClaude(cfg);
    expect(out?.protocol).toBe("anthropic-messages");
    expect(out?.baseURL).toBe("https://api.example/v1");
    expect(out?.apiKey).toBe("sk-test");
    expect(out?.models).toEqual([
      { id: "claude-opus-4", name: "Opus" },
      { id: "claude-sonnet-4", name: "claude-sonnet-4" },
      { id: "claude-haiku-4", name: "claude-haiku-4" },
    ]);
  });

  it("falls back to the canonical Anthropic baseURL", () => {
    const out = parseClaude({ env: { ANTHROPIC_AUTH_TOKEN: "x", ANTHROPIC_MODEL: "y" } });
    expect(out?.baseURL).toBe("https://api.anthropic.com");
    expect(out?.models).toEqual([{ id: "y", name: "y" }]);
  });

  it("strips the [1M] suffix from the wire id, keeps it as part of the human-readable lookup, and reports it as the context window", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4[1M]",
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Sonnet (1M)",
      },
    });
    expect(out?.models[0]).toEqual({
      id: "claude-sonnet-4",
      name: "Sonnet (1M)",
      contextWindow: 1_000_000,
    });
  });

  it("reads every unit form a context suffix may use", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "big[1M]",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mid[200k]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "raw[1000000]",
        ANTHROPIC_DEFAULT_FABLE_MODEL: "small[64 K]",
      },
    });
    expect(out?.models.map((m) => [m.id, m.contextWindow])).toEqual([
      ["big", 1_000_000],
      ["mid", 200_000],
      ["raw", 1_000_000],
      ["small", 64_000],
    ]);
  });

  it("leaves the window unset for a suffix that names no size", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4[preview]",
      },
    });
    expect(out?.models[0]).toEqual({ id: "claude-opus-4", name: "claude-opus-4" });
  });

  it("scopes the window to the key that declared it", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4.1-flash[1M]",
      },
    });
    expect(out?.models.find((m) => m.id === "deepseek-v4-flash")?.contextWindow).toBeUndefined();
    expect(out?.models.find((m) => m.id === "deepseek-v4.1-flash")?.contextWindow).toBe(1_000_000);
  });

  it("keeps the first declaration of a duplicated id", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "shared",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "shared[1M]",
      },
    });
    expect(out?.models).toEqual([{ id: "shared", name: "shared" }]);
  });

  it("returns undefined when no apiKey is present", () => {
    expect(parseClaude({ env: { ANTHROPIC_MODEL: "x" } })).toBeUndefined();
  });

  it("returns undefined when no model id is declared", () => {
    expect(parseClaude({ env: { ANTHROPIC_AUTH_TOKEN: "x" } })).toBeUndefined();
  });

  it("deduplicates model ids that show up under several env keys", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "shared",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "shared",
      },
    });
    expect(out?.models.map((m) => m.id)).toEqual(["shared"]);
  });

  it("accepts ANTHROPIC_API_KEY as a fallback auth token", () => {
    const out = parseClaude({ env: { ANTHROPIC_API_KEY: "x", ANTHROPIC_MODEL: "m" } });
    expect(out?.apiKey).toBe("x");
  });
});
