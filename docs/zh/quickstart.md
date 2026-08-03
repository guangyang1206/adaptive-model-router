# 快速开始

Adaptive Model Router 已交付 MVP-1（框架与 provider 扩展）、MVP-2（评测与优化）和
MVP-3（自托管团队控制面）。本文展示核心接入流程，完整 API 见
[API 参考](./api-reference.md)。如果你想直接搭建团队共享环境，可跳到
[与团队共享（MVP-3）](#与团队共享mvp-3)。

## 1. 安装

> **尚未发布到 npm。** 这些包还未发版（版本号`0.0.0`），所以
> `pnpm add @adaptive-router/sdk` 会返回 404 失败。首个正式版本发布前，请从源码构建
> ——大约一分钟即可完成。

```bash
git clone https://github.com/guangyang1206/adaptive-model-router.git
cd adaptive-model-router

pnpm install        # 需要 pnpm 9、Node 20+（CI 用 22）。不能用 npm：
                    # npm 不会创建 workspace 软链，跨包导入会解析失败。
pnpm -r build       # 依次构建 sdk -> dashboard -> cli -> control-plane
```

之后在你自己的项目里引用这个已构建的 workspace ——可以 link（在**你的**项目里执行，
`pnpm link <dir>` 接的是路径）：

```bash
cd /path/to/your-project
pnpm link /path/to/adaptive-model-router/packages/sdk
```

……也可以在 `package.json` 里写 `file:` 依赖：

```json
{
  "dependencies": {
    "@adaptive-router/sdk": "file:../adaptive-model-router/packages/sdk"
  }
}
```

如果只想最快地试一下、不想做任何接线，直接在克隆下来的仓库里运行即可（workspace 软链
已经就绪）：

```bash
node --input-type=module -e "
import { createRouter, createStaticProvider } from './packages/sdk/dist/index.js'
const models = [{ id: 'local/demo', provider: 'demo', model: 'demo', type: 'self-hosted',
  kind: 'openai-compatible', tier: 'balanced', contextWindow: 8192,
  capabilities: ['reasoning'], enabled: true,
  cost: { inputPer1M: 0, outputPer1M: 0, currency: 'USD', estimated: true },
  health: { status: 'ok', successRate: 1 } }]
const router = createRouter({ providers: [createStaticProvider('demo', models)], models })
const e = await router.evaluate({ messages: [{ role: 'user', content: 'Plan a task.' }], route: { task: 'plan' } })
console.log('ranked candidates:', e.candidates.length)
"
```

这一步不需要任何 API key —— `evaluate()` 只做路由决策，绝不会真的调用 provider。

等包发布之后，本节会简化回一行 `pnpm add @adaptive-router/sdk`。

## 2. 初始化 Router

```ts
import { createDashboard, createReadOnlyDataAccess } from '@adaptive-router/dashboard'
import {
  createAnthropicProvider,
  createDeepSeekProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createRouter,
  createSQLiteTraceStore,
} from '@adaptive-router/sdk'

const store = await createSQLiteTraceStore({
  path: '.adaptive-router/router.db',
  fallbackPath: '.adaptive-router/router.jsonl',
})

const router = createRouter({
  providers: [
    createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
    createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    createDeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY }),
    createOllamaProvider({ baseURL: process.env.OLLAMA_BASE_URL }),
  ],
  policy: {
    defaultQuality: 'balanced',
    stability: 'high',
    costMode: 'optimize-within-quality-threshold',
  },
  store,
})
```

## 3. 发送一次路由请求

```ts
const result = await router.chat({
  messages: [{ role: 'user', content: 'Plan the next coding task.' }],
  route: {
    task: 'plan',
    quality: 'high',
    stability: 'high',
    explain: true,
  },
})

console.log(result.routerTrace)
```

## 4. 打开本地 Dashboard

```ts
const dashboard = await createDashboard({
  port: 4318,
  data: createReadOnlyDataAccess({
    listTraces: () => router.traces(),
    listModels: () => router.models(),
  }),
})

console.log(dashboard.url)
```

## 5. 使用 CLI

```bash
adaptive-router init
adaptive-router doctor
adaptive-router inspect
adaptive-router export --out .adaptive-router/diagnostic-export.json

# 评测（MVP-2）
adaptive-router eval ./evals/routing.json          # 运行评测集
adaptive-router eval:baseline ./evals/routing.json ./evals/baseline.json  # 写入/刷新基线

adaptive-router --help       # 或 -h
adaptive-router --version    # 或 -v
```

CLI 用于初始化配置、检查 provider 环境变量、汇总 JSONL traces、导出本地诊断包，
并针对可选基线运行离线评测集。

## 与团队共享（MVP-3）

上面所有内容都在本地运行，不需要服务端。如果团队需要一个共享视图，可以部署可选的控制
面——它是独立的包，不影响 SDK 的零依赖承诺。

### 启动控制面

它需要 Postgres 和三个环境变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | `postgres://user:pass@host:5432/db` |
| `BETTER_AUTH_SECRET` | 是 | 足够长的随机字符串 |
| `BETTER_AUTH_URL` | 是 | 对外访问的 base URL（OAuth 回调与 cookie 域） |
| `PORT` | 否 | 默认 `3000` |
| `HOST` | 否 | 默认 `0.0.0.0` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 否 | **两者都配置**时启用 GitHub 登录 |
| `REGISTRATION_OPEN` | 否 | 默认 `true`；设为 `false` 可关闭注册 |
| `POSTGRES_PASSWORD` | 否 | 仅供 docker-compose 的 `db` 服务使用（默认 `adaptive`） |

最快的方式是 docker-compose（会一并拉起 Postgres）：

```bash
cd packages/control-plane
cp deploy/.env.example .env      # 填入三个必填变量
docker compose -f deploy/docker-compose.yml up
```

也可以直接运行——migrations 会在启动时自动执行：

```bash
pnpm --filter @adaptive-router/control-plane build
pnpm --filter @adaptive-router/control-plane start   # bin: adaptive-control-plane
```

缺少任一必填变量时，服务会在**绑定端口之前**报错并指名缺失的那个变量，绝不会以半配置
状态启动。

### 创建组织、项目与 token

在浏览器中打开控制面并注册（首个用户成为组织 owner），按 onboarding 引导创建第一个
项目。随后进入 **Settings → API Keys** 生成 ingest token。token 是按项目隔离的。

### 让应用把 trace 上报过来

这是 SDK 侧唯一需要的改动：

```ts
import { createRouter, createIngestReporter } from "@adaptive-router/sdk"

const router = createRouter({
  providers,
  models,
  reporter: createIngestReporter({
    url: "https://router.example.com/ingest/traces",
    token: process.env.ADAPTIVE_INGEST_TOKEN!,
  }),
})
```

此后 trace 会出现在团队 Dashboard 中，并限定在该项目范围内。几点说明：

- **可选且零依赖。** reporter 使用运行时内置的 `fetch`。不传 `reporter` 就什么都不发送
  ——不产生任何网络调用，行为与 MVP-2 完全一致。
- **它永远不会拖垮你的应用。** 传输错误默认被吞掉（可传 `onError` 观测）。控制面变慢或
  宕机都不影响路由与本地 trace 存储。
- **由服务端决定 trace 属于哪个项目**，`project_id` 从token 派生。客户端无法通过修改
  请求体写入其它项目。

## 说明与限制

路由过程中不实时判断回答质量。路由时的"质量"仅由能力匹配、模型档位、健康状态和
历史成功信号表达。MVP-2 评测框架在**离线**阶段针对用户自定义用例集打分——它绝不
发起真实网络调用。

Streaming 请求在第一个 token 输出后不支持中途 fallback。

可选能力均遵循"诚实降级"：语义缓存在没有 embedder 时也能工作（只是降级并记录原因），
路由结果学习绝不会自行采纳新权重（在人工确认前始终 `adopted: false`）。
