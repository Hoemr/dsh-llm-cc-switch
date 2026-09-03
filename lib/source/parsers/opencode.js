// dsh-llm-cc-switch: parser for opencode accounts.
//
// CC Switch stores each row's provider config under `settings_config` as
// JSON with the shape:
//
//   { "npm":  "@ai-sdk/anthropic" | "@ai-sdk/openai" | "@ai-sdk/<else>",
//     "options": { "apiKey": "...", "baseURL": "https://..." },
//     "models":  { "<wire-model-id>": { "name": "Display Name" } } }
//
// The npm name decides which wire protocol pi-ai dispatches. AI-SDK
// providers append `/messages` to their baseURL on the Anthropic side,
// while pi-ai appends `/v1/messages`; a trailing `/v1` on the URL is
// dropped here to keep the wire URL a single canonical shape.

import { MAX_MODELS_PER_ACCOUNT } from "./index.js";

export function parseOpenCode(cfg) {
  const options = (cfg && cfg.options) || {};
  const apiKey = options.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) return undefined;
  const npm = typeof cfg.npm === "string" ? cfg.npm : "";
  const isAnthropic = npm.includes("anthropic");
  const protocol = isAnthropic ? "anthropic-messages" : "openai-completions";
  let baseURL = typeof options.baseURL === "string" && options.baseURL.length > 0
    ? options.baseURL
    : (isAnthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1");
  if (isAnthropic && baseURL.endsWith("/v1")) baseURL = baseURL.slice(0, -3);

  const entries = (cfg && cfg.models) || {};
  const models = [];
  for (const [id, entry] of Object.entries(entries)) {
    models.push({
      id,
      name: typeof entry?.name === "string" && entry.name.length > 0 ? entry.name : id,
    });
    if (models.length >= MAX_MODELS_PER_ACCOUNT) break;
  }
  if (models.length === 0) return undefined;
  return { protocol, baseURL, apiKey, models };
}
