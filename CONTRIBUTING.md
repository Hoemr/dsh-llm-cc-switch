# Contributing to dsh-llm-cc-switch

Thanks for taking an interest! This plugin is a thin bridge between DSH
([DeepSeek Harness](https://github.com/deepseek-ai/dsh)) and
[farion1231/cc-switch](https://github.com/farion1231/cc-switch), so
useful contributions fall into a few buckets.

## What this repo is

`lib/source/` contains the **account source layer**:
- `store.js` — the `AccountStore` interface contract.
- `url.js` / `redact.js` — security helpers (baseURL allowlist,
  header / log redaction).
- `parsers/` — one parser per CC Switch `app_type`
  (`claude`, `claude-desktop`, `codex`, `opencode`, `grokbuild`).
- `cc-switch.js` — the SQLite-backed `CcSwitchStore` implementation
  that pulls rows, runs each through its parser, and applies the
  allowlist.
- `db.js` — the lazy `node:sqlite` loader that hides the
  experimental built-in from bundlers / test runners.
- `index.js` — the runtime registry
  (`registerAccountSource(name, factory)` /
  `resolveAccountSource(name, config)`); the default registration is
  `cc-switch`.

`lib/index.js` registers a `LlmAdapter` for DSH that delegates the
heavy lifting — wire protocols, streaming, tool calls, replay, image
policy — to the DSH-built generic adapter
`@deepseek-ai/dsh-llm-pi-ai`. It picks the store through the registry,
so swapping CC Switch for a different source is a config change.

`lib/source.js` is a thin shim that re-exports from `lib/source/`,
kept for callers that pinned the old path.

## How to set up a dev environment

```sh
git clone https://github.com/Hoemr/dsh-llm-cc-switch
cd dsh-llm-cc-switch
npm install
```

Then point one of your DSH profiles at this checkout:

```jsonc
// ~/.dsh/profiles/<name>/package.json
{
  "dependencies": {
    "dsh-llm-cc-switch": "file:../../path/to/dsh-llm-cc-switch"
  },
  "dsh": {
    "profile": {
      "bundles": [
        { "patch": "node_modules/dsh-llm-cc-switch/cordis.patch.yml" }
      ]
    }
  }
}
```

Restart DSH after changing the bundle; subsequent edits in CC Switch
are picked up live.

## Test surface

```sh
npm run test:all          # vitest + node --test integration
npm test                  # vitest only (parsers, allowlist, redact, registry)
npm run test:integration  # node --experimental-sqlite, real DB
npm run test:watch        # vitest --watch
```

`node:sqlite` requires `node --experimental-sqlite` on Node 22; the
integration script (`scripts/run-integration.mjs`) sets that flag, so
`npm run test:integration` works without further setup.

The two suites cover disjoint ground:
- **vitest** — schema / format invariants on JSON fixtures
  (`test/source/**/*.{vitest,parsers/}*.test.js`).
- **integration** — readOnly open, stamp cache, allowlist filtering,
  missing-file errors against a real SQLite database.

## Issue workflow

- **Bugs** — please include your DSH version (`dsh --version`), OS, the
  Node version (`node --version` ≥ 22.19), and the relevant slice of
  `~/.cc-switch/cc-switch.db` (a redacted
  `SELECT id, app_type, name FROM providers` is plenty).
- **New harness support** — open an issue first. We want to confirm the
  upstream CC Switch schema before adding a parser. Unsupported today:
  `gemini`, `hermes`, `openclaw`, `pi`. The `settings_config` JSON
  shape for these is not yet stable upstream.
- **Security / disclosure** — `weichen.work@qq.com` (see
  `SECURITY.md`). Don't open a public issue.

## Pull requests

- One topic per PR; small and reviewable is the goal.
- Run `node --check` on every JS file under `lib/` before pushing.
- Run `npm run test:all` (vitest + SQLite integration) before
  pushing.
- Update `CHANGELOG.md` under the `[Unreleased]` header in the same
  PR that changes behaviour.
- Don't commit `node_modules/`, real API keys, or anything from
  `~/.cc-switch/`.

## Coding conventions

- ESM, `node:`-prefixed built-ins, `"use strict"` is implicit in
  modules.
- **Parse, don't validate.** Parser functions return `undefined` for
  unusable rows; they do not throw. A row that fails to parse is
  dropped, not crash.
- **The DB is opened `readOnly` for a reason** — never write to CC
  Switch's database from this plugin.
- **No secrets in logs.** Use `redactUrl` / `redactKey` /
  `redactHeaders` / `redactAccountShape` for anything going to
  `ctx.logger`. The `**redacted**` placeholder is intentional — it
  tells the reader something *was* there.
- New `app_type` support:
  1. Add `parsers/<name>.js` exporting `<name>AppType` shape
     (`{ protocol, baseURL, apiKey, models } | undefined`).
  2. Register in `parsers/index.js` (`PARSERS[name] = <name>AppType`).
  3. Add the type to `APP_DISPLAY` and `DEFAULT_APP_TYPES`.
  4. Add at least three parse-good fixtures to a vitest file
     (`test/source/parsers/<name>.test.vitest.test.js`) and one
     entry to the integration fixture in
     `test/source/cc-switch.integration.test.js`.
  5. Run `npm run test:all`.

## Releases

- Versions follow semver.
- Tags are `vX.Y.Z`. The release body is the matching `CHANGELOG.md`
  section under the bumped version header.
