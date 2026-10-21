// dsh-llm-cc-switch: account identity helpers.
//
// CC Switch's `providers` table is keyed by `(id, app_type)`, and a provider
// mirrored into the Claude Code Desktop harness is stored as a second row with
// the same UUID. Everything that dispatches to one account therefore routes by
// `accountKey = "<appType>:<accountId>"`; these tests pin the helpers that
// compose and split that key.

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_KEY_SEP,
  accountKeyOf,
  parseAccountKey,
} from "../../lib/source/index.js";

describe("source/account key", () => {
  it("composes a key from appType and accountId", () => {
    expect(accountKeyOf({ appType: "claude", accountId: "abc" })).toBe(`claude${ACCOUNT_KEY_SEP}abc`);
    expect(accountKeyOf({ appType: "claude-desktop", accountId: "abc" }))
      .toBe(`claude-desktop${ACCOUNT_KEY_SEP}abc`);
  });

  it("prefers a store-provided accountKey", () => {
    expect(accountKeyOf({ appType: "claude", accountId: "abc", accountKey: "explicit" })).toBe("explicit");
  });

  it("keeps mirrored ids apart", () => {
    const cli = accountKeyOf({ appType: "claude", accountId: "same-uuid" });
    const desktop = accountKeyOf({ appType: "claude-desktop", accountId: "same-uuid" });
    expect(cli).not.toBe(desktop);
  });

  it("splits a key back into its parts", () => {
    expect(parseAccountKey("claude-desktop:same-uuid"))
      .toEqual({ appType: "claude-desktop", accountId: "same-uuid" });
  });

  it("rejects malformed keys", () => {
    for (const key of [undefined, null, 42, "", "claude", ":abc", "claude:", ":"]) {
      expect(parseAccountKey(key)).toBeUndefined();
    }
  });
});
