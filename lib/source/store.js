// dsh-llm-cc-switch: AccountStore interface contract.
//
// Every account source — CC Switch today, env-based or LDAP variants tomorrow —
// is an AccountStore: a live snapshot of `(protocol, baseURL, apiKey, models)`
// tuples, identified by a stable account id and tagged with an app_type that
// maps to a harness route.
//
// This file is the contract. It does not contain the SQLite reader; that lives
// in cc-switch.js. This separation lets `CcSwitchAdapter` (lib/index.js) talk
// to whatever source the install wired up, without caring which one it is.
//
// Schema validation runs at the integration boundary (the LlmConfigurableProvider
// and `dsh-llm-pi-ai` layers), not here — keeping the source layer free of
// `schemastery` lets unit tests load it without that dependency.

/**
 * One usable account, in the shape pi-ai's provider/profile code expects.
 *
 * `appType` decides which harness route it shows up under in DSH
 * (`cc-switch/claude`, `cc-switch/codex`, ...). `protocol` decides which
 * wire API pi-ai dispatches the request through.
 *
 * `apiKey` is the raw key held in CC Switch's settings_config; consumers
 * must redact before logging and route through `assertUsableApiKey` before
 * the request goes out.
 *
 * `accountId` alone is NOT unique: CC Switch stores the same provider row id
 * under more than one `app_type` (`claude` and `claude-desktop` mirror the same
 * UUIDs), so identity is the pair `(appType, accountId)` — spelled `accountKey`
 * below and used for every internal route.
 *
 * @typedef {{
 *   accountId: string,
 *   appType: string,
 *   accountKey: string,
 *   name: string,
 *   protocol: "anthropic-messages" | "openai-completions" | "openai-responses",
 *   baseURL: string,
 *   apiKey: string,
 *   bearer: boolean,
 *   models: Array<{ id: string, name: string, contextWindow?: number }>,
 *   current: boolean,
 * }} Account
 */

/** Separator between an account's app_type and its source id in a key. */
export const ACCOUNT_KEY_SEP = ":";

/**
 * Collision-free store identity for one account row: `<appType>:<accountId>`.
 *
 * CC Switch mirrors the same provider row ids under several app_types, so a
 * bare id can name two different accounts. Picker-facing model ids keep the
 * bare id (it is what CC Switch shows and what existing DSH sessions store);
 * the app_type is recovered from the route, and every internal route that
 * dispatches to exactly one account carries the full key.
 *
 * Accepts an explicit `accountKey` (stores may precompute it) and falls back
 * to composing one from `appType` / `accountId` for store implementations that
 * predate it.
 * @param {{ appType?: string, accountId?: string, accountKey?: string }} account
 * @returns Account key.
 */
export function accountKeyOf(account) {
  if (typeof account?.accountKey === "string" && account.accountKey.length > 0) return account.accountKey;
  const appType = typeof account?.appType === "string" ? account.appType : "";
  const accountId = typeof account?.accountId === "string" ? account.accountId : "";
  return `${appType}${ACCOUNT_KEY_SEP}${accountId}`;
}

/**
 * Split an account key back into its parts.
 * @param key - `<appType>:<accountId>`.
 * @returns Parts, or undefined when the key is malformed.
 */
export function parseAccountKey(key) {
  if (typeof key !== "string") return undefined;
  const at = key.indexOf(ACCOUNT_KEY_SEP);
  if (at <= 0 || at + ACCOUNT_KEY_SEP.length >= key.length) return undefined;
  return {
    appType: key.slice(0, at),
    accountId: key.slice(at + ACCOUNT_KEY_SEP.length),
  };
}

/**
 * A live view of the account set.
 *
 * `accounts()` re-reads the underlying source whenever its stamp changes,
 * so the consumer always sees the latest snapshot. A failing read keeps
 * the previous good snapshot and surfaces the reason via `lastError`.
 *
 * `routes()` enumerates the harness routes the store can currently fill
 * (present app_types, in the order configured).
 */
export class AccountStore {
  /** Snapshot stamp ("" before the first successful read). */
  get stamp() { throw new Error("AccountStore.stamp must be implemented"); }

  /** Most recent read error, or undefined. */
  get lastError() { throw new Error("AccountStore.lastError must be implemented"); }

  /** Resolved path or URL of the underlying source (for log messages). */
  get sourceLocation() { throw new Error("AccountStore.sourceLocation must be implemented"); }

  /** All usable accounts, in display order. Async because the underlying
   *  source may load lazily (e.g. `node:sqlite`). */
  accounts() { throw new Error("AccountStore.accounts() must be implemented"); }

  /** Accounts under one harness. */
  accountsOf(appType) { throw new Error("AccountStore.accountsOf(appType) must be implemented"); }

  /** One account by id; undefined if it vanished this turn. Ambiguous when
   *  the same id exists under several app_types — prefer `accountOf()`. */
  account(accountId) { throw new Error("AccountStore.account(accountId) must be implemented"); }

  /** One account by its unambiguous identity `(appType, accountId)`. */
  accountOf(appType, accountId) { throw new Error("AccountStore.accountOf(appType, accountId) must be implemented"); }

  /** Harness routes to register, in stable order. */
  routes() { throw new Error("AccountStore.routes() must be implemented"); }
}

/** No-op type export so JSDoc-driven tooling (e.g. vsce) can resolve the
 *  `Account` typedef when this file is the only import. */
export const Account = undefined;
