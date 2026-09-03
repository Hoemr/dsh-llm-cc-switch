# Security Policy

This plugin **does not store or transmit any API keys**: it reads the keys
already on your machine in `~/.cc-switch/cc-switch.db` (placed there by the
[CC Switch](https://github.com/farion1231/cc-switch) desktop app) and hands
them straight to the configured provider base URL for each request.

That said, because the plugin sits on a path between your secrets and the
network, we treat it as security-sensitive.

## What this repo will never contain

- Real `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `tp-…` token-plan keys,
  or any other secret material.
- `cc-switch.db` or `settings.json` files exported from a real install.
- `.env` files, PEMs, or other credential blobs (the `.gitignore`
  enforces this).

If you accidentally commit a real key, **rotate that key first**, then
open a private disclosure — see the next section. A leaked key in history
is forever a leaked key, even after rewrite.

## Reporting a vulnerability

Please email **`security@hoemr.dev`** (PGP key on request). Don't open a
public GitHub issue for suspected vulnerabilities — you'll get a private
ack within 72 hours and a fix or mitigation plan before any public
disclosure.

For non-sensitive bugs, please open a regular issue.

## Threat model in scope

- A malicious or malformed `cc-switch.db` causing the adapter to fan out
  requests to unexpected hosts.
- A provider row whose `baseURL` points to an attacker-controlled host
  with the user's real key in the `Authorization` header.
- Resource exhaustion (huge model lists, runaway streams).

Defenses in place:

- `baseURL`s are passed through `URL`/`pi-ai` and the stream client;
  account entries that fail parsing are skipped (`undefined` return).
- Models-per-account is clamped (`MAX_MODELS_PER_ACCOUNT = 16`).
- `LlmAdapter.assertUsableApiKey` rejects empty / placeholder keys before
  any request goes out.
- The DB is opened with `readOnly: true`; this plugin never writes to it.
