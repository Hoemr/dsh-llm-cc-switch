// dsh-llm-cc-switch: log-redaction tests.

import { describe, expect, it } from "vitest";

import {
  redactAccountShape,
  redactHeaders,
  redactKey,
} from "../../lib/source/redact.js";

describe("redact: redactKey", () => {
  it("keeps first four and last four characters of long keys", () => {
    expect(redactKey("sk-test-1234-abcd")).toBe("sk-t…abcd");
  });

  it("collapses short / empty / non-string keys to the placeholder", () => {
    expect(redactKey("")).toBe("***redacted***");
    expect(redactKey("short")).toBe("***redacted***");
    expect(redactKey(undefined)).toBe("***redacted***");
    expect(redactKey(null)).toBe("***redacted***");
  });
});

describe("redact: redactHeaders", () => {
  it("redacts known credential header names", () => {
    const out = redactHeaders({
      "x-api-key": "sk-test-1234-abcd",
      authorization: "Bearer abcdef-1234-5678",
      "content-type": "application/json",
    });
    expect(out["x-api-key"]).toBe("***redacted***");
    expect(out.authorization).toBe("Bearer ***redacted***");
    expect(out["content-type"]).toBe("application/json");
  });

  it("redacts inline bearer tokens in arbitrary header values", () => {
    const out = redactHeaders({ cookie: "session=abc; bearer sk-test-1234-abcd" });
    // The matcher preserves the case of the leading word "Bearer" so
    // log readers see a recognisable scheme name regardless of input.
    expect(out.cookie).toBe("session=abc; Bearer ***redacted***");
  });

  it("returns undefined for undefined input", () => {
    expect(redactHeaders(undefined)).toBeUndefined();
  });

  it("does not mutate the input object", () => {
    const original = { authorization: "Bearer sk-test-1234-abcd" };
    redactHeaders(original);
    expect(original.authorization).toBe("Bearer sk-test-1234-abcd");
  });
});

describe("redact: redactAccountShape", () => {
  it("scrubs fields whose name smells like a credential", () => {
    const account = {
      name: "MiniMax",
      apiKey: "sk-test-1234-abcd",
      token: "tk-test-1234-abcd",
      models: [{ id: "x", name: "X" }],
      nested: { password: "p4ss-word-test-1234" },
    };
    expect(redactAccountShape(account)).toEqual({
      name: "MiniMax",
      apiKey: "sk-t…abcd",
      token: "tk-t…abcd",
      models: [{ id: "x", name: "X" }],
      nested: { password: "p4ss…1234" },
    });
  });

  it("leaves unrelated fields intact", () => {
    const out = redactAccountShape({ appType: "claude", bearer: false, name: "ok" });
    expect(out).toEqual({ appType: "claude", bearer: false, name: "ok" });
  });

  it("passes primitives through", () => {
    expect(redactAccountShape(null)).toBeNull();
    expect(redactAccountShape("ok")).toBe("ok");
    expect(redactAccountShape(42)).toBe(42);
  });
});
