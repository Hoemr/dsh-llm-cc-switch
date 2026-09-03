// dsh-llm-cc-switch: TOML subset parser tests.
//
// The TOML reader is intentionally narrow; these tests pin the exact
// subset grokbuild / codex need so future refactors can't quietly
// regress real-world settings_config strings.

import { describe, expect, it } from "vitest";

import { tomlLookup, tomlSection, tomlSections, tomlValue } from "../../../lib/source/parsers/toml.js";

describe("parsers/toml: tomlValue", () => {
  it("parses a double-quoted string", () => {
    expect(tomlValue(`name = "anthropic"`)).toBe("anthropic");
  });

  it("parses a single-quoted (literal) string", () => {
    expect(tomlValue(`name = 'anthropic'`)).toBe("anthropic");
  });

  it("parses integers and booleans", () => {
    expect(tomlValue(`port = 8080`)).toBe(8080);
    expect(tomlValue(`enabled = true`)).toBe(true);
    expect(tomlValue(`enabled = false`)).toBe(false);
  });

  it("returns undefined when the line is not a key/value pair", () => {
    expect(tomlValue(`# a comment`)).toBeUndefined();
    expect(tomlValue("")).toBeUndefined();
  });
});

describe("parsers/toml: tomlLookup", () => {
  const toml = `
models.default = "fast"
[model.fast]
model = "grok-4.5"
base_url = "https://api.example/v1"
`;

  it("finds a top-level key by exact name", () => {
    expect(tomlLookup(toml, "models.default")).toBe("fast");
  });

  it("returns undefined when the key is absent", () => {
    expect(tomlLookup(toml, "models.missing")).toBeUndefined();
  });

  it("returns undefined for non-string values", () => {
    expect(tomlLookup(toml, "[model.fast]")).toBeUndefined();
  });
});

describe("parsers/toml: tomlSection", () => {
  const toml = `
[model.fast]
model = "grok-4.5"
base_url = "https://api.example/v1"
api_backend = "responses"
context_window = 500000

[model.slow]
model = "grok-4.5-deep"
`;

  it("returns the matching table only", () => {
    const fast = tomlSection(toml, "model.fast");
    expect(fast.model).toBe("grok-4.5");
    expect(fast.base_url).toBe("https://api.example/v1");
    expect(fast.api_backend).toBe("responses");
    expect(fast.context_window).toBe(500000);
  });

  it("returns an empty object for an absent header", () => {
    expect(tomlSection(toml, "model.absent")).toEqual({});
  });

  it("does not bleed into the next header", () => {
    const fast = tomlSection(toml, "model.fast");
    expect(fast).not.toHaveProperty("model.slow");
  });
});

describe("parsers/toml: tomlSections", () => {
  it("returns every header", () => {
    const toml = `
[alpha]
k = "a"

[beta]
k = "b"
`;
    const all = tomlSections(toml);
    expect(all["alpha"]?.k).toBe("a");
    expect(all["beta"]?.k).toBe("b");
  });
});
