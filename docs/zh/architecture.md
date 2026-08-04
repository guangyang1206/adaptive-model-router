# 架构说明

Adaptive Model Router 采用 SDK-first 架构：路由大脑是一个零依赖的 TypeScript SDK，
Dashboard 和 CLI 都是它的可选消费者。

## 包结构

- `@adaptive-router/sdk`：运行时 SDK —— provider adapters、框架 adapters、policy、
  fallback、storage、telemetry，以及 MVP-2 的评测 / 缓存 / 学习模块。**零运行时依赖。**
- `@adaptive-router/dashboard`：本地只读 Dashboard（Requests + Models、过滤、模型对比）
- `@adaptive-router/cli`：可选开发者辅助命令
  （`init` / `doctor` / `inspect` / `export` / `eval` / `eval:baseline`）
- `@adaptive-router/control-plane`：可选的自托管团队控制面（MVP-3）—— 组织 / 项目、
  认证、Postgres 持久化，以及按项目隔离的多租户 Dashboard。**这是唯一允许声明云依赖
  的包。**

## 路由流程

```text
标准化请求
-> 按能力过滤
-> 应用质量阈值
-> 按健康状态、延迟、成本排序
-> （可选）语义缓存查找 —— 无 embedder 时诚实降级
-> 调用选中 provider
-> 对非 streaming 的可重试失败执行 fallback
-> 记录 router trace
```

## 评测与优化闭环（MVP-2）

```text
评测集（用户自定义用例）
-> runEval（离线、成本护栏 —— 不发起真实网络调用）
-> 对比 / 按基线做回归门禁
-> proposeWeights（有界、回归门禁）
-> adopted: false ── 人工审阅 ──> registry.adopt(version)   [仅限主动开启]
```

学习按设计是 human-in-the-loop：路由器绝不自行采纳新权重，`builtin` 权重版本是不可
变的注册表根。

## 团队控制面（MVP-3，可选）

上面所有能力都在本地运行，不需要任何服务端。控制面是**叠加在其上的可选层**——当团队
需要一个共享的、按项目隔离的视图时才部署它。

```text
Agent 应用 + SDK
-> createIngestReporter({ url, token })        [可选；不配置则什么都不发送]
-> POST /ingest/traces（Authorization: Bearer <项目 token>）
-> 控制面从 token 哈希解析出 project_id        [绝不从请求体读取]
-> 写入 Postgres（router_traces，幂等）
-> createPgDashboardDataSource(sql, projectId)
-> 复用同一套 12 个 /api/* Dashboard 端点，此时已按项目隔离
```

两个设计选择承担了绝大部分份量：

- **复用而非重写。** 控制面包装了 Dashboard 现有的 `DashboardDataSource` 抽象，因此
  Dashboard 的 API 表面在**不改动任何 Dashboard 逻辑**的前提下变成了多租户。
- **靠结构隔离，而不是靠检查。** `createPgDashboardDataSource` 在构造时就闭包捕获了
  `projectId`，因此它能发出的每条查询都已带上 `WHERE project_id = $1`。不存在任何能读
  到其它项目数据的代码路径——这个保证是结构性的，而不是一个「可能有人忘了写」的权限
  判断。

租户模型是两层：**Organization → Project**。Project 是隔离单元，拥有自己的 trace 与
ingest token（可以按客户、环境或应用各建一个）。认证使用 Better-Auth（邮箱密码、可选
GitHub OAuth、可关闭注册）。

持久化使用 `postgres.js` + 手写 SQL migrations 和版本表，不引入 ORM。唯一的例外是
Better-Auth：它需要一个独立的 node-postgres `pg.Pool`，因为其 Kysely adapter 通过
`"connect" in db` 检测 Postgres 并要求该接口。应用自身发出的每条查询仍然走
`postgres.js`。

## 质量边界

路由过程中不实时判断回答质量。路由时的"质量"表示能力匹配、配置的模型档位、健康状态
和历史成功信号。回答质量的判断在 MVP-2 评测框架中**离线**完成——通过配置的指标或可
插拔的 LLM / 人工评审。

## 设计不变式

- **零依赖核心 SDK** —— SDK 只发布编译产物，不声明任何运行时依赖。
- **依赖边界由机器强制** —— 云构件（Postgres、OAuth）只允许存在于
  `@adaptive-router/control-plane`。CI 中运行 `pnpm check:deps`，一旦此类依赖出现在
  SDK / Dashboard / CLI 中就直接构建失败。
- **字节级路由兼容** —— `BUILTIN_WEIGHTS` 在 MVP-1 → MVP-3 之间保持不变，路由决策稳定。
- **诚实降级** —— 可选后端（embeddings、SQLite、exporter、trace 上报）缺失时绝不抛错，
  而是降级并记录一条解释性 note。未配置的 ingest reporter 是真正的 no-op，而不是一个
  静默失败的请求。
