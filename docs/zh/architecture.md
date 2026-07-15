# 架构说明

Adaptive Model Router 采用 SDK-first 架构：路由大脑是一个零依赖的 TypeScript SDK，
Dashboard 和 CLI 都是它的可选消费者。

## 包结构

- `@adaptive-router/sdk`：运行时 SDK —— provider adapters、框架 adapters、policy、
  fallback、storage、telemetry，以及 MVP-2 的评测 / 缓存 / 学习模块。**零运行时依赖。**
- `@adaptive-router/dashboard`：本地只读 Dashboard（Requests + Models、过滤、模型对比）
- `@adaptive-router/cli`：可选开发者辅助命令
  （`init` / `doctor` / `inspect` / `export` / `eval` / `eval:baseline`）

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

## 质量边界

路由过程中不实时判断回答质量。路由时的"质量"表示能力匹配、配置的模型档位、健康状态
和历史成功信号。回答质量的判断在 MVP-2 评测框架中**离线**完成——通过配置的指标或可
插拔的 LLM / 人工评审。

## 设计不变式

- **零依赖核心 SDK** —— SDK 只发布编译产物，不声明任何运行时依赖。
- **字节级路由兼容** —— `BUILTIN_WEIGHTS` 在 MVP-1 → MVP-2 之间保持不变，路由决策稳定。
- **诚实降级** —— 可选后端（embeddings、SQLite、exporter）缺失时绝不抛错，而是降级并
  记录一条解释性 note。
