// dsh-llm-cc-switch: grokbuild parser tests.
//
// Fixture strings mirror real cc-switch settings_config rows. See
// https://github.com/farion1231/cc-switch/blob/main/src/utils/grokBuildConfig.ts
// for the schema these come from.

import { describe, expect, it } from "vitest";

import { parseGrokBuild } from "../../../lib/source/parsers/grokbuild.js";

describe("parsers/grokbuild", () => {
  it("returns openai-responses when api_backend is responses (the default)", () => {
    const cfg = {
      config: `
models.default = "main"
[model.main]
model = "grok-4.5"
base_url = "https://api.example/v1"
name = "Main"
api_key = "tp-test"
api_backend = "responses"
context_window = 500000
`,
    };
    const out = parseGrokBuild(cfg);
    expect(out?.protocol).toBe("openai-responses");
    expect(out?.baseURL).toBe("https://api.example/v1");
    expect(out?.apiKey).toBe("tp-test");
    expect(out?.models).toEqual([{ id: "grok-4.5", name: "Main", contextWindow: 500000 }]);
  });

  it("uses api_backend = chat to pick openai-completions", () => {
    const cfg = {
      config: `
models.default = "fallback"
[model.fallback]
model = "grok-mini"
base_url = "https://api.example/v1"
name = "Fallback"
api_key = "sk-test"
api_backend = "chat"
`,
    };
    expect(parseGrokBuild(cfg)?.protocol).toBe("openai-completions");
  });

  it("uses env_key when api_key is not present", () => {
    const cfg = {
      config: `
models.default = "main"
[model.main]
model = "grok-4.5"
base_url = "https://api.example/v1"
name = "Main"
env_key = "ENV_VAR_NAME"
`,
      env: {},
    };
    // No api_key, no env lookup in our parser; row is unusable.
    expect(parseGrokBuild(cfg)).toBeUndefined();
  });

  it("returns undefined when base_url is missing", () => {
    const cfg = {
      config: `
models.default = "main"
[model.main]
model = "grok-4.5"
name = "Main"
api_key = "x"
`,
    };
    expect(parseGrokBuild(cfg)).toBeUndefined();
  });

  it("falls back to grok-4.5 / 500000 defaults when the optional fields are absent", () => {
    const cfg = {
      config: `
models.default = "main"
[model.main]
base_url = "https://api.example/v1"
api_key = "x"
`,
    };
    const out = parseGrokBuild(cfg);
    expect(out?.models).toEqual([{ id: "grok-4.5", name: "main", contextWindow: 500000 }]);
  });

  it("ignores a non-positive context_window and falls back to 500000", () => {
    const cfg = {
      config: `
models.default = "main"
[model.main]
model = "grok-4.5"
base_url = "https://api.example/v1"
name = "Main"
api_key = "x"
context_window = "0"
`,
    };
    const out = parseGrokBuild(cfg);
    expect(out?.models[0].contextWindow).toBe(500000);
  });
});
