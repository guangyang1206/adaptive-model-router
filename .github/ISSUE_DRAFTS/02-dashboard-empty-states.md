# Improve dashboard empty states

Labels: `good first issue`, `dashboard`

## Summary

Polish the local dashboard empty states so first-time users know what to do next.

Today they are bare placeholders. `packages/dashboard/src/index.ts:621` renders
`<div class="empty">No data.</div>`, and line 651 renders
`No evaluated cases yet.` Neither tells a first-time user whether the setup is
broken or simply has no traffic yet, and neither offers a next step.

## Scope

Improve empty states for:

- no requests yet
- no models configured
- failed API read

While you are in there: the baseline empty state at
`packages/dashboard/src/index.ts:849` mixes Chinese and English in a single
string. Pick one language per string to match the rest of the UI.

## Acceptance criteria

- Empty states are clear and action-oriented.
- Requests page links to Quickstart when no traces exist.
- Models page explains how to configure models.
- Failed API read state is readable and not only color-based.
- Design stays dark, minimal, and developer-tool oriented.

## Non-goals

- Do not add a full onboarding wizard.
- Do not add SaaS/project/team setup flows.
