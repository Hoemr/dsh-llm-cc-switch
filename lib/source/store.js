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
 * @typedef {{
 *   accountId: string,
 *   appType: string,
 *   name: string,
 *   protocol: "anthropic-messages" | "openai-completions" | "openai-responses",
 *   baseURL: string,
 *   apiKey: string,
 *   bearer: boolean,
 *   models: Array<{ id: string, name: string, contextWindow?: number }>,
 *   current: boolean,
 * }} Account
 */

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

  /** One account by id; undefined if it vanished this turn. */
  account(accountId) { throw new Error("AccountStore.account(accountId) must be implemented"); }

  /** Harness routes to register, in stable order. */
  routes() { throw new Error("AccountStore.routes() must be implemented"); }
}

/** No-op type export so JSDoc-driven tooling (e.g. vsce) can resolve the
 *  `Account` typedef when this file is the only import. */
export const Account = undefined;
