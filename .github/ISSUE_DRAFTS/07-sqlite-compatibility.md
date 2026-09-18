# Bring the SQLite store to event-stream parity with JSONL

Labels: `help wanted`, `storage`

## Summary

The SQLite store does not record the `cache_lookup` and `weights_change` event
streams that the JSONL store retains. Pick SQLite and those two streams are
silently absent — which is exactly the kind of quiet gap this project tries not
to ship.

This is a known P2 follow-up from MVP-2, also listed in `CONTRIBUTOR_TASKS.md`.

## Current behavior — verified

- `createSQLiteTraceStore()` (`packages/sdk/src/storage.ts:249`) loads
  `node:sqlite` via a guarded dynamic import, and on failure falls back to
  JSONL when `fallbackPath` is set, or throws a named error when it is not
  (`storage.ts:257-262`).
- The JSONL store appends both streams —
  `writeCacheLookup` → `cache_lookup` (`storage.ts:224`) and the
  `weights_change` event (`storage.ts:239`) — and can read them back
  (`storage.ts:228`, `storage.ts:243`).
- The SQLite store deliberately omits both. See the comment at
  `storage.ts:360-362`: *"cache_lookup + weights_change are event streams;
  SQLite path keeps them in memory-free no-ops."*

The consequence: dashboard views fed by cache-lookup data (see
`packages/sdk/test/dashboard-readers.test.mjs:235`) render empty on a
SQLite-backed store, and nothing tells the user why.

## Scope

- Add append-only tables for the two event streams and implement the writers and
  readers so SQLite matches JSONL's observable behavior.
- Keep `node:sqlite` optional and the JSONL fallback intact.
- Add tests that assert parity directly: write the same events to both stores,
  read both back, and assert the results match. Guard on SQLite availability the
  way `packages/sdk/test/storage-mvp2.test.mjs:8-13` already does.
- If full parity is not reached, the store must **say so** rather than return an
  empty list that looks like "no events".

## Acceptance criteria

- Existing JSONL behavior unchanged.
- A SQLite-backed store returns the same cache-lookup and weights-change
  history as a JSONL-backed store given the same writes.
- `pnpm typecheck` and the storage tests pass.
- Docs state which store supports what — no implied parity that does not exist.

## Non-goals

- Do not add a mandatory native SQLite dependency. `node:sqlite` stays optional
  and the SDK keeps `dependencies: {}`.
- Do not migrate existing JSONL files automatically.

## Note on scope overlap

The earlier framing of this issue ("improve SQLite support beyond fallback
mode") listed runtime detection and clearer error messages as the work. Both
already shipped — `storage.ts:251` and `storage.ts:257-262`. Event-stream parity
is the part that is genuinely still open, so this draft was narrowed to it.
