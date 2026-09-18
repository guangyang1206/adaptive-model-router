# Add CLI output tests

Labels: `good first issue`, `cli`, `tests`

## Summary

The CLI has no test coverage of its user-facing output. `packages/cli/test/`
contains only `redact.test.mjs`, which covers secret redaction — not what any
command actually prints.

CI does exercise the commands end-to-end (`.github/workflows/ci.yml`, "Run CLI
smoke test": `init` → `doctor` → `inspect` → `export`), but it only asserts they
exit zero and that `export.json` exists. Nobody would notice if `help` started
printing the wrong command list, or if `inspect` silently stopped reporting cost.

## What to cover

The smoke test already proves these commands *run*. This issue is about
asserting *what they say*:

- `help` — not covered by the smoke test at all, and it is the default command
  (`packages/cli/src/index.ts:66` falls back to `"help"` when no argument is
  given). Assert every real command appears in the listing.
- `inspect` — assert the summary actually reports the trace it was given
  (model, status, cost), rather than just exiting cleanly.
- `doctor` — assert the config/health lines it claims to check.
- Unknown command — assert it fails with a useful message, not a stack trace.

## Acceptance criteria

- Tests run under Node's built-in runner, discovered by a bare `node --test`
  from `packages/cli` — that is what CI runs, so no hand-maintained file list.
- Output is asserted with stable substrings, not full-output snapshots that
  break on every wording tweak.
- No real provider API keys required.
- Temp files go in a temp directory and are cleaned up.

## Notes

Keep it lightweight. The goal is to make CLI wording safe to refactor, not to
freeze it. If an assertion would break on a harmless copy edit, it is too tight.
