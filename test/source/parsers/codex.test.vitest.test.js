// dsh-llm-cc-switch: codex parser tests.

import { describe, expect, it } from "vitest";

import { parseCodex } from "../../../lib/source/parsers/codex.js";

describe("parsers/codex", () => {
  it("reads OPENAI_API_KEY and the chosen model_provider", () => {
    const cfg = {
      auth: { OPENAI_API_KEY: "sk-test" },
      config: `
model_provider = "deepseek"
[model_providers.deepseek]
base_url = "https://api.deepseek.com/v1"
wire_api = "chat"
`,
    };
    const out = parseCodex(cfg);
    expect(out?.protocol).toBe("openai-completions");
    expect(out?.baseURL).toBe("https://api.deepseek.com/v1");
    expect(out?.apiKey).toBe("sk-test");
  });

  it("uses wire_api = responses → openai-responses", () => {
    const cfg = {
      auth: { OPENAI_API_KEY: "sk-test" },
      config: `
model_provider = "deepseek"
[model_providers.deepseek]
base_url = "https://api.deepseek.com/v1"
wire_api = "responses"
`,
    };
    expect(parseCodex(cfg)?.protocol).toBe("openai-responses");
  });

  it("surfaces modelCatalog when present", () => {
    const cfg = {
      auth: { OPENAI_API_KEY: "sk-test" },
      config: `model_provider = "openai"`,
      modelCatalog: {
        models: [
          { model: "gpt-5", displayName: "GPT 5", contextWindow: 200000 },
          { model: "gpt-5-mini", displayName: "GPT 5 mini", contextWindow: 128000 },
        ],
      },
    };
    const out = parseCodex(cfg);
    expect(out?.models).toEqual([
      { id: "gpt-5", name: "GPT 5", contextWindow: 200000 },
      { id: "gpt-5-mini", name: "GPT 5 mini", contextWindow: 128000 },
    ]);
  });

  it("falls back to a single model from TOML when no catalog is configured", () => {
    const cfg = {
      auth: { OPENAI_API_KEY: "sk-test" },
      config: `model = "gpt-5-codex"`,
    };
    expect(parseCodex(cfg)?.models.map((m) => m.id)).toEqual(["gpt-5-codex"]);
  });

  it("skips ChatGPT OAuth rows", () => {
    expect(parseCodex({
      auth: { OPENAI_API_KEY: "sk-test", auth_mode: "chatgpt" },
      config: "",
    })).toBeUndefined();
  });

  it("returns undefined when no apiKey is present", () => {
    expect(parseCodex({ auth: { OPENAI_API_KEY: "" }, config: "" })).toBeUndefined();
  });
});
