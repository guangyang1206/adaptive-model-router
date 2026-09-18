# ADR-002 — BUILTIN_WEIGHTS is frozen byte-for-byte at its MVP-1 values

- Status: Accepted (2026-07-14)
- Deciders: maintainers
- Source commit: `185c710` (MVP-2 — made weights configurable, and froze the default)

## Context

Through MVP-1 the scoring weights were hard-coded inside `scoreModel`. MVP-2
introduced route-outcome learning, which needs weights to be a first-class,
substitutable value so a candidate weight set can be evaluated against a
baseline.

Extracting hard-coded constants into a named default is the moment a
regression becomes invisible. Routing is a ranking function: changing
`tierMatch` from 40 to 41 does not produce an error, it produces a different
model choice for some subset of requests. Nothing in a type system, a lint
run, or a build catches it. The first signal is a user reporting that their
routing changed after a patch upgrade — with no way to correlate it to a diff.

The project also promises MVP-1 behavioural compatibility in `README.md` and
`docs/en/architecture.md`. That promise is only meaningful if the default
weights are bit-identical to the constants MVP-1 used.

## Decision

`BUILTIN_WEIGHTS` (`packages/sdk/src/index.ts:48-56`) holds the exact MVP-1
constants and is treated as frozen:

```ts
{
  version: "builtin",
  tierMatch: 40,
  tierMismatch: 10,
  successRate: 15,
  latency: { low: 10, medium: 6, high: 3 },
  costCoefficient: 100,
  health: { ok: 30, degraded: 15, limited: 12, unknown: 8, down: 0 },
}
```

Tuning happens by passing `config.weights`
(`packages/sdk/src/index.ts:86` — `config.weights ?? BUILTIN_WEIGHTS`), never
by editing the default.

The freeze is locked by a test, not by a comment.
`packages/sdk/test/mvp1-compat.test.mjs:50-60` asserts the literal object with
`assert.deepEqual`, so any edit to any field fails CI. Two further tests in
the same file pin the behaviour around it: line 62 reproduces the MVP-1 score
arithmetic end to end, and line 111 asserts that explicitly passing
`BUILTIN_WEIGHTS` is indistinguishable from passing nothing — which is what
makes the default substitutable without a behaviour change.

That the test *catches* drift was measured, not assumed. Mutating a single
weight by one unit in an isolated copy of the package
(`tierMatch: 40` → `41` in the compiled `dist/index.js`) turns a green run
into two failures:

```
baseline                      # tests 5  # pass 5  # fail 0

after tierMatch 40 -> 41
not ok 1 - BUILTIN_WEIGHTS holds the exact MVP-1 hard-coded values
    Expected values to be strictly deep-equal:
    +   tierMatch: 41,
    -   tierMatch: 40,
not ok 2 - scoreModel with BUILTIN_WEIGHTS reproduces the MVP-1 score arithmetic
                              # tests 5  # pass 3  # fail 2
```

The two failures are one cause, not two confirmations: `scoreModel` consumes
`BUILTIN_WEIGHTS`, so a single mutation trips both. What they pin is different,
and that is the useful part — the snapshot pins the **table**, the arithmetic
test pins the **use** of the table. A change that broke `scoreModel` while
leaving the table intact would trip only the second. Either way, a one-unit
weight change is not merely discouraged; it is unmergeable.

Learned weights are derived, never promoted in place:
`packages/sdk/src/dashboard-readers.ts:299` falls back to `BUILTIN_WEIGHTS` as
the baseline, and `proposeWeights` always returns `adopted: false`
(`packages/sdk/src/learning.ts:93,151`), so a human must promote a candidate
explicitly via `createWeightsRegistry(...).adopt(version)`
(`packages/sdk/src/learning.ts:221`).

## Consequences

Positive:

- A routing regression caused by weight drift is impossible to merge; the
  failure is a specific assertion naming the field, not a vague behaviour
  report from a user.
- "MVP-1 compatible" is a checked property rather than a claim in a README.
- Because the frozen default is also the learning baseline, every weight
  proposal is measured against the same fixed reference across releases.

Negative:

- The default weights can never be improved, even when evidence says they
  should be. A better weight set has to ship as documented configuration or as
  an opt-in learned proposal, which is strictly more work than editing a
  constant.
- The values carry no derivation. They were chosen in MVP-1 and are now
  preserved for compatibility rather than because they are optimal. Freezing
  locks in that arbitrariness.
- A genuine future change requires a major version and an explicit migration
  note. There is no cheap path.
- The test asserts the literal shape, so adding a legitimately new weight
  dimension means editing the compatibility test — the one place where
  carelessness is most expensive.

## Alternatives considered

- **Comment the constant as "do not change".** Rejected: comments do not fail
  builds. This exact class of silent drift is what the snapshot test exists
  to prevent.
- **Version the weights and let the router pick the newest.** Rejected for
  MVP-2: it moves the compatibility problem to resolution order and makes a
  patch upgrade able to change routing. The `version` field on `RouteWeights`
  keeps this option open without taking it.
- **Auto-adopt learned weights that beat the baseline on evals.** Rejected.
  An offline eval win is not proof of a production win, and silent adoption
  would make routing non-reproducible. `proposeWeights` returns
  `adopted: false` unconditionally (`packages/sdk/src/learning.ts:151`).

## Related ADRs

- ADR-003 — degradation notes must surface so a changed decision is never
  silent
