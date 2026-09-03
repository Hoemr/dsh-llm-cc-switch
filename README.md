# dsh-llm-cc-switch

DSH (DeepSeek Harness) 的 CC Switch 桥接插件：把 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 里管理的账号直接变成 DSH 的模型，每次操作都重新读取 `~/.cc-switch/cc-switch.db`，与 CC Switch 保持同步，无需重启。

## 映射方式

| CC Switch | DSH |
|---|---|
| harness（claude / codex / opencode …） | 模型类别（provider 路由，如 `cc-switch/claude` → 选择器里显示 "Claude Code"） |
| 账号（MiniMax、DeepSeek、Xiaomi MiMo …） | 该类别下的模型（显示为 "MiniMax · MiniMax-M3"） |

- 账号的模型列表来自 CC Switch 里该账号声明的模型（`env` 的 DEFAULT_*_MODEL、codex 的 `modelCatalog`、opencode 的 `models` 字典）。
- 端点、协议（`anthropic-messages` / `openai-completions` / `openai-responses`）与密钥在**每次请求时**按账号动态解析。
- `tp-` 开头的 token-plan 密钥自动改用 `Authorization: Bearer` 发送（可配置）。
- 数据库文件内容变化（mtime/size）时才重新读取；读取失败保留上一份快照并告警。
- 内部复用 DSH 自带的通用适配器 `@deepseek-ai/dsh-llm-pi-ai`，流式、工具调用、重试语义与官方适配器一致。

## 前提

- CC Switch 桌面端（SQLite 版本，数据目录 `~/.cc-switch/`，即 `cc-switch.db` + `settings.json`）。
- DSH Desktop（内置 `@deepseek-ai/dsh-llm-pi-ai` 与 `@earendil-works/pi-ai`）。

## 安装

在目标 profile 的 `package.json` 中加入本地依赖并把它追加到 `dsh.profile.bundles`（与 `dsh-overleaf` 等本地插件同一模式），然后：

```sh
dsh plugin --profile <name> install
```

重启 DSH 后在模型选择器中可见新类别；在 CC Switch 里增删改账号，无需重启即可在下次选择/请求时生效。

## 配置（`cordis.patch.yml` 中该插件的 `config`）

```yaml
- insert:
    - id: cc-switch
      name: 'dsh-llm-cc-switch'
      config:
        # dbPath: 'C:/Users/<you>/.cc-switch/cc-switch.db'   # 默认 ~/.cc-switch/cc-switch.db
        # appTypes: [claude, claude-desktop, codex, opencode] # 要暴露的 harness
        # contextWindow: 200000      # 未声明上下文的模型的兜底窗口
        # maxTokens: 64000           # 请求输出上限
        # streamIdleTimeoutMs: 300000
        # bearerAuthPrefixes: [tp-]  # 以这些前缀开头的密钥走 Bearer 认证
```

## 已知限制

- 只支持 API Key 类账号；Codex 的官方 OAuth（ChatGPT 登录）、claude 官方登录账号会被跳过。
- 类别（harness 路由）在 DSH 启动时注册；CC Switch 新增一种全新 harness 需要重启 DSH 才出现（账号/模型的增删改无需重启）。
- 模型为纯文本模态；图片输入暂未声明。
