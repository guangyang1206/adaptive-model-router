# GitHub Publishing

The local repository scaffold is ready. The target repository is:

```text
https://github.com/guangyang1206/adaptive-model-router
```

## If GitHub CLI is available

```bash
gh auth login
gh repo create guangyang1206/adaptive-model-router --public --source=. --remote=origin --push
```

## If creating from GitHub web UI

1. Open GitHub and create a new public repository named `adaptive-model-router` under `guangyang1206`.
2. Do not initialize it with README, license, or .gitignore because this scaffold already includes them.
3. Run:

```bash
git remote add origin https://github.com/guangyang1206/adaptive-model-router.git
git branch -M main
git push -u origin main
```

## Repository description

```text
SDK-first adaptive model router for agent apps, with quality-gated routing, fallback, and a local dashboard.
```

## Suggested topics

```text
agent llm model-router adaptive-routing typescript openai anthropic deepseek ollama fallback observability
```
