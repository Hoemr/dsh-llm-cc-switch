// dsh-llm-cc-switch: opencode parser tests.

import { describe, expect, it } from "vitest";

import { parseOpenCode } from "../../../lib/source/parsers/opencode.js";

describe("parsers/opencode", () => {
  it("dispatches to anthropic-messages when npm references anthropic", () => {
    const out = parseOpenCode({
      npm: "@ai-sdk/anthropic",
      options: {
        apiKey: "sk-test",
        baseURL: "https://relay.example/v1",
      },
      models: { "claude-sonnet-4": { name: "Sonnet" } },
    });
    expect(out?.protocol).toBe("anthropic-messages");
    // /v1 is dropped because pi-ai appends /v1/messages
    expect(out?.baseURL).toBe("https://relay.example");
    expect(out?.models).toEqual([{ id: "claude-sonnet-4", name: "Sonnet" }]);
  });

  it("dispatches to openai-completions for non-anthropic providers", () => {
    const out = parseOpenCode({
      npm: "@ai-sdk/openai",
      options: { apiKey: "sk-test", baseURL: "https://api.example.com/v1" },
      models: { "gpt-5": { name: "GPT 5" } },
    });
    expect(out?.protocol).toBe("openai-completions");
    expect(out?.baseURL).toBe("https://api.example.com/v1");
  });

  it("preserves a non-/v1 Anthropic baseURL", () => {
    const out = parseOpenCode({
      npm: "@ai-sdk/anthropic",
      options: { apiKey: "sk-test", baseURL: "https://relay.example" },
      models: { m: { name: "m" } },
    });
    expect(out?.baseURL).toBe("https://relay.example");
  });

  it("returns undefined when no apiKey is present", () => {
    expect(parseOpenCode({ npm: "@ai-sdk/openai", options: {}, models: { x: { name: "X" } } })).toBeUndefined();
  });

  it("returns undefined when models is empty", () => {
    expect(parseOpenCode({
      npm: "@ai-sdk/openai",
      options: { apiKey: "x" },
      models: {},
    })).toBeUndefined();
  });
});
