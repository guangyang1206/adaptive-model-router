# Add CLI help snapshots

Labels: `good first issue`, `cli`, `tests`

## Summary

Add CLI smoke tests that capture stable help and command output.

## Commands to cover

```bash
adaptive-router help
adaptive-router init
adaptive-router doctor
```

## Acceptance criteria

- Tests run with Node's built-in test runner.
- Output is asserted using stable strings, not brittle full snapshots.
- Tests do not require real provider API keys.
- Temporary files are created in a temp directory and cleaned up.

## Notes

The goal is to make CLI behavior safer to refactor while keeping tests lightweight.
