# Changelog

All notable changes to **dsh-llm-cc-switch** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
