// dsh-llm-cc-switch: parser for grokbuild accounts.
//
// CC Switch stores each row's provider config under `settings_config` as
// JSON with `config` holding a TOML string, shaped like:
//
//   models.default = "my-profile"           # chosen profile
//   [model.my-profile]
//   model         = "grok-4.5"              # upstream wire model id
//   base_url      = "https://api.example/v1"
//   name          = "My Profile"
//   api_key       = "..."                   # or env_key
//   api_backend   = "responses" | "chat"    # responses -> openai-responses
//   context_window = 500000
//
// The CC Switch upstream utility (`src/utils/grokBuildConfig.ts`) reads
// the same fields. We don't depend on it; the parser below stays a
// self-contained TOML subset reader so this plugin does not pull in any
// TypeScript runtime.

import { MAX_MODELS_PER_ACCOUNT } from "./index.js";
import { tomlLookup, tomlSection } from "./toml.js";

const PROTOCOL_BY_BACKEND = {
  responses: "openai-responses",
  chat: "openai-completions",
};

const DEFAULT_MODEL = "grok-4.5";
const DEFAULT_CONTEXT_WINDOW = 500000;

function parseInteger(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function parseGrokBuild(cfg) {
  const toml = (cfg && typeof cfg.config === "string" ? cfg.config : "");
  const profileName = tomlLookup(toml, "models.default") ?? DEFAULT_MODEL;
  const selected = tomlSection(toml, `model.${profileName}`);

  // Only direct api_key is consumed; env_key is just a *name* of an
  // environment variable, which the parser cannot resolve on its own.
  // Row stays usable only when api_key is present literally.
  const apiKey = selected.api_key;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;

  const baseURL = typeof selected.base_url === "string" && selected.base_url.length > 0
    ? selected.base_url
    : undefined;
  if (baseURL === undefined) return undefined;

  const apiBackend = String(selected.api_backend ?? "responses").toLowerCase();
  const protocol = PROTOCOL_BY_BACKEND[apiBackend] ?? "openai-responses";

  // grokbuild presents exactly one model per profile — the `models`
  // table maps "default" to the chosen profile, and the profile's
  // `model` field is the actual wire id sent upstream.
  const wire = (typeof selected.model === "string" && selected.model.length > 0)
    ? selected.model
    : DEFAULT_MODEL;
  const displayName = (typeof selected.name === "string" && selected.name.length > 0)
    ? selected.name
    : profileName;
  const contextWindow = parseInteger(selected.context_window) ?? DEFAULT_CONTEXT_WINDOW;

  return {
    protocol,
    baseURL,
    apiKey,
    models: [{
      id: wire,
      name: displayName,
      contextWindow,
    }].slice(0, MAX_MODELS_PER_ACCOUNT),
  };
}
