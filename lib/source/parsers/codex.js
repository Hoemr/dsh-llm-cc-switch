// dsh-llm-cc-switch: parser for codex accounts.
//
// CC Switch stores each row's provider config under `settings_config` as
// JSON with the shape:
//
//   { "auth": { "OPENAI_API_KEY": "...", "auth_mode": "apikey|chatgpt" },
//     "config": "<TOML with [model_providers.<name>] + wire_api>",
//     "modelCatalog": { "models": [{ "model": "id",
//                                   "displayName": "Name",
//                                   "contextWindow": 200000 }] } }
//
// An `auth_mode === "chatgpt"` row is an OpenAI OAuth login; we skip it.

import { MAX_MODELS_PER_ACCOUNT } from "./index.js";
import { tomlLookup, tomlSection } from "./toml.js";

const PROTOCOL_BY_WIRE = {
  responses: "openai-responses",
  chat: "openai-completions",
};

export function parseCodex(cfg) {
  const auth = (cfg && cfg.auth) || {};
  if (auth.auth_mode === "chatgpt") return undefined; // OAuth; no bearer key
  const apiKey = auth.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;

  const toml = (cfg && typeof cfg.config === "string" ? cfg.config : "");
  const providerName = tomlLookup(toml, "model_provider") ?? "custom";
  const section = tomlSection(toml, `model_providers.${providerName}`);
  const baseURL = section.base_url
    ?? (providerName === "custom" ? "https://api.openai.com/v1" : "https://api.openai.com/v1");
  const wireApi = String(section.wire_api ?? "chat").toLowerCase();
  const protocol = PROTOCOL_BY_WIRE[wireApi] ?? "openai-completions";

  const catalog = cfg && Array.isArray(cfg.modelCatalog?.models) ? cfg.modelCatalog.models : undefined;

  const seen = new Set();
  const models = [];
  const push = (id, name, contextWindow) => {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) return;
    seen.add(id);
    models.push({
      id,
      name: name ?? id,
      ...(Number.isInteger(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
    });
  };
  if (catalog && catalog.length > 0) {
    for (const entry of catalog) push(entry.model, entry.displayName, entry.contextWindow);
  } else {
    const model = tomlLookup(toml, "model") ?? "gpt-5";
    push(model, undefined, undefined);
  }
  if (models.length === 0) push("gpt-5", undefined, undefined);

  return { protocol, baseURL, apiKey, models: models.slice(0, MAX_MODELS_PER_ACCOUNT) };
}
