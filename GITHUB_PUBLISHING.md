# GitHub Publishing

The local repository scaffold is ready and committed.

## Current local status

- Local path: `adaptive-model-router/`
- Branch: `main`
- Initial commit: `1f65433 Initial open-source scaffold`
- Current remote: `git@github.com:guangyang1206/adaptive-model-router.git`
- Target repository: `https://github.com/guangyang1206/adaptive-model-router`

## SSH check result

This Mac has GitHub SSH keys and SSH authentication works:

```text
Hi guangyang1206! You've successfully authenticated, but GitHub does not provide shell access.
```

The repository itself does not exist yet on GitHub, so `git ls-remote origin` returns:

```text
ERROR: Repository not found.
fatal: Could not read from remote repository.
```

SSH can authenticate and push to an existing repository, but it cannot create a new GitHub repository by itself. The GitHub repository must be created once via GitHub web UI, GitHub CLI, or API.

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

Because the remote is already set to SSH, no HTTPS token should be needed if your SSH key remains authorized.

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

## Current blocker

The only remaining blocker is repository creation on GitHub. After the empty public repository exists, the local repo is ready to push over SSH.
