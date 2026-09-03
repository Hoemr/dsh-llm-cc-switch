# dsh-llm-cc-switch

[![GitHub](https://img.shields.io/badge/GitHub-Hoemr%2Fdsh--llm--cc--switch-181717?logo=github&logoColor=white)](https://github.com/Hoemr/dsh-llm-cc-switch)
[![npm](https://img.shields.io/badge/npm-dsh--llm--cc--switch-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-llm-cc-switch)
[![License](https://img.shields.io/github/license/Hoemr/dsh-llm-cc-switch)](https://github.com/Hoemr/dsh-llm-cc-switch/blob/main/LICENSE)
[![Node ≥ 22.19](https://img.shields.io/badge/node-%E2%89%A5%2022.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Maintainer](https://img.shields.io/badge/maintainer-Wei%20Chen-blueviolet)](https://hoemr.github.io/)

DSH (DeepSeek Harness) 的 CC Switch 桥接插件：把 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 里管理的账号直接变成 DSH 的模型，**每次操作都重新读取 `~/.cc-switch/cc-switch.db`**，与 CC Switch 保持同步，无需重启 DSH。

## 映射方式

| CC Switch | DSH |
|---|---|
| harness（claude / claude-desktop / codex / opencode / grokbuild …） | provider 路由（如 `cc-switch/claude` → 选择器里显示 "Claude Code"） |
| 账号（MiniMax、DeepSeek、Xiaomi MiMo …） | 该类别下的模型（显示为 `MiniMax · claude-opus-4 [200k] · anthropic`） |

- **端点 / 协议 / 密钥**：在每次请求时按账号动态解析，不会在 DSH 端持久化。
- **协议支持**：`anthropic-messages` / `openai-completions` / `openai-responses`，对应 `claude*` / `openai` 类路由。内部复用 DSH 自带的 `@deepseek-ai/dsh-llm-pi-ai`，流式、工具调用、重试语义与官方适配器一致。
- **bearer-auth 密钥**：以 `tp-` 开头的 token-plan 密钥自动改用 `Authorization: Bearer` 发送（默认前缀可配置）。
- **baseURL 护栏**：每个账号的 `baseURL` 在缓存时通过 scheme + host allowlist 校验，不在白名单的行直接跳过——这是对 cc-switch.db 内一行恶意 env 的最后一道护盾。

## 支持的 harness

| CC Switch `app_type` | 支持情况 | 备注 |
|---|---|---|
| `claude` | ✅ | 通过 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` 解析，模型来自 `ANTHROPIC_DEFAULT_*_MODEL` / `ANTHROPIC_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` |
| `claude-desktop` | ✅ | 同上 |
| `codex` | ✅ | 通过 `auth.json` + `model_providers` TOML + `modelCatalog`，支持 `wire_api = chat \| responses` |
| `opencode` | ✅ | 根据 `npm` 自动选 anthropic-messages 还是 openai-completions；AI-SDK 风格 `options.baseURL` |
| `grokbuild` | ✅ | TOML `[model.<profile>]` + `models.default`；`api_backend = chat \| responses` |
| `gemini` · `openclaw` · `hermes` · `pi` | ⏸ | 是 CC Switch 的合法 `app_type`，但 settings_config JSON shape 在上游 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 尚未稳定到可直接写一个准确 parser 的程度；列在源码注释里，等上游 schema 锁定再加 parser |

## 前提

- CC Switch 桌面端（SQLite 版本，数据目录 `~/.cc-switch/`，即 `cc-switch.db` + `settings.json`）
- DSH Desktop（内置 `@deepseek-ai/dsh-llm-pi-ai` 与 `@earendil-works/pi-ai`）
- Node ≥ 22.19（与 DSH 自身一致）

## 安装

在目标 profile 的 `package.json` 中加入本地依赖并把它追加到 `dsh.profile.bundles`，然后：

```sh
dsh plugin --profile <name> install
```

启动 DSH 后在选择器里可以看到新类别；CC Switch 里增删改账号无需重启即可在下次选择/请求时生效。

## 配置（`cordis.patch.yml` 中该插件的 `config`）

```yaml
- insert:
    - id: cc-switch
      name: 'dsh-llm-cc-switch'
      config:
        # source: cc-switch               # 改写时使用的账号源，详见 lib/source/index.js
        # dbPath: 'C:/.../cc-switch.db'   # 默认 ~/.cc-switch/cc-switch.db
        appTypes: [claude, claude-desktop, codex, opencode, grokbuild]
        contextWindow: 200000             # 未声明上下文的模型的兜底窗口
        maxTokens: 64000                  # 请求输出上限
        streamIdleTimeoutMs: 300000
        bearerAuthPrefixes: [tp-]         # 这些前缀开头的密钥走 Authorization: Bearer
        urlAllowlist:                     # baseURL 护栏——下面的任一项都可在 config 里覆盖
          schemes: [http, https, ws, wss] # Scheme allowlist；其他 scheme 全部拒绝
          # hosts: [api.openai.com, anthropic.com]   # 仅允许这些 host 后缀（可选）
```

`urlAllowlist.schemes`/`hosts` 是闭集 allowlist，**不是配置 = 拒绝**。这给了"你从 CC Switch 数据库加载，但实际不允许模型路由到某 host"的能力。

## API

```js
import { CcSwitchStore } from "dsh-llm-cc-switch/source/internal";

const store = new CcSwitchStore({ dbPath: "/custom/cc-switch.db" });
await store.accounts();          // 解析后的账号列表，按 (appType, current, name) 排序
store.stamp;                     // mtime:size；为空表示还没读过
store.lastError;                 // 最近一次读库的 error
await store.routes();            // 当前能挂的 harness 路由
await store.account("<uuid>");   // 按 id 取一个
```

新增一种账号源只要写一个 `AccountStore` 子类，然后调用：

```js
import { registerAccountSource } from "dsh-llm-cc-switch/source/internal";
registerAccountSource("my-source", (config) => new MyStore(config));
```

并在 `cordis.patch.yml` 的 `config.source` 里写 `"my-source"` 即可，不改这个插件的代码。

## 安全性

- **不存储密钥**：账号密钥从 CC Switch `settings_config` 直读到请求，无中间缓存层。
- **不写入数据库**：以 `readOnly: true` 打开 `cc-switch.db`——这个插件从不修改 CC Switch 的状态。
- **日志脱敏**：`logger.warn` 打印的 row info 走 `redactAccountShape` + `redactUrl`，只出现 `sk-t…abcd` 这种前缀/后缀保留形式；`Authorization` / `x-api-key` / `Bearer …` 在日志头里一律替换为 `***redacted***`。
- **baseURL 护栏**：见 `urlAllowlist`，每行数据从 store 加载前就被过滤，不在白名单直接跳过。
- **披露**：`weichen.work@qq.com`（见 `SECURITY.md`）。

## 开发

```sh
npm test                 # vitest run：parser / allowlist / redact / 注册表
npm run test:integration # node --experimental-sqlite，跑真实 SQLite fixture
npm run test:all         # 两套都跑
npm run test:watch       # vitest --watch
```

`test:integration` 走的是 `node --test` 而不是 vitest——vite-node 的 pre-bundle 在 Windows 上不能解析 `node:sqlite` 内建，所以单独拆开；两套测试都通过才算过 CI。

## 已知限制

- 只支持 API Key 类账号；Codex 的官方 OAuth（ChatGPT 登录）、claude 官方登录账号会被跳过。
- 类别（harness 路由）在 DSH 启动时注册；CC Switch 新增一种全新 harness 需要重启 DSH 才出现（账号/模型的增删改无需重启）。
- 模型为纯文本模态；图片输入暂未声明。
- grokbuild 解析器只接受 `api_key` 直接出现；`env_key`（环境变量名）等价形式需要等 CC Switch 上游 `grokBuildConfig.ts` 提供解析后产物。
- `gemini` / `openclaw` / `hermes` / `pi` 这四种 cc-switch 已经识别的 app_type，暂不在默认 `appTypes` 里——它们的 settings_config JSON 形态未稳定到能负责任地写 parser。
