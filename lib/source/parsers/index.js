// dsh-llm-cc-switch: parser registry.
//
// One parser per `app_type` cc-switch writes to the providers table.
// Each parser takes the JSON inside `settings_config` and returns:
//
//   { protocol, baseURL, apiKey, models: [{ id, name, contextWindow? }] }
//
// …or `undefined` for unusable rows (the store skips those and notes
// the reason in a warning). The shape mirrors what `@deepseek-ai/dsh-
// llm-pi-ai` expects when building providers.

import { parseClaude } from "./claude.js";
import { parseCodex } from "./codex.js";
import { parseGrokBuild } from "./grokbuild.js";
import { parseOpenCode } from "./opencode.js";

/**
 * Cap models per account — sanity bound only; cc-switch itself doesn't
 * surface accounts with that many models. Useless / pathological rows
 * are still loaded into the picker, which is what this guards against.
 */
export const MAX_MODELS_PER_ACCOUNT = 16;

/**
 * Parser map keyed by `providers.app_type`. Adding a new harness means
 * writing one file in this directory and registering the parser here.
 */
export const PARSERS = Object.freeze({
  claude: parseClaude,
  "claude-desktop": parseClaude,
  codex: parseCodex,
  grokbuild: parseGrokBuild,
  opencode: parseOpenCode,
});
