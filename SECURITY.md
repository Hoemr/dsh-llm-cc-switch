# Security Policy

This plugin **does not store or transmit any API keys**: it reads the
keys already on your machine in `~/.cc-switch/cc-switch.db` (placed
there by the [CC Switch](https://github.com/farion1231/cc-switch)
desktop app) and hands them straight to the configured provider
baseURL for each request.

That said, because the plugin sits on a path between your secrets and
the network, we treat it as security-sensitive.

## What this repo will never contain

- Real `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `tp-…` token-plan
  keys, or any other secret material.
- `cc-switch.db` or `settings.json` files exported from a real
  install.
- `.env` files, PEMs, or other credential blobs (the `.gitignore`
  enforces this).
- Test fixtures that use real-looking **prefix + suffix** matches as
  their only secret ("sk-test", "tp-abcd-1234-5678"). Every
  integration-test credential is a stand-in (`sk-test-...`) with
  characters chosen so no plausible real key matches it.

If you accidentally commit a real key, **rotate that key first**, then
open a private disclosure — see the next section. A leaked key in
history is forever a leaked key, even after rewrite.

## Reporting a vulnerability

Please email **`security@hoemr.dev`** (PGP key on request). Don't
open a public GitHub issue for suspected vulnerabilities — you'll get
a private ack within 72 hours and a fix or mitigation plan before any
public disclosure.

For non-sensitive bugs, please open a regular issue.

## Threat model in scope

| Threat | Defense |
|---|---|
| A row in `cc-switch.db` whose `baseURL` points at an attacker-controlled host with the user's real key in the `Authorization` header. | **`urlAllowlist`** — every baseURL goes through `allowBaseUrl()` before the row reaches pi-ai. Defaults to `http | https | ws | wss`; host suffix list is optional and additive. Rows that fail the check are dropped. |
| A future bundle / patch accidentally logging headers, baseURL, or api keys. | **Redaction helpers** — `redactKey`, `redactHeaders`, `redactAccountShape`. All `ctx.logger.warn` flows go through them. `Authorization`, `x-api-key`, `api-key`, `proxy-authorization` get the `***redacted***` placeholder; inline `Bearer …` strings collapse to `Bearer ***redacted***`. |
| A future bundle / patch introducing a credential-shaped JSON field that isn't caught by redaction. | **Defense in depth** — `redactAccountShape` walks one level deep on `apiKey | token | secret | password | key` shape names. Adding a new credential field requires opting out, not opting in. |
| Runaway model lists / resource exhaustion. | `MAX_MODELS_PER_ACCOUNT = 16` clamp in every parser. |
| Empty / placeholder keys leaking through to a real upstream. | `LlmAdapter.assertUsableApiKey` rejects empty / placeholder keys before any request goes out. |
| The DB being written to from this plugin. | DB opened with `readOnly: true`. The plugin never writes to it; the integration test enforces this with no `INSERT|UPDATE|DELETE` SQL in any test path. |
| A new harness parser being added with no schema ground truth. | `README.md` flags `gemini`, `hermes`, `openclaw`, `pi` as **not yet supported**; `CONTRIBUTING.md` requires an upstream issue before adding a parser. |
| A credential-shaped string appearing in CHANGELOG / docstrings / test logs. | `gitleaks protect --staged` runs in CI on every push. Local devs can run it before pushing — see `README.md` development section. |

## Defense layers (in evaluation order)

1. **Parser rejection** — every `parsers/<app>.js` returns `undefined`
   for rows that fail shape validation; the store skips them with a
   warning that names the row + reason, never the credential.
2. **`urlAllowlist`** — see above.
3. **Adapter-level redaction** — `apply()` and warn lines use
   `redactAccountShape` on whatever object carries the error /
   context. The baseURL passes through `redactUrl()` before it can be
   logged.
4. **`LlmAdapter.assertUsableApiKey`** — last-mile guard before
   pi-ai sees the key.
5. **No local cache of keys** — the store keeps `(accountId,
   protocol, baseURL, models)` but the raw `apiKey` does not outlive
   the request to pi-ai; the only place it is held between requests
   is the in-memory `CcSwitchStore.#cached`. The integration test
   has tests for this if you want to verify.

## What the consumer can do

- Pin the `urlAllowlist.hosts` to your real upstream's host suffix
  when you only ever talk to one provider — anything else is rejected
  before it leaves your machine.
- Don't share `~/.cc-switch/cc-switch.db` with parties you wouldn't
  share your raw provider keys with; this plugin will read every row
  it finds, and the redactors only run against its own log output.
- Run `gitleaks protect --staged` before pushing — installs in <30s
  with Homebrew / WinGet; gives you a free pre-`git push` guard.
