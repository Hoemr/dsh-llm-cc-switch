// dsh-llm-cc-switch: baseURL allowlist tests.

import { describe, expect, it } from "vitest";

import { allowBaseUrl, redactUrl } from "../../lib/source/url.js";

describe("source/url: allowBaseUrl", () => {
  it("accepts the four default schemes", () => {
    for (const url of [
      "http://api.example/v1",
      "https://api.example/v1",
      "ws://api.example",
      "wss://api.example",
    ]) {
      expect(allowBaseUrl(url).ok).toBe(true);
    }
  });

  it("rejects empty / unparseable / wrong-scheme URLs", () => {
    expect(allowBaseUrl("").ok).toBe(false);
    expect(allowBaseUrl("not a url").ok).toBe(false);
    expect(allowBaseUrl("file:///etc/passwd").ok).toBe(false);
    expect(allowBaseUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("respects a custom scheme allowlist", () => {
    const r = allowBaseUrl("http://api.example/v1", { schemes: ["https:"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/scheme/);
  });

  it("enforces a host allowlist when provided", () => {
    const allow = allowBaseUrl("https://api.example/v1", {
      schemes: ["https:"],
      hosts: ["api.openai.com"],
    });
    expect(allow.ok).toBe(false);

    const allow2 = allowBaseUrl("https://api.openai.com/v1", {
      schemes: ["https:"],
      hosts: ["api.openai.com"],
    });
    expect(allow2.ok).toBe(true);
  });

  it("matches a host allowlist by suffix", () => {
    const r = allowBaseUrl("https://api.staging.openai.com/v1", {
      schemes: ["https:"],
      hosts: ["openai.com"],
    });
    expect(r.ok).toBe(true);
  });
});

describe("source/url: redactUrl", () => {
  it("keeps scheme + host, drops path / query / fragment", () => {
    expect(redactUrl("https://user:t0ken@api.example/secret/path?x=1#frag"))
      .toBe("https://api.example");
  });

  it("falls back to a placeholder for an unparseable URL", () => {
    expect(redactUrl("not a url")).toBe("<unparseable url>");
  });
});
