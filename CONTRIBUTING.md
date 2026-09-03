# Contributing to dsh-llm-cc-switch

Thanks for taking an interest! This plugin is a thin bridge between DSH
([DeepSeek Harness](https://github.com/deepseek-ai/dsh)) and
[farion1231/cc-switch](https://github.com/farion1231/cc-switch), so most
useful contributions fall into one of three buckets.

## What this repo is

`lib/source.js` reads the CC Switch SQLite database and turns each
provider row into a `(protocol, baseURL, apiKey, models)` tuple.

`lib/index.js` registers a `LlmAdapter` for DSH that delegates the heavy
lifting — wire protocols, streaming, tool calls, replay, image policy — to
the DSH-built generic adapter `@deepseek-ai/dsh-llm-pi-ai`.

Anything you can already do in CC Switch should *just work* the next time
DSH lists models or fires a request — no DSH restart required.

## How to set up a dev environment

```sh
git clone https://github.com/Hoemr/dsh-llm-cc-switch
cd dsh-llm-cc-switch
pnpm install   # or npm install
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

Restart DSH after changing the bundle; subsequent edits in CC Switch are
picked up live.

## Issue workflow

- **Bugs** — please include your DSH version (`dsh --version`), OS, and
  the relevant slice of `~/.cc-switch/cc-switch.db` (a redacted
  `SELECT id, app_type, name FROM providers` is enough).
- **New harness support** — open an issue first. We want to confirm the
  upstream CC Switch schema before adding a parser.
- **Feature requests** — describe the user-visible behaviour, not the
  implementation.

## Pull requests

- One topic per PR; small and reviewable is the goal.
- Run `node --check lib/index.js && node --check lib/source.js` before
  pushing.
- Update `CHANGELOG.md` under the `[Unreleased]` header in the same PR
  that changes behaviour.
- Don't commit `node_modules/`, real API keys, or anything from
  `~/.cc-switch/`.

## Coding conventions

- ESM, `node:`-prefixed builtins, `"use strict"` is implicit in modules.
- Parse-don't-validate: parser functions in `source.js` return
  `undefined` for unusable rows; they do not throw.
- The DB is opened `readOnly` for a reason — never write to CC Switch's
  database from here.

## Releases

- Versions follow semver.
- Tags are `vX.Y.Z`. The release body is the matching `CHANGELOG.md`
  section.
