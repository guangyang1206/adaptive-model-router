# GitHub Publishing

The local repository scaffold is ready and committed.

## Current local status

- Local path: `adaptive-model-router/`
- Branch: `main`
- Initial commit: `1f65433 Initial open-source scaffold`
- Remote configured: `https://github.com/guangyang1206/adaptive-model-router.git`
- Target repository: `https://github.com/guangyang1206/adaptive-model-router`

GitHub publishing could not be completed automatically in this environment because:

- `gh` CLI is not installed in the shell.
- No `GITHUB_TOKEN` or `GH_TOKEN` environment variable is available.
- GitHub connector is disconnected.
- `git ls-remote` requires interactive credentials, but terminal prompts are disabled.

## Recommended repository settings

- Owner: `guangyang1206`
- Repository name: `adaptive-model-router`
- Visibility: Public
- License: Apache-2.0
- Default branch: `main`

## Repository description

```text
SDK-first adaptive model router for agent apps, with quality-gated routing, fallback, and a local dashboard.
```

## Suggested topics

```text
agent llm model-router adaptive-routing typescript openai anthropic deepseek ollama fallback observability
```

## Publish via GitHub web UI

1. Open GitHub and create a new public repository named `adaptive-model-router` under `guangyang1206`.
2. Do not initialize it with README, license, or `.gitignore` because this scaffold already includes them.
3. From the local repository directory, run:

```bash
git push -u origin main
```

## Publish with GitHub CLI if installed later

If `gh` becomes available, run from the local repository directory:

```bash
gh auth login
gh repo create guangyang1206/adaptive-model-router --public --source=. --remote=origin --push
```

If the remote already exists, use:

```bash
git push -u origin main
```

## Publish with a token

If using HTTPS with a personal access token, create the repository on GitHub first, then run:

```bash
git push -u origin main
```

When prompted, use your GitHub username and token.
