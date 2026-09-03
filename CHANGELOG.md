# Changelog

All notable changes to **dsh-llm-cc-switch** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-01-12

### Added
- Initial public release.
- `cc-switch/<harness>` provider routes: every CC Switch harness with at
  least one API-key account becomes a picker category in DSH.
- Accounts become models under their harness category, listed as
  `<account name> · <model name>`, with stable ids
  `<account-uuid>::<wire model id>`.
- Live re-read of `~/.cc-switch/cc-switch.db` on every model listing or
  LLM request (mtime/size-cached), so account edits in CC Switch reach
  DSH without a restart.
- Reuses the DSH-built generic adapter `@deepseek-ai/dsh-llm-pi-ai`, so
  streaming, tool calls, retries, and image policy match the official
  adapters.
- Per-prefix `Authorization: Bearer` auth for `tp-`-style token-plan
  accounts (configurable via `bearerAuthPrefixes`).

### Known limitations (carried forward)
- API-key accounts only; Codex ChatGPT OAuth and Claude official-login
  accounts are skipped.
- Adding a *new* harness type in CC Switch still requires a DSH restart
  to register a category (existing accounts/models still refresh live).
- Text-only modalities; image input is not yet declared per model.
