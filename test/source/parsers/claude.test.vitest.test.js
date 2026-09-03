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

  it("strips the [1M] suffix from the wire id but keeps it as part of the human-readable lookup", () => {
    const out = parseClaude({
      env: {
        ANTHROPIC_AUTH_TOKEN: "x",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4[1M]",
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Sonnet (1M)",
      },
    });
    expect(out?.models[0]).toEqual({ id: "claude-sonnet-4", name: "Sonnet (1M)" });
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
