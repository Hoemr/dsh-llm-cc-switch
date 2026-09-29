# Changelog

All notable changes to **dsh-llm-cc-switch** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-09-30

### Changed
- **Verified against DeepSeek Harness 0.2.0-rc.2 / DSH Desktop 0.2.0-rc.2.** The
  0.2.0 line ships `@deepseek-ai/dsh-llm` 0.2.0-rc.2 and
  `@deepseek-ai/dsh-llm-pi-ai` 0.2.0-rc.2 with `@earendil-works/pi-ai` 0.87.1;
  the adapter seam (`LlmAdapter` `providerInfo` / `listModels` / `resolveModel` /
  `prepareCall` / `stream`), the `ResolvedPiAiProviderProfile` shape
  (`modelErrors`, `configuredMaxTokens`, `retryPolicy`, `piProvider`,
  `headers`), and the `PiAiAdapter` constructor config (`profiles`,
  `resolveApiKey`, `auth`, `resolveAttachments`, `onReplayDegrade`) are
  unchanged between `0.1.5-rc.3` and `0.2.0-rc.2`, so no adapter code change was
  needed — the peer ranges now name the wider verified line
  (`@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-llm-pi-ai`: `>=0.1.5-rc.3
  <0.3.0-0`; `@earendil-works/pi-ai`: `>=0.85.1 <0.88.0-0`).
  The previous `^0.85.1` pi-ai range did not admit the 0.87.1 build that
  0.2.0-rc.2 installs, and `<0.2.0-0` on the harness packages excluded the whole
  0.2.0 line — which the 0.2.0 boot loader's plugin compatibility gate
  (`evaluatePluginCompatibility`, every `@deepseek-ai/dsh*` peer checked against
  the running runtime with prereleases included) reads as "profile startup
  denies it", not as a warning only.
- The harness packages are now devDependencies so the adapter seam tests
  (`test/adapter/`) run from a plain `npm install` instead of requiring an
  installed DSH to resolve the peers.

### Verified
- 68 vitest + 7 `node:test` integration cases pass against the real
  0.2.0-rc.2 packages.
- `CcSwitchAdapter` mounted on the real `LlmRuntime` reports the three routes
  and 19 models of a live `cc-switch.db`, and live `stream()` calls on
  `cc-switch/codex` (`openai-responses`) and `cc-switch/claude`
  (`anthropic-messages`, OpenCode Go host → `x-opencode-session`) both returned
  a completion.

## [0.3.0] — 2026-09-23

### Added
- **OpenCode Go / Zen session headers.** Since 2026-09-06 `opencode.ai`
  rejects requests that carry no stable per-conversation session id
  (`400 MissingSessionID`), and it accepts that id only under
  `x-opencode-session`, `session_id`, or `x-session-id`. The pi-ai seam's own
  session-affinity feature emits `x-session-affinity` on the Anthropic
  transport (which OpenCode does not accept), and DSH sends no session header
  at all on the pi-ai adapter path (upstream: [deepseek-harness discussion
  #5495](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)), so
  every OpenCode Go account bridged by this plugin failed on its first request
  while still listing models normally.
  Accounts whose `baseURL` host matches `opencodeSession.hosts` (default
  `["opencode.ai"]`, subdomains included) now carry
  `opencodeSession.header` (default `x-opencode-session`), valued with the DSH
  session id when the harness supplies one and a stable per-adapter id
  otherwise; `opencodeSession.enabled: false` restores the previous behaviour.
  Measured against `https://opencode.ai/zen/go/v1/messages`: with the header
  `200`, without it `400`.
- `test/adapter/opencode-session.vitest.test.js` captures the outgoing request
  by stubbing `globalThis.fetch`, so it covers the header surviving the pi-ai
  profile/options merge, the fallback id, and the disabled/custom-host cases.

### Changed
- `prepareCall()` no longer reuses `PiAiAdapter`'s frozen profile snapshot: the
  session id the OpenCode header needs only arrives with
  `GenerateOptions.sessionId` at dispatch time. The snapshot is now taken per
  dispatch, which is consistent with this adapter reading live state everywhere
  else. Model metadata is still resolved once, at prepare time.

## [0.2.2] — 2026-09-23

### Fixed
- **Every request failed against DeepSeek Harness `0.1.5-rc.3`.** The profile
  this adapter synthesizes for `PiAiAdapter` omitted `modelErrors`, which the
  0.1.5 seam reads unconditionally in `modelOf()` before it consults the model
  collection. Listing a category still looked healthy (`listModels()` never
  touches that field), but the first `resolveModel()` / `prepareCall()` /
  `stream()` on any account threw
  `TypeError: Cannot read properties of undefined (reading 'get')` — so the
  routes registered and then failed on use. Profiles now carry an empty
  `ReadonlyMap`, the correct value for an account that resolved cleanly.
- **Resolved picker labels lost their context/protocol tail.**
  `LlmResolvedModelInfo.context` is `{ contextWindow }` rather than a bare
  number, so passing it straight to `formatContext()` yielded `undefined` and
  `resolveModel()` returned `<account> · <model>` where `listModels()` returned
  `<account> · <model>  [200k · anthropic]`. The adapter now reads
  `info.context?.contextWindow`.
- **Profiles now declare a resolved `retryPolicy`.** `ResolvedPiAiProviderProfile`
  types that field as a materialized policy, not an optional config block, so
  the adapter passes `resolveRetryPolicy(undefined, …)`. Behaviour is unchanged:
  `providerRetryPolicy()` still answers `undefined`, i.e. the seam's normal
  five-retry default.
- Peer ranges now name the harness line this build is verified against
  (`@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-llm-pi-ai`: `>=0.1.5-rc.3
  <0.2.0-0`; `@earendil-works/pi-ai`: `^0.85.1`).

## [0.2.1] — 2026-09-08

### Fixed
- **Boot failure against DeepSeek Harness `0.1.2-rc.1` / DSH Desktop 2.0.5.**
  The `urlAllowlist` schema used `z.array(z.string()).optional()`, which the
  current `@deepseek-ai/schemastery` (3.18.x) does not implement — the plugin
  threw `TypeError: z.array(...).optional is not a function` at import time,
  so the loader entry `cc-switch` failed and took the whole plugin tree down
  with it. Both fields now use `.default(undefined)`, which clears the `[]`
  default `z.array()` injects and therefore keeps the documented "omitted =
  use the built-in scheme set / any host" behavior instead of turning an
  omitted field into a closed allowlist that rejects every baseURL.
- Peer ranges now name the harness line this build is verified against
  (`@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-llm-pi-ai`: `>=0.1.2-rc.1
  <0.2.0-0`). The adapter reaches into `PiAiAdapter`'s profile shape, so the
  old open-ended ranges over-claimed compatibility.

## [0.2.0] — 2026-09-03

### Added
- **`grokbuild` harness parser.** Reads the `models.default` +
  `[model.<profile>]` TOML CC Switch writes for Grok Build, including
  `api_backend = responses | chat` and `context_window = <integer>`.
  Wire protocol (`openai-responses` / `openai-completions`) chosen per
  row.
- **Pluggable `AccountStore` interface.** New `lib/source/` with
  `store.js` defining the contract, `cc-switch.js` implementing it,
  and a runtime registry (`registerAccountSource` /
  `resolveAccountSource`) so an install can point at CC Switch or any
  future source (env, LDAP, ...) without touching this plugin's code.
- **baseURL allowlist.** `urlAllowlist: { schemes?, hosts? }` in the
  patch config; defaults to `http | https | ws | wss` schemes, no host
  restriction. Rows whose `baseURL` fails the check are dropped
  before they reach pi-ai.
- **Log/header redaction helpers.** `redactKey` (`first4…last4`),
  `redactHeaders` (replaces `Authorization` / `x-api-key` /
  `proxy-authorization` and inline `Bearer …` strings with
  `***redacted***`), `redactAccountShape` (walks one level deep and
  scrubs `apiKey` / `token` / `secret` / `password` / `key`). Adapter
  warn lines flow through `redactAccountShape` so secrets cannot leak
  via diagnostics.
- **Picker row labels.** `<account> · <model>  [<ctx>] · <protocol>`,
  e.g. `MiniMax · claude-opus-4  [200k] · anthropic`. Context window
  is human-readable (`200000 → "200k"`, `1000000 → "1M"`).
- **Tests.** `npm test` runs 56 vitest cases (parsers, allowlist,
  redact, registry); `npm run test:integration` runs 7 `node --test`
  cases against a real SQLite fixture under `--experimental-sqlite`;
  `npm run test:all` runs both.
- **`scripts/run-integration.mjs`** forks `node` with the SQLite flag
  so the integration suite stays runnable from npm scripts on every
  platform CI supports.
- **Lazy `node:sqlite` loader.** A `loadDatabaseSync` factory hides
  the `node:sqlite` built-in behind a dynamic import so vite-node's
  pre-bundle pass does not blow up on the static spec.
- **`gitleaks` allowlist.** `.gitleaks.toml` whitelists placeholder
  credentials in `test/` fixtures and the `***redacted***` token used
  by redaction helpers / docs.
- **Maintainer metadata.** `package.json` author / repository / bugs /
  homepage / keywords wired up; `README.md` gains GitHub / npm / Node
  / License / Maintainer badges.

### Changed
- **Peer-range widening.** `@deepseek-ai/dsh-llm` and
  `@deepseek-ai/dsh-llm-pi-ai` are pinned to
  `">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0"`, which opts in to
  prereleases of those packages across the lifetime of the 0.1.x
  harness (a narrower `^0.1.1-rc.2` had to be widened to match what
  cc-switch upstream ships today).
- **`accounts()` / `routes()` / `account()` are now async.** The
  sqlite loader is lazy, so the first call awaits an import; the
  adapter pre-warms its profile cache at construction so pi-ai's
  sync `profiles()` callback always sees the latest snapshot.
- **`apply()` is now async.** Cordis tolerates async apply
  functions, but the call site that resolves `adapter.store` had to
  gain a getter so the closure can introspect `lastError` /
  `sourceLocation` without changing visibility.
- **`lib/source.js` is now a shim.** Real code lives under
  `lib/source/`; the shim keeps the historical `./source` export so
  `lib/index.js` (and any pin to the old path) keeps working.
- **`APP_DISPLAY` shrunk to five entries.** `gemini`, `hermes`,
  `openclaw`, `pi` moved out of the default `appTypes` until their
  `settings_config` JSON shapes are stable upstream.

### Security
- The three new defenses (allowlist, redact helpers, lazy loader that
  does not embed raw keys on disk) are documented in `SECURITY.md`.

## [0.1.0] — 2026-01-12

### Added
- Initial public release.
- `cc-switch/<harness>` provider routes; every CC Switch harness with
  at least one API-key account becomes a picker category in DSH.
- Live re-read of `~/.cc-switch/cc-switch.db` on every operation
  (mtime/size-cached), so account edits reach DSH without a restart.
- Reuses the DSH-built generic adapter `@deepseek-ai/dsh-llm-pi-ai`.
- Per-prefix `Authorization: Bearer` auth for `tp-`-style token-plan
  accounts.

### Known limitations (carried forward)
- API-key accounts only; Codex ChatGPT OAuth and Claude official-login
  accounts are skipped.
- Adding a *new* harness type in CC Switch still requires a DSH
  restart to register a category (existing accounts refresh live).
- Text-only modalities; image input is not yet declared per model.
