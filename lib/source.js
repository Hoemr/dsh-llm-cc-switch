// dsh-llm-cc-switch: backwards-compatible shim for the source layer.
//
// All real implementation lives under `lib/source/`. This file keeps the
// historical `./source` export working so the existing `lib/index.js`
// import lines (and any downstream consumer pinned to the old path) keep
// resolving without a code change.
//
// The internal layout is:
//
//   lib/source/store.js       — AccountStore contract + Account shape
//   lib/source/url.js         — baseURL allowlist helper
//   lib/source/redact.js      — log/header redaction helpers
//   lib/source/cc-switch.js   — CcSwitchStore (reads cc-switch.db)
//   lib/source/parsers/       — per-app_type settings_config parsers
//   lib/source/index.js       — runtime source selector (default: cc-switch)
//
// Anything you previously imported from `./source.js` is re-exported here.

export {
  APP_DISPLAY,
  ROUTE_PREFIX,
  ACCOUNT_ROUTE_PREFIX,
  MODEL_SEP,
  routeFor,
  appTypeOf,
  accountRouteFor,
  accountIdOf,
  encodeModelId,
  decodeModelId,
  // Source interface + implementations:
  AccountStore,
  Account,
  CcSwitchStore,
  allowBaseUrl,
  redactUrl,
  redactKey,
  redactHeaders,
  redactAccountShape,
  // Runtime source selector:
  resolveAccountSource,
  registerAccountSource,
  KNOWN_ACCOUNT_SOURCES,
} from "./source/index.js";
