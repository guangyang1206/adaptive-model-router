# Improve SQLite support beyond fallback mode

Labels: `help wanted`, `storage`

## Summary

Improve SQLite compatibility and tests across Node versions.

## Current behavior

`createSQLiteTraceStore()` uses Node's built-in `node:sqlite` when available and falls back to JSONL when unavailable and `fallbackPath` is provided.

## Scope

Potential improvements:

- better runtime detection for `node:sqlite`
- clearer error messages when SQLite is unavailable
- compatibility notes for Node versions
- tests for fallback behavior
- optional adapter boundary for external SQLite libraries in the future

## Acceptance criteria

- Existing JSONL fallback behavior remains intact.
- TypeScript build passes.
- Storage tests pass.
- Docs explain SQLite availability and fallback clearly.

## Non-goals

- Do not add a mandatory native SQLite dependency in MVP-0.
