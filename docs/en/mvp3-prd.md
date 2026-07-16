# MVP-3 PRD — Team-Hosted Control Plane

## One-line product definition

> Adaptive Model Router is an open-source, SDK-first LLM router. MVP-3 upgrades it
> from a **local, single-machine dashboard** into a **lightweight hosted control
> plane** where a team can log in, and members see the routing decisions of the
> projects they belong to — deployable with a single command.

## Scope discipline

MVP-3 follows one main line only: **turn the local dashboard into a multi-user
hosted form + a one-click deploy template.** Fine-grained RBAC, full audit logs,
budget alerts, and SaaS billing are explicitly deferred to MVP-4+ (see
[Won't have this MVP](#wont-have-this-mvp)).

Architecture guardrails (confirmed):
- The zero-dependency rule of `@adaptive-router/sdk` is inviolable. The hosted
  layer is a **separate control-plane**; SDK consumers can still embed with zero
  dependencies.
- Standard cloud components (Postgres, OAuth) are allowed **only** in the new
  control-plane layer. Default storage stays light — a single Postgres instance
  should be enough to run; do not force ClickHouse/MinIO-class heavy components.

---

## Target users

### Primary — platform / infrastructure lead of a small team (2–15 people)

- **Scenario**: several members / apps on the team already use the router. They
  want one place everyone can log in to and see routing decisions and fallback
  behavior per project — instead of each person running a local dashboard.
- **Technical level**: comfortable with Docker or one-click deploy
  (Railway / Render / Fly), but **no dedicated DevOps**. Unwilling to operate a
  ClickHouse cluster just to view routing decisions.
- **Core need**: **collaborative visibility + low startup cost**.

### Secondary — SaaS developer embedding routing into their own product

- **Scenario**: offers "multi-provider smart routing" inside their own SaaS.
  Needs to isolate routing data per customer/environment and wants to self-host
  to own the data.
- **Fit with the two-tier model**: uses **Org = themselves, Project = each
  customer/environment** for isolation. Needs clear project boundaries and a
  smooth future path to multi-tenancy (this MVP only draws the boundary; no
  billing).

---

## Core problem

- **Current state**: the dashboard is local, single-machine, no auth, no
  multi-user. In team settings everyone runs it locally, routing data is not
  shared, and nobody can see "how the team routes overall / which provider keeps
  falling back."
- **Why it fails now**: the moment more than one person uses it, the local
  dashboard breaks down — there is no shared, access-controlled place to view
  data.
- **Why not just adopt a competitor**: Langfuse/Helicone can do team
  collaboration, but their self-hosted stacks are heavy (6 containers / 16 GB),
  and they are **observability platforms, not a routing brain**. The user already
  chose our SDK routing capability — what's missing is a team-facing front door.

---

## Competitor comparison

| Product | Form | Team collaboration | Self-host complexity | OSS / SaaS boundary | Negative feedback / gap (real pain) |
|---|---|---|---|---|---|
| **Langfuse** | Observability platform | Org / Project / Member, SSO | **Heavy**: Postgres + ClickHouse + Redis + MinIO + Worker + Web (6 containers), ~16 GB VM recommended | Core OSS; SSO enforcement / EE mgmt API require enterprise license | High startup barrier, ~30 min install, "operate ClickHouse just to see traces" |
| **Helicone** | Observability proxy | Teams / orgs | Medium-heavy (docker, external deps) | OSS + Cloud; advanced team features skew Cloud | Self-host trails cloud in features; proxy-in-path latency concerns |
| **Portkey** | AI gateway control plane | Multi-team / virtual keys | Gateway is Apache-2.0 self-hostable, but **prompt mgmt / analytics UI is proprietary** | Gateway OSS, control plane SaaS | Pure-OSS team collaboration UI unavailable; lock-in risk |
| **LiteLLM proxy** | Self-hosted gateway | Multi-tenant / budgets / keys (platform-team oriented) | Medium: run and scale the gateway yourself; SSO/audit are enterprise | MIT core + Enterprise (SSO/audit paid) | Ops burden, gateway becomes a tier-0 dependency, SSO/audit paid |
| **OpenRouter** *(alternative)* | Pure cloud routing API | Weak (accounts / credits) | No self-host | Full SaaS | No self-host; data flows through their infra; routing behavior not controllable |
| **Merge Gateway** *(alternative)* | Hosted control plane | Yes | No self-host (hosted) | SaaS-first | Hosted; no open-source self-host path |

**The gap the negative feedback exposes**: every self-hostable option that does
team collaboration is either **too heavy** or keeps the **key collaboration UI
behind a paywall / in the cloud**. **Nobody offers a lightweight, fully
open-source, one-command-start team-level routing dashboard** — which is exactly
where MVP-3 lands.

---

## Our differentiation

Why users pick us over Langfuse / Portkey:

1. We are the **routing brain** (capability fit + health + latency + cost +
   fallback), not after-the-fact observability. The data is inherently "routing
   decisions," not generic traces.
2. **Startup-friendly**: target one-command / one-click template deploy, with a
   single lightweight data store by default (single Postgres instance; no forced
   ClickHouse), aligned with "team + easy to start."
3. **SDK zero-dependency rule unbroken**: the hosted layer is an independent
   control-plane; SDK users keep embedding with zero dependencies.

---

## Organization model — two tiers

MVP-3 adopts a **two-tier `Organization → Project`** model (confirmed):

```text
Organization  ── carries the team: users, membership, roles
   └── Project ── carries routing-decision data ownership (ingest scope)
```

- **Organization** holds the team and its members.
- **Project** is the ownership scope for routing-decision data; a member sees
  the decisions of the projects they belong to.
- The secondary user (SaaS developer) maps this cleanly: **Org = themselves,
  Project = each customer/environment.**

---

## MVP-3 scope (P0 / P1 + RICE)

RICE = (Reach × Impact × Confidence) / Effort. Reach/Effort are relative scales,
Impact 1–3, Confidence 0–1.

| Feature | Description | Reach | Impact | Conf | Effort | Score | Tier |
|---|---|---|---|---|---|---|---|
| Authenticated login (multi-user) | Email/password + at least one OAuth (GitHub/Google); first registrant becomes admin; registration can be closed | 10 | 3 | 0.9 | 4 | **6.75** | **P0** |
| Two-tier Org → Project isolation + membership | Data owned per project; a user sees only routing decisions of projects they belong to; members can be added to a project within their Org | 9 | 3 | 0.8 | 4 | **5.4** | **P0** |
| One-click deploy template | One command / one-click template (docker-compose + at least one Railway/Render/Fly template), with minimal persistence | 8 | 3 | 0.8 | 3 | **6.4** | **P0** |
| Hosted persistence backend | Control-plane persists routing decisions in standard cloud storage (single lightweight DB by default) to enable multi-user sharing | 10 | 2 | 0.8 | 3 | **5.33** | **P0** (carries P0, architect-led) |
| **SDK → control-plane ingest path** | Per-project ingest token; SDK, once configured, POSTs router traces to the control-plane (closes the "everyone sees the same project data" loop) | 10 | 3 | 0.85 | 3 | **8.5** | **P0** |
| Member invitation flow | Invite link / email to add a member to a project | 7 | 2 | 0.7 | 3 | **3.27** | **P1** |
| Deployment health self-check page | A `/health` + guide page confirming components are ready | 6 | 2 | 0.8 | 2 | **4.8** | **P1** |

> **P0** = authenticated login; two-tier Org → Project isolation + membership;
> one-click deploy template; hosted persistence backend; and the **SDK →
> control-plane ingest path** (added — it is the necessary closing loop for
> "multiple people see the same project's data"). **P1** = member invitation,
> health self-check page — they do not block the main line.

### Roles in MVP-3

MVP-3 ships **two role tiers only: `owner` and `member`** (confirmed as the
implemented scope):

- `owner`: manages the Org and its projects/members, can close registration.
- `member`: belongs to one or more projects, sees those projects' routing
  decisions.

A four-tier role UI may be **reserved/mocked** in the interface, but
fine-grained permission enforcement is deferred (see
[Won't have this MVP](#wont-have-this-mvp)).

---

## Acceptance criteria (Given / When / Then)

**Authenticated login**
- Given a freshly deployed instance, When the first user registers, Then that
  user becomes the admin (`owner`) and can close further registration in
  settings.
- Given an unauthenticated user, When they visit any dashboard page, Then they
  are redirected to login and can see no routing data.
- Given OAuth is configured, When a user logs in with GitHub/Google, Then an
  account is created/linked and they land in the projects they belong to.

**Two-tier Org → Project isolation + membership**
- Given user A belongs only to Project X (within their Org), When they log in,
  Then they see only Project X's routing decisions, not Project Y's.
- Given a routing-decision record, When it is written to the control-plane, Then
  it must carry Project ownership; records without ownership are shown to no
  regular member.

**One-click deploy template**
- Given a clean machine with Docker, When the operator runs the single documented
  command (docker compose up or a one-click template), Then within ~3 minutes the
  dashboard is reachable in a browser and enters the first-registration flow.
- Given a completed deployment, When services restart, Then produced routing
  decisions and user/project data are not lost (persistence works).

**Hosted persistence backend**
- Given two members of the same project log in separately, When the application
  produces a new routing decision, Then both see the same decision in their own
  sessions (shared data, not local).

**SDK → control-plane ingest path**
- Given the SDK is configured with a given project's ingest token, When a routing
  decision is produced, Then that decision appears in the control-plane under the
  corresponding project.
- Given no ingest token is configured, When routing decisions are produced, Then
  the SDK behaves exactly as before (no upload, zero-dependency, honest
  no-op) — reporting is strictly opt-in.

**Boundary conditions to cover**: empty state (guide for a new project with no
decision data), error state (OAuth callback failure, DB unreachable, invalid/
expired ingest token), loading state, permission denial (cross-project access
returns 403 rather than leaking), concurrent logins, and clear errors when
required environment variables are missing at deploy time.

---

## Won't have this MVP

| Deferred feature | Reason |
|---|---|
| Fine-grained RBAC (role/permission matrix) | MVP-3 needs only Org → Project isolation + two tiers (`owner`/`member`). A **four-tier role UI may be reserved/mocked, but fine-grained permission enforcement is deferred to MVP-4+**; adding it now would blow up scope |
| Full audit logs | Compliance-oriented; user set the tone "not heavyweight enterprise compliance" — deferred |
| Team budget alerts | Needs cost aggregation + alerting pipeline; a separate main line, MVP-4+ |
| SaaS-grade multi-tenant billing | This MVP draws only the project boundary; no tenant billing/invoicing, to avoid premature billing complexity |
| SSO enforcement / enterprise directory (SAML/SCIM) | OAuth is enough for starter teams; enterprise SSO is MVP-4+ |
| Dashboard becoming writable (editing routing weights, etc.) | Keep the MVP-2 human-in-the-loop, read-only stance; write operations are a separate main line |

---

## Success metrics

- **Activation**: from "clone / click one-click deploy" to "first user logs in and
  sees a routing decision" ≤ 5 minutes (vs. Langfuse's ~30-min install — this is
  our core selling point).
- **Collaboration**: ≥ 60% of deployed instances have ≥ 2 user accounts within 7
  days of deployment (proof of real multi-user use, not a single-machine
  replacement).
- **Isolation correctness**: cross-project unauthorized access rejection rate =
  100% (zero data leakage — hard metric).
- **Ingest loop**: for an SDK configured with an ingest token, ≥ 95% of routing
  decisions appear under the correct project in the control-plane.
- **Deploy success**: following the documented single command, first-try success
  rate ≥ 90% (failures produce readable errors).
- **Guardrail compliance**: `@adaptive-router/sdk` dependency count stays 0
  (CI-verified, non-regressable).

---

## Notes for the architect

1. The control-plane may use standard cloud components, but **default storage must
   stay light** — a single Postgres instance should be enough to run; do not force
   ClickHouse/MinIO-class heavy components, to protect the "5-minute activation"
   metric.
2. SDK zero-dependency is a hard guardrail; the hosted layer and the SDK must be
   cleanly decoupled. The ingest path must be **opt-in** and degrade honestly when
   unconfigured, consistent with the SDK's existing honest-degradation invariant.
