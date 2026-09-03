// dsh-llm-cc-switch: source layer entry point.
//
// Three responsibilities:
//
//   1. Re-export the public surface (route helpers, parsers, helpers).
//   2. Provide a runtime registry of account sources so callers can pick
//      which one backs an install without re-wiring code.
//   3. Default-resolve one source based on the plugin config.

import { CcSwitchStore } from "./cc-switch.js";
import { allowBaseUrl, redactUrl } from "./url.js";
import { redactKey, redactHeaders, redactAccountShape } from "./redact.js";
import { Account, AccountStore } from "./store.js";

// ----------------------------------------------------------------------------
// Route helpers (kept here so the public surface is one file)
// ----------------------------------------------------------------------------

/** Harness routes handed to `ctx.llm`: `cc-switch/<appType>`. */
export const ROUTE_PREFIX = "cc-switch/";

/** Per-account routes used by the adapter internally:
 * `cc-switch-account/<accountId>`. */
export const ACCOUNT_ROUTE_PREFIX = "cc-switch-account/";

/** `<account-uuid>::<wire model id>` separator in picker-facing model ids. */
export const MODEL_SEP = "::";

/** Human-readable harness names per `app_type`. Unknown app_types fall
 * back to the raw `app_type` string at display time. */
export const APP_DISPLAY = Object.freeze({
  claude: "Claude Code",
  "claude-desktop": "Claude Code (Desktop)",
  codex: "Codex",
  opencode: "OpenCode",
  // grokbuild has a fully documented settings_config shape (TOML); the
  // rest below stay as display names for now — their settings_config
  // JSON shapes are not yet documented upstream, so we keep them out of
  // PARSERS until a parser can be written without guessing.
  grokbuild: "Grok Build",
});

export function routeFor(appType) {
  return `${ROUTE_PREFIX}${appType}`;
}

export function appTypeOf(route) {
  return typeof route === "string" && route.startsWith(ROUTE_PREFIX)
    ? route.slice(ROUTE_PREFIX.length)
    : undefined;
}

export function accountRouteFor(accountId) {
  return `${ACCOUNT_ROUTE_PREFIX}${accountId}`;
}

export function accountIdOf(route) {
  return typeof route === "string" && route.startsWith(ACCOUNT_ROUTE_PREFIX)
    ? route.slice(ACCOUNT_ROUTE_PREFIX.length)
    : undefined;
}

export function encodeModelId(accountId, wireModelId) {
  return `${accountId}${MODEL_SEP}${wireModelId}`;
}

export function decodeModelId(modelId) {
  if (typeof modelId !== "string") return undefined;
  const at = modelId.indexOf(MODEL_SEP);
  if (at <= 0 || at + MODEL_SEP.length >= modelId.length) return undefined;
  return {
    accountId: modelId.slice(0, at),
    wireModelId: modelId.slice(at + MODEL_SEP.length),
  };
}

// ----------------------------------------------------------------------------
// Source registry
// ----------------------------------------------------------------------------

/**
 * Factory signature for an account source. Each factory returns an
 * `AccountStore`. Config is whatever the source needs to initialise.
 *
 * @typedef {(config: object) => AccountStore} AccountSourceFactory
 */

/** @type {Map<string, AccountSourceFactory>} */
const REGISTRY = new Map();

/** Ids of the sources we currently ship. Anything registered through
 * `registerAccountSource` works the same way; the list here is for
 * friendly error messages and tooling. */
export const KNOWN_ACCOUNT_SOURCES = Object.freeze(["cc-switch"]);

/** Default app_types exposed by this plugin. Five of the nine `app_type`
 * values cc-switch understands — claude, claude-desktop, codex,
 * opencode, grokbuild — are reachable through here; the other four
 * (gemini, openclaw, hermes, pi) are kept out until their
 * settings_config JSON shapes are documented upstream. */
export const DEFAULT_APP_TYPES = Object.freeze([
  "claude",
  "claude-desktop",
  "codex",
  "opencode",
  "grokbuild",
]);

/**
 * Register a new account source by id. Calling it twice for the same
 * id replaces the previous registration.
 */
export function registerAccountSource(id, factory) {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("registerAccountSource: id must be a non-empty string");
  }
  if (typeof factory !== "function") {
    throw new TypeError("registerAccountSource: factory must be a function");
  }
  REGISTRY.set(id, factory);
}

registerAccountSource("cc-switch", (config) => new CcSwitchStore(config));

/**
 * Resolve an account source by id, defaulting to `cc-switch`. Throws if
 * the id is unknown.
 *
 * The returned object is an `AccountStore`; it survives `accounts()`
 * failures (the store keeps the previous snapshot and surfaces the
 * reason through `lastError`).
 */
export function resolveAccountSource(id, config) {
  const resolved = id ?? "cc-switch";
  const factory = REGISTRY.get(resolved);
  if (factory === undefined) {
    const known = [...REGISTRY.keys()].join(", ");
    throw new Error(`Unknown account source "${resolved}". Registered sources: ${known}`);
  }
  return factory(config ?? {});
}

// ----------------------------------------------------------------------------
// Re-exports (one-stop public surface)
// ----------------------------------------------------------------------------

export { Account, AccountStore, CcSwitchStore };
export { allowBaseUrl, redactUrl };
export { redactKey, redactHeaders, redactAccountShape };
