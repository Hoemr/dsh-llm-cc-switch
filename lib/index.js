// dsh-llm-cc-switch: LLM adapter plugin.
//
// Exposes every account from the configured `AccountStore` as a model
// under its harness category:
//
//   provider route  cc-switch/claude           → picker category "Claude Code"
//   model id        <account-uuid>::<wire model id>
//   model name      "<account name> · <model name> [<ctx>]  · <protocol short>"
//
// The adapter is a thin `LlmAdapter` that delegates the heavy lifting —
// wire protocol conversion (anthropic-messages / openai-completions /
// openai-responses), streaming, tool calls, replay, image policy — to
// the DSH-built generic adapter `@deepseek-ai/dsh-llm-pi-ai`, instanced
// privately with one pi-ai provider profile per account.
//
// Account snapshots are re-read on every operation (mtime-cached), so
// edits in the source reach DSH on the next model listing or request
// without a restart. The store itself is pluggable: the install can
// point at `cc-switch`, or any source registered through
// `registerAccountSource(name, factory)` in `lib/source/index.js`.

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
  accountIdOf,
  accountRouteFor,
  appTypeOf,
  decodeModelId,
  encodeModelId,
  redactAccountShape,
  redactUrl,
  resolveAccountSource,
} from "./source.js";

const name = "cc-switch";
const inject = ["llm"];

/** Wire protocols this adapter can hand to pi-ai. */
const PROTOCOLS = {
  "anthropic-messages": anthropicMessagesApi,
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
};

/** Short tag shown next to the wire protocol in picker rows. */
const PROTOCOL_SHORT = Object.freeze({
  "anthropic-messages": "anthropic",
  "openai-completions": "openai",
  "openai-responses": "openai-responses",
});

const NO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Config shape accepted via `cordis.patch.yml` `config`. */
const Config = z.object({
  /** Which AccountStore to back this install with. Defaults to "cc-switch". */
  source: z.string().default("cc-switch"),
  /** Absolute path to cc-switch.db; empty means ~/.cc-switch/cc-switch.db.
   *  Ignored by sources that do not read a database. */
  dbPath: z.string().default(""),
  /** CC Switch harnesses (app_type) to expose as picker categories. */
  appTypes: z
    .array(z.string())
    .default(["claude", "claude-desktop", "codex", "opencode", "grokbuild"]),
  /** Fallback context window for models the account does not size. */
  contextWindow: z.natural().default(200000),
  /** Per-request output cap. */
  maxTokens: z.natural().default(64000),
  /** Provider read idle timeout. */
  streamIdleTimeoutMs: z.natural().default(300000),
  /** Keys with these prefixes go out as Authorization: Bearer (token-plan tokens). */
  bearerAuthPrefixes: z.array(z.string()).default(["tp-"]),
  /** baseURL allowlist. `schemes` defaults to `["http:", "https:", "ws:", "wss:"]`.
   *  `hosts` is an optional suffix-match list — restrict when the install
   *  should never talk to off-list hosts, e.g. `["api.openai.com"]`.
   *
   *  Both fields are OPTIONAL, and schemastery has no `.optional()`: its
   *  `z.array()` builder carries `meta.default = []`, so an omitted field would
   *  resolve to `[]` instead of `undefined` — and `[]` is a closed allowlist
   *  that rejects every baseURL. `.default(undefined)` clears that injected
   *  default so an omitted field stays absent, which is what
   *  `lib/source/url.js` reads as "use DEFAULT_SCHEMES" / "any host". */
  urlAllowlist: z.object({
    schemes: z.array(z.string()).default(undefined),
    hosts: z.array(z.string()).default(undefined),
  }).default({}),
});

const NUM_FMT = new Intl.NumberFormat("en-US");

function formatContext(window) {
  if (!Number.isInteger(window) || window <= 0) return undefined;
  if (window >= 1024 * 1024) return `${NUM_FMT.format(Math.round(window / (1024 * 1024)))}M`;
  if (window >= 1024) return `${NUM_FMT.format(Math.round(window / 1024))}k`;
  return String(window);
}

function humanizePickerName(account, model) {
  const ctx = formatContext(model.contextWindow);
  const proto = PROTOCOL_SHORT[account.protocol];
  const tail = [ctx, proto].filter(Boolean).join(" · ");
  return tail.length > 0 ? `${account.name} · ${model.name}  [${tail}]` : `${account.name} · ${model.name}`;
}

/**
 * Adapter that re-reads from an AccountStore on every model listing /
 * request, through a pi-ai-backed proxy.
 */
class CcSwitchAdapter extends LlmAdapter {
  #store;
  #pi;
  #cfg;
  #logger;
  #profileCache;

  /** Read-only handle to the underlying AccountStore. Exposed so the
   *  cordis `apply()` entry can introspect routes / lastError /
   *  sourceLocation without duplicating the store reference. */
  get store() { return this.#store; }

  constructor(config, logger) {
    super();
    this.#cfg = config;
    this.#logger = logger;
    this.#store = resolveAccountSource(config.source, {
      dbPath: config.dbPath,
      appTypes: config.appTypes,
      bearerAuthPrefixes: config.bearerAuthPrefixes,
      urlAllowlist: config.urlAllowlist,
      logger,
    });
    this.#pi = new PiAiAdapter({
      profiles: () => this.#accountProfiles(),
      resolveApiKey: (provider) => this.#resolveKey(provider),
      auth: piAuth(),
      resolveAttachments: () => undefined,
      onReplayDegrade: ({ provider, model, reason }) => logger.warn(
        "dsh-llm-cc-switch: unusable replay state on account history (%s/%s); sending that message as provider-neutral content (%s)",
        provider, model, reason,
      ),
    });
    // PiAiAdapter expects `profiles` to be sync. The store now loads its
    // backing source asynchronously (lazy `node:sqlite`), so we pre-warm the
    // profile cache once at construction. Subsequent reads re-read through
    // the store and rebuild the cache when its stamp changes.
    void this.#refreshProfiles();
  }

  /** Ensure the in-memory profile cache mirrors the store's latest stamp.
   *  Sync callers see the most recent populated snapshot; an empty Map is
   *  returned when the underlying read is still in flight. */
  #refreshProfiles() {
    return (async () => {
      const stamp = this.#store.stamp;
      if (this.#profileCache !== undefined && this.#profileCache.stamp === stamp) {
        return this.#profileCache.map;
      }
      const accounts = await this.#store.accounts();
      const next = this.#store.stamp;
      if (this.#profileCache !== undefined && this.#profileCache.stamp === next) {
        return this.#profileCache.map;
      }
      const map = new Map();
      for (const account of accounts) {
        const profile = this.#profileFor(account);
        if (profile !== undefined) map.set(accountRouteFor(account.accountId), profile);
      }
      this.#profileCache = { stamp: next, map };
      return map;
    })();
  }

  #accountProfiles() {
    if (this.#profileCache !== undefined) return this.#profileCache.map;
    // Trigger an async refresh; the next sync caller sees a fresh cache if
    // it's available, otherwise an empty Map (which pi-ai handles as "no
    // routes yet" — the previously-registered routes keep serving).
    void this.#refreshProfiles();
    return this.#profileCache?.map ?? new Map();
  }

  #profileFor(account) {
    const api = PROTOCOLS[account.protocol];
    if (api === undefined) {
      this.#logger?.warn(
        "dsh-llm-cc-switch: account %s (%s) has unknown protocol %s — skipping",
        account.accountId, redactUrl(account.baseURL), account.protocol,
      );
      return undefined;
    }
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

  async #resolveKey(provider) {
    const accountId = accountIdOf(provider);
    const account = accountId === undefined ? undefined : await this.#store.account(accountId);
    if (account === undefined) {
      throw new LlmError(`dsh-llm-cc-switch: account "${accountId ?? provider}" not found`, "UNKNOWN_MODEL");
    }
    if (account.bearer) return undefined; // PiAiAdapter will read it from headers
    return assertUsableApiKey(account.apiKey, "dsh-llm-cc-switch", `${account.name} (account)`);
  }

  async #parse(provider, modelId) {
    const appType = appTypeOf(provider);
    const parsed = decodeModelId(modelId);
    if (appType === undefined || parsed === undefined) {
      throw new LlmError(`dsh-llm-cc-switch: provider "${provider}" has no model "${modelId}"`, "UNKNOWN_MODEL");
    }
    const account = await this.#store.account(parsed.accountId);
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
    const accountsOfApp = await this.#store.accountsOf(appType);
    if (accountsOfApp.length === 0) return [];
    const snapshot = this.#pi.current();
    const out = [];
    for (const account of accountsOfApp) {
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
          name: humanizePickerName(account, {
            name: model.name,
            contextWindow: model.contextWindow ?? this.#profileForFromCache(route, model.id),
          }),
          inputModalities: [...model.input],
        });
      }
    }
    return out;
  }

  #profileForFromCache(route, modelId) {
    const cached = this.#profileCache?.map.get(route);
    if (cached === undefined) return this.#cfg.contextWindow;
    const models = cached.piProvider?.models ?? [];
    const m = models.find((entry) => entry.id === modelId);
    return m?.contextWindow ?? this.#cfg.contextWindow;
  }

  async resolveModel(provider, modelId, signal) {
    const { account, wireModelId } = await this.#parse(provider, modelId);
    const accountRoute = accountRouteFor(account.accountId);
    const info = await this.#pi.resolveModel(accountRoute, wireModelId, signal);
    const ctx = info.context ?? this.#profileForFromCache(accountRoute, wireModelId);
    return {
      provider,
      id: modelId,
      name: humanizePickerName(account, { name: info.name, contextWindow: ctx }),
      inputModalities: info.inputModalities,
      ...(info.context === undefined ? {} : { context: info.context }),
      ...(info.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: info.defaultMaxTokens }),
      ...(info.reasoning === undefined ? {} : { reasoning: info.reasoning }),
    };
  }

  async prepareCall(provider, modelId, signal) {
    const { account, wireModelId } = await this.#parse(provider, modelId);
    const accountRoute = accountRouteFor(account.accountId);
    const prepared = await this.#pi.prepareCall(accountRoute, wireModelId, signal);
    return {
      model: await this.resolveModel(provider, modelId, signal),
      stream: (options) => prepared.stream({ ...options, provider: accountRoute, model: wireModelId }),
    };
  }

  async stream(options) {
    const { account, wireModelId } = await this.#parse(options.provider, options.model);
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
      fileExists: async (path) => existsSync(
        path.startsWith("~/") || path === "~"
          ? join(homedir(), String(path).slice(1).replace(/^\//, ""))
          : resolve(path),
      ),
    },
  };
}

/** Cordis apply entry. Registers one adapter across every route the
 * store currently reports. Async because the underlying store may need
 * to load `node:sqlite` lazily on the first access. */
async function apply(ctx, config) {
  const adapter = new CcSwitchAdapter(config, ctx.logger);
  const store = /** @type {import("./source/index.js").AccountStore} */ (adapter.store);
  const routes = await store.routes();
  if (routes.length === 0) {
    const detail = store.lastError?.message ?? "no usable accounts";
    const where = store.sourceLocation ?? "(none)";
    ctx.logger.warn(
      "dsh-llm-cc-switch: not registered — %s (source: %s)",
      detail, where,
    );
    return;
  }
  if (store.lastError !== undefined) {
    ctx.logger.warn(
      "dsh-llm-cc-switch: serving the last good snapshot (%s)",
      redactAccountShape({ reason: store.lastError.message }),
    );
  }
  ctx.llm.registerAdapter(routes, adapter);
  ctx.logger.info(
    "dsh-llm-cc-switch: registered %s harness route(s): %s",
    routes.length, routes.join(", "),
  );
}

export { CcSwitchAdapter, apply, Config, inject, name };
