# Roadmap

## MVP-0 — Core Proof

Goal: prove that an embedded TypeScript SDK can route agent requests, record decisions, and explain them in a local dashboard.

- TypeScript SDK
- Quality-gated routing
- Provider set: OpenAI, Anthropic, DeepSeek, Ollama
- Fallback / retry / timeout for non-streaming calls
- SQLite store with JSONL fallback
- Local read-only dashboard with Requests and Models pages
- Bilingual README, Quickstart, API Reference

## MVP-1 — Framework and Provider Expansion

- LangChain / LangGraph adapter
- Vercel AI SDK adapter
- Local Proxy / HTTP Bridge
- Gemini adapter
- Qwen or additional domestic/open-source provider
- vLLM support if Ollama ships first
- Policy dry-run UI
- Dashboard filtering and model comparison

## MVP-2 — Evaluation and Optimization

- Eval harness
- User-defined eval sets
- LLM judge / human feedback interface
- Route outcome learning
- Semantic cache
- Prompt/context compression
- Helicone / Langfuse exporter

## MVP-3 — Team / Enterprise / SaaS

- Hosted dashboard
- Multi-project and multi-environment support
- RBAC
- Audit log
- Team budget
- Organization-level provider keys
- Enterprise deployment templates
