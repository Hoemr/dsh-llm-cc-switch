// dsh-llm-cc-switch: source registry tests.
//
// The runtime registry is the seam `CcSwitchAdapter` uses to pick
// between CC Switch and whatever else an install wires up. Tests here
// pin its contract so it stays swappable.

import { describe, expect, it } from "vitest";

import {
  CcSwitchStore,
  KNOWN_ACCOUNT_SOURCES,
  registerAccountSource,
  resolveAccountSource,
} from "../../lib/source/index.js";

describe("source/registry", () => {
  it("resolves cc-switch by default", () => {
    const store = resolveAccountSource();
    expect(store).toBeInstanceOf(CcSwitchStore);
  });

  it("rejects an unknown source id with a clear error", () => {
    expect(() => resolveAccountSource("does-not-exist")).toThrow(/Unknown account source/);
  });

  it("lets callers register a new source and resolve it", () => {
    registerAccountSource("test-mock", () => ({
      stamp: "test",
      accounts: () => [],
      accountsOf: () => [],
      account: () => undefined,
      routes: () => [],
      sourceLocation: "<test>",
      lastError: undefined,
    }));
    const store = resolveAccountSource("test-mock", {});
    expect(store.stamp).toBe("test");
    expect(store.accounts()).toEqual([]);
    expect(store.routes()).toEqual([]);
  });

  it("rejects an invalid factory at registration time", () => {
    expect(() => registerAccountSource("", () => ({}))).toThrow();
    expect(() => registerAccountSource("nope", null)).toThrow();
  });

  it("lists KNOWN_ACCOUNT_SOURCES as a frozen array", () => {
    expect(KNOWN_ACCOUNT_SOURCES).toContain("cc-switch");
    expect(() => KNOWN_ACCOUNT_SOURCES.push("nope")).toThrow();
  });
});
