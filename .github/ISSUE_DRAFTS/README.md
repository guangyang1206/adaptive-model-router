# Initial Issue Drafts

Ready-to-create GitHub issues. Each draft is checked against `ROADMAP.md` and
the code before it lands here — a draft that asks for work already shipped
wastes a contributor's time, which is worse than having no draft at all.

The local environment has SSH push access but no authenticated GitHub CLI. Use
`scripts/create-github-issues.sh` after installing and authenticating `gh`, or
copy these drafts into GitHub Issues manually.

`CONTRIBUTOR_TASKS.md` is the prose version of the same backlog. The two are
kept consistent by hand, so if you change one, check the other.

## Good first issue

1. [Add examples for routing policies](./01-routing-policy-examples.md)
2. [Improve dashboard empty states](./02-dashboard-empty-states.md)
3. [Add CLI output tests](./03-cli-help-snapshots.md)

## Help wanted

4. [Bring the SQLite store to event-stream parity with JSONL](./07-sqlite-compatibility.md)
5. [Add a Node version CI matrix](./08-ci-matrix.md)

## Removed as already shipped

Numbering has gaps because three drafts were deleted rather than renumbered —
the gap is deliberate, so nobody re-adds them. Verified 2026-09-18:

| Draft | Why removed |
| --- | --- |
| `04-qwen-provider-adapter.md` | Shipped in MVP-1. `ROADMAP.md:45`; `createQwenProvider` at `packages/sdk/src/providers.ts:124` |
| `05-gemini-provider-adapter.md` | Shipped in MVP-1. `ROADMAP.md:44`; `createGeminiProvider` at `packages/sdk/src/providers.ts:279` |
| `06-vllm-provider-adapter.md` | Shipped in MVP-1. `ROADMAP.md:46`; `createVLLMProvider` at `packages/sdk/src/providers.ts:161` |

Want to add a provider? Use these three as reference implementations and pick
one that is not covered yet — see "Add a new provider adapter" in
`CONTRIBUTOR_TASKS.md`.

## Before adding a draft here

- Check `ROADMAP.md` for the feature's status, and cite the line number.
- Check the code, not just the roadmap. Cite a file path and line.
- If a draft's premise has partly shipped, narrow it to the part that has not,
  and say what changed — see `07-sqlite-compatibility.md` for the pattern.
