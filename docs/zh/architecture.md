# 架构说明

Adaptive Model Router MVP-0 采用 SDK-first 架构。

## 包结构

- `@adaptive-router/sdk`：运行时 SDK、provider adapters、policy、fallback、storage、telemetry
- `@adaptive-router/dashboard`：本地只读 Dashboard
- `@adaptive-router/cli`：可选开发者辅助命令

## 路由流程

```text
标准化请求
-> 按能力过滤
-> 应用质量阈值
-> 按健康状态、延迟、成本排序
-> 调用选中 provider
-> 对非 streaming 的可重试失败执行 fallback
-> 记录 router trace
```

## 质量边界

MVP-0 不实时判断回答质量。质量仅表示能力匹配、配置的模型档位、健康状态和历史成功信号。
