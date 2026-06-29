<!--
  PR TITLE MUST be a Conventional Commit — it becomes the squash commit on `main`.
  Format: <type>(<scope>): <subject>
  type ∈ feat | fix | docs | refactor | test | chore | ci | perf
  e.g.  feat(sdk): add Gemini provider adapter
        fix(cli): redact secrets in `inspect` output
  Scope is optional. Keep the subject imperative and under ~72 chars.
-->

## Summary

<!-- What changed and why? One PR = one logical change. -->

## Area

- [ ] SDK routing
- [ ] Provider adapter
- [ ] Storage
- [ ] Dashboard
- [ ] CLI
- [ ] Docs
- [ ] CI / repo maintenance

## Checklist

- [ ] PR title is a Conventional Commit (it becomes the squash commit message).
- [ ] This PR is one logical change (split unrelated changes into separate PRs).
- [ ] I did not include secrets, API keys, or private prompts.
- [ ] I updated docs or examples if behavior changed.
- [ ] I added or updated tests where useful.
- [ ] I ran relevant local checks (lint → typecheck → build → test → smoke).

## Local checks

```text
# Paste commands and results here
```

## Notes for reviewers

<!-- Anything reviewers should focus on? -->
