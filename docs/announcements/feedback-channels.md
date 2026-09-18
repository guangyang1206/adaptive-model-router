# Feedback channels — design recommendation

> Status: recommendation, not yet applied. The Discussions settings and the one
> proposed issue template are changes to shared GitHub surfaces, so they are
> written out here ready to apply rather than applied unilaterally.
> Date: 2026-09-18.

## The problem this is solving

`0.1.0` is published and nobody knows it exists. The next milestone's scope is
deliberately unlocked until there is real usage to point at. That makes one
specific signal the bottleneck: **what people use this for, and where it
disappoints them.**

Note what is *not* the bottleneck. Bug intake is already fine. The gap is
narrower than "we need feedback" — it is that a person who installed the SDK,
wired two models, and hit something confusing currently has nowhere natural to
say so. Issues feel too formal for "this was weird," and there is no Discussions
category inviting it.

## What already exists — assessment

Read before designing anything, to avoid rebuilding working parts.

| File | Verdict |
| --- | --- |
| `bug_report.yml` | Keep as-is. Requires summary, repro steps, expected behavior; has a `routerTrace` field and an `Area` dropdown covering all seven subsystems. Warns against pasting secrets. Solid. |
| `feature_request.yml` | Keep as-is. Asks for the *problem* before the proposal, which is the right order, and has a `Scope` dropdown. |
| `provider_adapter.yml` | Fixed 2026-09-18. Its placeholder read "Qwen, Gemini, vLLM, SGLang" — the first three shipped in MVP-1, so the template was inviting requests for work already done. Now lists uncovered providers and states what is already supported. |
| `config.yml` | `blank_issues_enabled: true`, plus one contact link to Discussions. Needs two more links (below), otherwise fine. |

So: three templates are adequate, one was stale and is fixed. **No new bug or
feature intake is needed.** Everything below is about the adoption-signal gap.

## Recommendation 1 — configure four Discussions categories

GitHub ships six default categories (Announcements, General, Ideas, Polls, Q&A,
Show and tell). The cheapest useful configuration is to **delete two, rename
one, and write a one-line description for each survivor.** No custom categories,
no forms to maintain.

| Category | Format | Purpose |
| --- | --- | --- |
| **Announcements** | Announcement (maintainer-only) | Releases. The `0.1.0` post goes here and gets pinned. |
| **What are you routing?** | Open-ended | Renamed from "Show and tell". The adoption-signal channel. Which models, which steps, what made a router necessary. |
| **Q&A** | Question / Answer | Install, config, provider auth. Accepted answers make it searchable, which matters more than it sounds for a solo-maintained project — the same install question gets asked repeatedly. |
| **Ideas** | Open-ended | Half-formed feature thoughts, before they are concrete enough for `feature_request.yml`. |

Delete **General** (becomes a dumping ground that competes with Q&A) and
**Polls** (needs an audience to be meaningful; there isn't one yet).

Category descriptions matter more than the names. For "What are you routing?",
something like: *"Which models, which agent steps, and what made you reach for a
router. Partial setups and abandoned attempts are equally useful."* The phrase
about abandoned attempts is deliberate — people do not volunteer failures unless
explicitly invited to.

Then **pin exactly one discussion**: the `0.1.0` announcement. Pinning three
things pins nothing.

## Recommendation 2 — add one issue template, not two

### Add: `routing_decision.yml` — "the router picked the wrong model"

This is the one genuinely missing intake path, and it belongs in **Issues**, not
Discussions, because it is actionable and reproducible.

`bug_report.yml` half-covers it: it has a `routerTrace` field. But it frames the
report as *something broke*, and a wrong-but-successful routing decision did not
break — it returned a 200. The reporter will not file a bug for it. More
importantly, `bug_report.yml` never asks the question that makes such a report
useful: **which model did you expect instead, and why?** Without that, a trace
is just a log.

```yaml
name: Routing decision looks wrong
description: The router succeeded, but picked a model you would not have picked.
title: "routing: "
labels: [routing, needs-triage]
body:
  - type: markdown
    attributes:
      value: |
        For decisions that worked but look wrong. If something threw or hung, use the bug report instead.
        Redact prompts — the routing decision is usually reproducible without your real content.
  - type: textarea
    id: trace
    attributes:
      label: routerTrace
      description: "Set `explain: true` on the route to get the full candidate list."
      render: json
    validations:
      required: true
  - type: input
    id: expected
    attributes:
      label: Which model did you expect?
      placeholder: anthropic/claude-sonnet-4
    validations:
      required: true
  - type: textarea
    id: why
    attributes:
      label: Why that one?
      description: What does it do better for this step — quality, latency, cost, a specific capability?
    validations:
      required: true
  - type: textarea
    id: route
    attributes:
      label: Route constraints you passed
      description: The `route` object — task, quality, stability, latencyMs, maxCostUsd.
      render: ts
  - type: dropdown
    id: step
    attributes:
      label: Which agent step was this?
      options:
        - Planning
        - Tool calling
        - Code generation
        - Extraction / structured output
        - Summarization
        - Final answer
        - Other
    validations:
      required: true
```

The `step` dropdown is doing double duty. It collects triage context, and
aggregated across reports it answers a roadmap question directly: which agent
step do people actually route on? That is a scope input no survey would get
honestly.

### Do not add: a general "tell us your use case" issue template

Tempting, and the wrong call. Use-case prose in the issue tracker creates items
that can never be closed — an open issue count inflated with unclosable threads
makes the tracker useless for its real job, and a solo maintainer will end up
closing them with a guilty comment. That content belongs in the "What are you
routing?" Discussions category, which has no open/closed semantics.

Surface it where people already are by adding contact links to `config.yml`:

```yaml
blank_issues_enabled: true
contact_links:
  - name: What are you routing?
    url: https://github.com/guangyang1206/adaptive-model-router/discussions/categories/what-are-you-routing
    about: Share your setup — which models, which agent steps, what made a router necessary.
  - name: Question or install problem
    url: https://github.com/guangyang1206/adaptive-model-router/discussions/categories/q-a
    about: Ask before filing — install, config, and provider auth questions get answered here.
  - name: Project discussion
    url: https://github.com/guangyang1206/adaptive-model-router/discussions
    about: Everything else.
```

The category slugs must be confirmed after the categories are created; GitHub
generates them from the names and a wrong slug produces a dead link in the issue
chooser.

## Recommendation 3 — how the announcement asks without begging

Already implemented in `v0.1.0-release.md`. Recording the reasoning so it
survives future edits:

- **Name the vanity metric and decline it.** The section opens "Not stars."
  Refusing the easy ask is what makes the real ask credible.
- **Request an artifact, not an opinion.** "A `routerTrace` where the chosen
  model is not what you would have picked" is a concrete deliverable someone can
  produce in a minute. "Let us know what you think" asks the reader to do the
  work of figuring out what would help.
- **Say why it is valuable.** The trace is described as self-contained and
  reproducible. People contribute more readily when they can see the mechanism
  by which their effort matters.
- **Give a reason the request is honest.** "Early friction is invisible to
  whoever wrote it" is true, and it reframes the reader as having information
  the maintainer structurally cannot have.
- **Rank the asks.** Three, numbered, most valuable first. An unranked list of
  eight ways to help produces zero.
- **Send people away when appropriate.** "If a gateway already covers your case,
  use the gateway." This costs a few users and buys the credibility that makes
  the rest of the post believable.

What is deliberately absent: no "we'd love to hear from you", no roadmap-voting
promise, no "join our community." There is no community yet, and pretending
otherwise is the fastest way to lose a technical reader.

## Maintenance budget

The constraint that shaped all of the above: one maintainer, and a mechanism
nobody tends is worse than no mechanism, because a dead Discussions category
signals an abandoned project.

Total ongoing cost of this design: **one pass per week.**

- Answer anything in Q&A. Unanswered questions are the worst signal a repo can
  emit.
- Reply once to anything in "What are you routing?" — a real question about
  their setup, not "thanks for sharing."
- Convert wrong-decision reports into either a fix or an explicit "working as
  intended, here is why."
- Ignore Ideas until something recurs. One person wanting a feature is noise.

Explicit non-goals, so this does not grow:

- No Discord or Slack. Real-time chat implies response-time expectations that
  cannot be met, and the knowledge in it is unsearchable.
- No newsletter, no roadmap voting board, no survey forms.
- No issue-triage automation before there is a triage problem.

**Kill criterion:** if a Discussions category has zero posts after 60 days,
delete it. An empty category is evidence of neglect; four categories where two
are lively reads better than four where two are barren.

## Apply checklist

1. Settings → Discussions: delete General and Polls; rename "Show and tell" to
   "What are you routing?"; write one-line descriptions for all four.
2. Post `v0.1.0-release.md` (English section, or the short Discussions opener)
   to Announcements. Pin it. Pin nothing else.
3. Confirm the generated category slugs, then update `config.yml` with the
   contact links above.
4. Create `.github/ISSUE_TEMPLATE/routing_decision.yml` from the block above.
5. Do not create a use-case issue template.
