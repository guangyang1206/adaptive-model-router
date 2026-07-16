# MVP-3 架构说明 —— 团队控制面（Control Plane）

> 状态：**MVP-3（规划中）**。本文档是托管、多用户控制面的已锁定架构。它在**不修改**
> 零依赖核心 SDK 的前提下对其进行扩展。

MVP-3 的目标：把本地只读 Dashboard 变成一个**多人可访问的托管控制面**——团队成员登录后，
各自看到自己有权访问的 Project 的路由决策。允许引入标准云组件（Postgres、认证、OAuth），
**但只限于新的 control-plane 层**。核心 SDK 的零依赖铁律不变。

## 结论摘要

1. **扩展，不重写。** 现有 dashboard 已经把 `DashboardDataSource` 抽象暴露在
   `{code,data,message}` 信封之后。control-plane 包裹并复用它——SDK 与本地 dashboard
   无需任何逻辑改动。
2. **选型守住零依赖精神。** 认证 = **Better-Auth**（MIT、框架无关、自带 Node HTTP
   handler、organization + magic-link 插件）；持久层 = **Postgres + postgres.js**
   （0 依赖、~1250 LOC、TS 原生）；部署 = **docker-compose**（clone 就能起）+
   **Render blueprint**（免信用卡、免费 Postgres、一键托管）。
3. **边界机器强制。** 核心 SDK = 零运行时依赖，由 CI 断言。所有新依赖被物理隔离在新的
   control-plane 包里。

## 包结构

- `@adaptive-router/sdk`——路由大脑。**`dependencies: {}`——一字节不动。**
- `@adaptive-router/dashboard`——本地只读 Dashboard。不变。
- `@adaptive-router/cli`——开发者辅助命令。不变。
- `@adaptive-router/control-plane`——**新增。** 托管、多用户层。唯一允许声明标准云依赖的包。

## 分层架构

```text
┌──────────────────────────────────────────────────────────────┐
│  浏览器（团队多人）                                            │
│  登录  →  Project 选择器  →  各自 Project 的路由决策           │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS + session cookie
┌───────────────▼────────────────────────────────────────────────┐
│  @adaptive-router/control-plane （新增；允许云组件）            │
│  ┌────────────┐ ┌──────────────────┐ ┌──────────────────────┐  │
│  │ 认证       │ │ 多租户网关：      │ │ 复用的 dashboard      │  │
│  │ Better-Auth│ │ project 作用域    │ │ 渲染 + /api/*         │  │
│  │ org + magic│ │ + 授权中间件      │ │ （原样调用）          │  │
│  └─────┬──────┘ └────────┬──────────┘ └──────────┬───────────┘  │
│        │                 │                        │              │
│  ┌─────▼─────────────────▼────────────────────────▼──────────┐  │
│  │ PgDataAccess：实现 SDK 的 DashboardDataSource 契约         │  │
│  │ （listTraces / listModels / store），按 project_id 过滤     │  │
│  └───────────────────────────┬─────────────────────────────┘  │
│  ┌───────────────────────────▼─────────────────────────────┐  │
│  │ 上报端点：SDK 把 trace POST 到这里（P0 数据通路）          │  │
│  └───────────────────────────┬─────────────────────────────┘  │
└──────────────────────────────┼───────────────────────────────────┘
                               │ postgres.js（0 依赖）
                     ┌─────────▼──────────┐
                     │  Postgres          │
                     │  orgs / users /    │
                     │  projects / traces │
                     └────────────────────┘

═══════ 依赖边界（铁律，机器强制）═══════
┌───────────────────────────────────────────────────────────────┐
│  @adaptive-router/sdk    dependencies: {}    ← 一字节不动       │
│  被 control-plane 当纯函数库 import；绝不反向依赖                │
└───────────────────────────────────────────────────────────────┘
```

**核心洞察（来自实读代码）：**
`createReadOnlyDataAccess(source: DashboardDataSource)` 已经把「数据从哪来」完全抽象出来。
`DashboardDataSource = { listTraces(), listModels?(), store?: Mvp2StoreExtension }`。
这意味着 control-plane 只需实现一个**按 `project_id` 过滤的 PgDataAccess**，喂给现成的
`createReadOnlyDataAccess`，整个 12 个 `/api/*` 端点和 HTML 渲染层**零改动**即可多租户化。
这是本次改造改动面小的关键。

## 已锁定决策（MVP-3 裁决）

### 裁决 1 —— 组织层级：双层 **Organization → Project**

MVP-3 **确定采用双层 `Organization → Project` 模型**作为已锁定决策。Organization 拥有
Project；成员的访问权限经由 Organization 成员关系向下作用到其 Project。术语在文档、schema、
UI 中统一为 **Organization** 与 **Project**。这是收敛后的共识——不做单层扁平化。

### 裁决 2 —— 角色档位：MVP-3 只实装 **owner / member** 两档

`memberships.role` 列保留，但：

- **(a)** MVP-3 只实现 **owner 与 member 两档**的权限判定逻辑。`owner` 可管理 Organization
  及其 Project（创建 project、签发/吊销 ingest token、邀请成员）；`member` 对其所属
  Project 拥有只读访问。
- **(b)** `role` 列在物理上可存更多值，但**细粒度 RBAC（Admin / Viewer 的差异化权限）延后
  到 MVP-4+**，本期不实现差异化权限判定逻辑。此举守住 RBAC 延后纪律。

### 裁决 3 —— SDK 上报路径（`ingest_tokens` + trace POST）是 **P0 数据通路**

要让「多人看到同一份数据」成立，嵌入式 SDK 产生的 trace 必须能到达控制面。这是 **MVP-3 的
P0 数据通路**，详见下文 [SDK 上报路径](#sdk-上报路径p0)。

## 技术选型对比矩阵

### 认证（团队登录）

| 候选 | 起步友好 | 组织/规模 | License | 自托管 | 依赖污染 | 评分 |
|------|---------|-----------|---------|--------|---------|------|
| **Better-Auth** ✅ | 高（magic-link + OAuth 插件） | 高（org 插件=团队/邀请/角色，映射 project 隔离） | MIT | 完全 | 隔离在新包 | **9/10** |
| Auth.js (next-auth) | 中（历史偏 Next.js） | 中（无原生 org） | ISC | 完全 | 隔离在新包 | 6/10 |
| Lucia v3 | 低（全手写） | 手动 | — | 完全 | **2026 已废弃** | **淘汰** |
| 自建 用户名+密码+session | 中 | 全手写 | — | 完全 | 无 | 5/10 |

**结论：Better-Auth。** 提供 standalone Node HTTP handler，与现有 `node:http` dashboard
无缝共存（不强制引入 web 框架）；`organization` 插件天然映射 Org → Project 作用域，为延后的
RBAC 留干净升级位。起步用 **magic-link + GitHub OAuth**（开发者受众），密码登录作为离线
自托管兜底。Lucia 因废弃硬性排除。

### 持久层

| 候选 | 多租户隔离 | 并发写 | 托管友好 | 依赖成本 | 评分 |
|------|-----------|--------|---------|---------|------|
| **Postgres + postgres.js** ✅ | 强（行级 project_id） | 强 | 极好 | **0 依赖** | **9/10** |
| 沿用 SQLite/JSONL | 弱（单文件、并发差、多实例无法共享） | 弱 | 差（重启丢数据） | 0 | 4/10 |
| Postgres + Prisma | 强 | 强 | 好 | **重**（引擎二进制） | 6/10 |
| Postgres + pg | 强 | 强 | 好 | 有依赖但成熟 | 7/10 |

**结论：Postgres + postgres.js。** JSONL/SQLite 对本地单人够用、对托管多人不够（单文件并发、
容器无状态重启丢数据、多实例无法共享）。选 postgres.js 而非 pg/Prisma 的关键：它
**0 依赖、~1250 LOC、TS 原生、内置连接池**——即使在允许云组件的层，仍选最轻的以呼应项目气质。
**不引入 ORM**（Prisma 引擎二进制是典型过度设计），迁移用手写 SQL 文件 + 版本表。

> 兼容性：SDK 侧 `createSQLiteTraceStore` / `createJsonlTraceStore` 与 `Mvp2StoreExtension`
> 契约保持不动。control-plane 新增一个实现同契约的 `createPostgresTraceStore`——本地用户继续
> 零依赖用 SQLite，托管用户用 Postgres。同一套 store 接口。

### 托管形态与部署模板

| 候选 | clone 就起 | 一键托管 | 免费档（带 PG） | 冷启动 | 需信用卡 | 评分 |
|------|-----------|---------|----------------|--------|---------|------|
| **docker-compose** ✅ | 极好（`docker compose up`） | — | — | — | 否 | **9/10**（自托管） |
| **Render blueprint** ✅ | — | 极好（自动建 PG） | 免费 PG 1GB / 30 天 | 30–60s | **否** | **9/10**（托管） |
| Railway 模板 | — | 极好（Nixpacks） | 首月 $5，后 $1/月 | 无 | 试用后需卡 | 7/10 |
| Fly.io | — | 好 | 有 | 5–10s（最快） | **是** | 6/10 |

**结论：docker-compose + Render blueprint。** `docker-compose.yml`（control-plane +
`postgres:17`）满足 clone 就能起 + 完全自托管；`render.yaml` 满足一键托管，且是唯一
**免信用卡 + 免费 Postgres** 的选项——对开源受众门槛最低。Railway/Fly 在 README 中作为
「其他平台」链接提及，不作首要维护对象。

## control-plane / SDK 边界契约

**方向：仅 `control-plane → sdk`（永不反向）。** control-plane 通过现有公开契约复用 SDK，
不新增 SDK 表面积：

| SDK 现有导出 | control-plane 如何用 |
|-------------|---------------------|
| `DashboardDataSource` / `createReadOnlyDataAccess` | 实现 PG 版 `listTraces / listModels / store`，按 project 过滤后喂入 |
| `Mvp2StoreExtension` / `ExtendedTraceStore` | 新增 `createPostgresTraceStore` 实现同一 store 契约 |
| `RouterTrace` / `StoredRequest` / `ModelProfile` 等类型 | 作 DB 行 ↔ API 映射目标，保持信封一致 |
| `renderDashboardHtml` 及 12 个 `/api/*` 端点 | 原样复用；仅在外层加 auth 中间件 + project 作用域注入 |

**边界规则：**

- control-plane 只能 `import` SDK 公开导出；禁止深链 `sdk/src/**`
  （可用 eslint `no-restricted-imports` 强制）。
- 所有多租户 / 认证 / Postgres 逻辑留在 control-plane 包，**绝不下沉进 SDK**。
- SDK 若需为 control-plane 暴露新能力，必须是**可选、零依赖、对本地单机无副作用**的纯类型/
  纯函数扩展（沿用 MVP-2 append-only 原则）。

## 数据模型（Postgres）

```text
organizations           users                   memberships
─────────────           ─────                   ───────────
id          uuid PK     id        uuid PK        id       uuid PK
name        text        email     text UNIQUE    user_id  → users
created_at  timestamptz name      text           org_id   → organizations
updated_at  timestamptz created_at timestamptz   role     text  (owner | member)
                        updated_at timestamptz    created_at timestamptz
                                                  UNIQUE(user_id, org_id)

projects                             ingest_tokens（SDK 上报凭证）
────────                             ─────────────
id          uuid PK                  id           uuid PK
org_id      → organizations          project_id   → projects
name        text                     token_hash   text  （只存哈希）
slug        text                     created_at   timestamptz
created_at  timestamptz              last_used_at timestamptz
updated_at  timestamptz              revoked_at   timestamptz  （软删）
UNIQUE(org_id, slug)

router_traces（现有 RouterTrace 落 PG，加租户列）
─────────────
trace_id       text PK          latency_ms          int
project_id     → projects  ◄──  estimated           bool
decision_id    text NOT NULL    estimated_cost_usd  real
status         text             input/output/total_tokens  int
chosen_model   text             trace_json          jsonb  （完整 RouterTrace）
reason         text             created_at          timestamptz

索引：
  idx_traces_project_created  ON router_traces(project_id, created_at DESC)
  idx_traces_project_status   ON router_traces(project_id, status)
  idx_memberships_user        ON memberships(user_id)
  Better-Auth 自建 session / account / verification 表。
```

**裁决 1 落在 schema：** `organizations`（1）→ `projects`（N）是锁定的双层层级。

**裁决 2 落在 schema：** `memberships.role` 在 MVP-3 存 `owner | member`。列类型允许日后
存更多值，但本期只判定 `owner` / `member`；差异化 RBAC 属 MVP-4+。

**索引策略（MVP 纪律）：** 只对高频列 + 外键 + 排序列建必要索引。`project_id` 恒出现在
`WHERE`，故与 `created_at` / `status` 组复合。不预建投机性复合索引。`trace_json jsonb`
保留完整 trace 以兼容未来字段演进（呼应 SDK 的 append-only 精神）。

**隔离机制：** 每个 `/api/*` 请求经 auth 中间件解析 user → org → 有权访问的 project 集合，
PgDataAccess 在**每条查询强制注入 `WHERE project_id = $current`**。

## SDK 上报路径（P0）

**这是 MVP-3 的 P0 数据通路。** 没有它，本地嵌入式 SDK 的 trace 永远到不了托管控制面，
「多人看到同一份数据」无从成立。通路如下：

```text
Agent 应用（嵌入 @adaptive-router/sdk）
  │  createRouter({ store, reporter })   ← reporter 是可选、零依赖
  │  照常路由，产出 RouterTrace
  ▼
POST  https://<control-plane>/ingest/traces
  Header: Authorization: Bearer <INGEST_TOKEN>   （每 project 一枚 token）
  Body:   RouterTrace 的 JSON
  ▼
控制面
  1. 对呈上的 token 做哈希，查 ingest_tokens.token_hash
  2. 解析出归属的 project_id（若已吊销/未知 → 401/403 拒绝）
  3. 以该 project_id 插入 router_traces
  ▼
该 project 的成员即可在 dashboard 看到这条 trace。
```

细节：

- **token 存储：** ingest token **只存哈希**（`ingest_tokens.token_hash`）；明文仅在创建时
  展示一次，绝不落库。吊销为软删（`revoked_at`）。
- **project 归属：** 每枚 token 恰属于一个 project；trace 的 `project_id` 由服务端从 token
  推导，绝不信任客户端 body 里的值。
- **零依赖上报客户端（铁律）：** 若 SDK 新增上报客户端，它**必须可选且零依赖**，只用 Node
  内置 `fetch` / `node:http`。**不得给 SDK 加任何 npm 依赖。** 未配置 `reporter` 的 router
  行为与今天完全一致（仅本地 store）——诚实、opt-in、无副作用。
- **端点契约：** `POST /ingest/traces` 返回 `{code,data,message}` 信封；成功 `code: 0`，
  认证/校验失败返回非零 `code` 与人类可读 `message`。

## 部署拓扑

```text
【本地 / 自托管】docker compose up
  ┌─────────────────┐   ┌──────────────┐
  │ control-plane   │──▶│ postgres:17  │
  │ :4319 (Node 22) │   │ （命名卷）    │
  └─────────────────┘   └──────────────┘
  clone → cp .env.example .env → docker compose up   ✅

【一键托管】Render blueprint（render.yaml）
  连接 GitHub → 自动建：
  ┌─────────────────┐   ┌──────────────────┐
  │ Web Service     │──▶│ Render PostgreSQL │
  │ (control-plane) │   │ （免费档 1GB）     │
  └─────────────────┘   └──────────────────┘
  DATABASE_URL 自动注入 → 首启跑 migration → 出公网 HTTPS URL ✅

SDK 用户侧（不变，加可选 reporter）：
  Agent 应用 ──createRouter({ store })──▶ 本地路由
       └── 可选：配 ingest token 把 trace POST 到控制面
```

环境变量（`.env`）：`DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`（可选）、`PORT`。

## 依赖边界

> 本边界将在开发阶段同步进 README「Design principles」（由 team-lead 统一处理）。

### 原则

- **核心 SDK（`@adaptive-router/sdk`）= 零运行时依赖。** 其 `dependencies` 恒为 `{}`。
  可选能力（embeddings ONNX、`node:sqlite`）通过动态 import shim 加载，打包器无法静态引入。
  这一条不因 MVP-3 而改变。
- **control-plane 层（`@adaptive-router/control-plane`）= 允许标准云组件。** 认证
  （Better-Auth）、Postgres 驱动（postgres.js）等依赖**只**声明在这个新包里。
- **`@adaptive-router/dashboard` 与 `@adaptive-router/cli` 维持现状**——今天它们也是零运行时
  依赖（只 workspace 依赖），MVP-3 不给它们加任何 npm 依赖。

### 这条边界为什么存在

SDK 要嵌进别人的 agent runtime。任何被 SDK 拖进去的运行时依赖都会变成下游用户的依赖、供应链
风险与打包体积。零依赖是「SDK-first、可嵌入」产品的核心承诺与差异化。托管控制面是**运维者
自己部署的独立服务**，它的依赖只影响运维者自己、不外溢——所以云组件在这一层是合理的、被允许的。

### 如何机器强制

1. **物理隔离**——云依赖只出现在 `packages/control-plane/package.json`。
2. **CI 断言**（新增，置于现有 lint → typecheck → build → test → smoke 门禁之前）：

   ```bash
   node -e "const p=require('./packages/sdk/package.json');
     const d=Object.keys(p.dependencies||{});
     if(d.length){console.error('SDK dependency boundary VIOLATED:',d);process.exit(1)}
     console.log('SDK zero-dependency boundary OK')"
   ```

   同样对 `dashboard` / `cli` 施加「仅 workspace 依赖」白名单校验。
3. **禁止深链**——control-plane 只 import SDK 公开导出（eslint `no-restricted-imports`）。

## 技术约束与不可行警告

可行（已验证，改动面小）：

- ✅ dashboard 多租户化：因 `DashboardDataSource` 已存在，核心改动 = 新 PgDataAccess + 一层
  auth 中间件；12 个 `/api/*` 端点与 HTML 渲染层零改动。
- ✅ SDK 复用：走现有公开契约，无需给 SDK 加表面积。
- ✅ store 契约延续：新增 `createPostgresTraceStore`。

约束 / 警告：

- ⚠️ **不得给 `packages/sdk` 添加任何运行时依赖**——Better-Auth / postgres.js / 任何 reporter
  客户端只能进新包；违者 CI 红。
- ⚠️ **MVP-1 `BUILTIN_WEIGHTS` 字节级兼容不可破**——本次改造纯属新增外层，不触碰路由打分。
- ⚠️ **继续手写 node 类型 shim**——control-plane 也不引入 `@types/node`（沿用 `node-shims.d.ts`）。
- ⚠️ **Render 免费档：Postgres 30 天过期 + 15 分钟休眠、冷启动 30–60s**——文档诚实标注；生产
  托管建议升 $6/mo 或自托管 docker-compose。
- ⚠️ **本 MVP-3 明确延后：** 细粒度 RBAC（本期只 `owner`/`member`；`role` 列预留）、审计日志、
  预算、SaaS 计费——遵守 milestone 锁定。
- ⚠️ **不引入 ORM / 不引入 web 框架**（Express/Nest）——用 Better-Auth 的 Node HTTP handler
  加现有 `node:http`，避免过度设计。
