// dsh-llm-cc-switch: CC Switch LLM adapter plugin.
//
// Exposes every CC Switch account as a model under its harness category:
//
//   provider route  cc-switch/claude   → picker category "Claude Code"
//   model id        <account-uuid>::<wire model id>
//   model name      "<account name> · <model name>"
//
// The adapter is a thin LlmAdapter that delegates the heavy lifting — wire
// protocol conversion (anthropic-messages / openai-completions /
// openai-responses), streaming chunks, tool calls, replay, image policy —
// to the DSH-built generic adapter @deepseek-ai/dsh-llm-pi-ai, instanced
// privately with one pi-ai provider profile per CC Switch account.
//
// The account snapshot is re-read from the CC Switch database on every
// operation (mtime-cached), so a change made in the CC Switch app is picked
// up by the next model listing or request without a restart.

import z from "@deepseek-ai/schemastery";
import { LlmAdapter, LlmError, assertUsableApiKey } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  APP_DISPLAY,
  CcSwitchStore,
  accountIdOf,
  accountRouteFor,
  appTypeOf,
  decodeModelId,
  encodeModelId,
  routeFor,
} from "./source.js";

const name = "cc-switch";
const inject = ["llm"];

/** Wire protocols this adapter can hand to pi-ai, keyed by the route `api` spelling. */
const PROTOCOLS = {
  "anthropic-messages": anthropicMessagesApi,
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
};

const NO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

const Config = z.object({
  /** Absolute path to cc-switch.db; empty means ~/.cc-switch/cc-switch.db. */
  dbPath: z.string().default(""),
  /** CC Switch harnesses (app_type) to expose as picker categories. */
  appTypes: z.array(z.string()).default(["claude", "claude-desktop", "codex", "opencode"]),
  /** Fallback context window for models the account does not size. */
  contextWindow: z.natural().default(200000),
  /** Per-request output cap. */
  maxTokens: z.natural().default(64000),
  /** Provider read idle timeout. */
  streamIdleTimeoutMs: z.natural().default(300000),
  /** Keys with these prefixes go out as Authorization: Bearer (token-plan tokens). */
  bearerAuthPrefixes: z.array(z.string()).default(["tp-"]),
});

/**
 * Harvest harness route -> account models from the CC Switch store, mapped
 * into the shape @deepseek-ai/dsh-llm-pi-ai expects.
 */
class CcSwitchAdapter extends LlmAdapter {
  #store;
  #pi;
  #cfg;
  #logger;
  #profileCache;

  constructor(config, logger) {
    super();
    this.#cfg = config;
    this.#logger = logger;
    this.#store = new CcSwitchStore(config);
    this.#pi = new PiAiAdapter({
      profiles: () => this.#accountProfiles(),
      resolveApiKey: (provider) => this.#resolveKey(provider),
      auth: piAuth(),
      resolveAttachments: () => undefined,
      onReplayDegrade: ({ provider, model, reason }) => {
        logger.warn("dsh-llm-cc-switch: unusable replay state on account history (%s/%s); sending that message as provider-neutral content (%s)", provider, model, reason);
      },
    });
  }

  get store() {
    return this.#store;
  }

  #accountProfiles() {
    const stamp = this.#store.stamp;
    if (this.#profileCache !== undefined && this.#profileCache.stamp === stamp) return this.#profileCache.map;
    const map = new Map();
    for (const account of this.#store.accounts()) {
      const profile = this.#profileFor(account);
      if (profile !== undefined) map.set(accountRouteFor(account.accountId), profile);
    }
    this.#profileCache = { stamp, map };
    return map;
  }

  #profileFor(account) {
    const api = PROTOCOLS[account.protocol];
    if (api === undefined) return undefined;
    const route = accountRouteFor(account.accountId);
    const models = account.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      api: account.protocol,
      provider: route,
      baseUrl: account.baseURL,
      input: ["text"],
      cost: NO_COST,
      contextWindow: model.contextWindow ?? this.#cfg.contextWindow,
      maxTokens: this.#cfg.maxTokens,
    }));
    if (models.length === 0) return undefined;
    const provider = createProvider({
      id: route,
      name: account.name,
      baseUrl: account.baseURL,
      auth: {
        apiKey: {
          name: account.name,
          resolve: async ({ credential }) => ({
            auth: credential?.key === undefined ? {} : { apiKey: credential.key },
            source: account.name,
          }),
        },
      },
      models,
      api: api(),
    });
    return {
      provider: route,
      displayName: account.name,
      streamIdleTimeoutMs: this.#cfg.streamIdleTimeoutMs,
      maxRequestImageBytes: 20 * 1024 * 1024,
      requestImagePixelBudget: 2048 * 2048,
      requestImageMaxBytes: 1024 * 1024,
      retryPolicy: undefined,
      reasoning: undefined,
      thinkingBudgets: undefined,
      cacheRetention: undefined,
      transport: undefined,
      timeoutMs: undefined,
      websocketConnectTimeoutMs: undefined,
      headers: account.bearer ? { authorization: `Bearer ${account.apiKey}` } : undefined,
      configuredMaxTokens: new Map(),
      piProvider: provider,
    };
  }

  #resolveKey(provider) {
    const accountId = accountIdOf(provider);
    const account = accountId === undefined ? undefined : this.#store.account(accountId);
    if (account === undefined || account.bearer) return undefined;
    return assertUsableApiKey(account.apiKey, "dsh-llm-cc-switch", `${account.name} (CC Switch account)`);
  }

  #parse(provider, modelId) {
    const appType = appTypeOf(provider);
    const parsed = decodeModelId(modelId);
    if (appType === undefined || parsed === undefined) {
      throw new LlmError(`dsh-llm-cc-switch: provider "${provider}" has no model "${modelId}"`, "UNKNOWN_MODEL");
    }
    const account = this.#store.account(parsed.accountId);
    if (account === undefined || account.appType !== appType) {
      throw new LlmError(`dsh-llm-cc-switch: model "${modelId}" is not an account of "${provider}"`, "UNKNOWN_MODEL");
    }
    return { account, wireModelId: parsed.wireModelId };
  }

  providerInfo(provider) {
    const appType = appTypeOf(provider);
    return { id: provider, name: appType === undefined ? provider : APP_DISPLAY[appType] ?? appType };
  }

  providerRetryPolicy(_provider) {
    return undefined;
  }

  async listModels(provider) {
    const appType = appTypeOf(provider);
    if (appType === undefined) return [];
    // `accountsOf` refreshes the store from the database (mtime-cached), so a
    // cc-switch edit is visible to the next listing without a restart.
    const snapshot = this.#pi.current();
    const out = [];
    for (const account of this.#store.accountsOf(appType)) {
      const route = accountRouteFor(account.accountId);
      let models = [];
      try {
        models = snapshot.models.getModels(route);
      } catch {
        // Account vanished between snapshot and read; skip it.
      }
      for (const model of models) {
        out.push({
          provider,
          id: encodeModelId(account.accountId, model.id),
          name: `${account.name} · ${model.name}`,
          inputModalities: [...model.input],
        });
      }
    }
    return out;
  }

  async resolveModel(provider, modelId, signal) {
    const { account, wireModelId } = this.#parse(provider, modelId);
    const info = await this.#pi.resolveModel(accountRouteFor(account.accountId), wireModelId, signal);
    return {
      provider,
      id: modelId,
      name: `${account.name} · ${info.name}`,
      inputModalities: info.inputModalities,
      ...(info.context === undefined ? {} : { context: info.context }),
      ...(info.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: info.defaultMaxTokens }),
      ...(info.reasoning === undefined ? {} : { reasoning: info.reasoning }),
    };
  }

  async prepareCall(provider, modelId, signal) {
    const { account, wireModelId } = this.#parse(provider, modelId);
    const accountRoute = accountRouteFor(account.accountId);
    const prepared = await this.#pi.prepareCall(accountRoute, wireModelId, signal);
    return {
      model: await this.resolveModel(provider, modelId, signal),
      stream: (options) => prepared.stream({ ...options, provider: accountRoute, model: wireModelId }),
    };
  }

  stream(options) {
    const { account, wireModelId } = this.#parse(options.provider, options.model);
    return this.#pi.stream({ ...options, provider: accountRouteFor(account.accountId), model: wireModelId });
  }
}

/** pi-ai auth plane for an adapter that resolves every key itself (no stored logins). */
function piAuth() {
  return {
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => undefined,
      delete: async () => {},
    },
    authContext: {
      env: async (envName) => process.env[envName],
      fileExists: async (path) => existsSync(path.startsWith("~/") || path === "~" ? join(homedir(), String(path).slice(1).replace(/^\//, "")) : resolve(path)),
    },
  };
}

/** Register one CC Switch adapter holding every harness route. */
function apply(ctx, config) {
  const adapter = new CcSwitchAdapter(config, ctx.logger);
  const routes = adapter.store.routes();
  if (routes.length === 0) {
    const detail = adapter.store.lastError?.message ?? "no usable accounts";
    ctx.logger.warn("dsh-llm-cc-switch: not registered — %s (dbPath: %s)", detail, adapter.store.dbPath);
    return;
  }
  if (adapter.store.lastError !== undefined) {
    ctx.logger.warn("dsh-llm-cc-switch: %s; serving the last good snapshot", adapter.store.lastError.message);
  }
  ctx.llm.registerAdapter(routes, adapter);
  ctx.logger.info("dsh-llm-cc-switch: registered %s CC Switch harness route(s): %s", routes.length, routes.join(", "));
}

export { CcSwitchAdapter, apply, Config, inject, name };
