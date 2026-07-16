# MVP-3 UIUX — Hosted Control Plane

> Scope: MVP-3 turns the local, read-only, single-user dashboard into a **multi-user, hosted control plane** — team members log in, switch between organizations and projects, and view their own project's routing decisions and model comparisons. The core Requests / Models pages keep their existing shape; we layer collaboration and data-ownership context on top rather than rebuilding them.

**Summary (3 sentences)**
1. The design direction is a fusion of **Linear** (restrained, keyboard-first interaction), **Vercel Dashboard** ("project as filter" navigation), and **Langfuse** (Organization → Project → Key domain hierarchy), staying fully consistent with the existing dashboard's dark developer-tool tone (Lucide-only, no purple gradients, every routing decision explainable).
2. Three new capability entry points — **auth/login**, **Organization + Project switching**, and **multi-user identity** — are carried by a single collapsible left Sidebar; the **Requests** and **Models** pages keep their current form and only gain project-ownership context and a "who is looking" collaboration layer.
3. The theme is **dark-primary** (consistent with the existing dashboard and friendly for developers' night-time use); startup-friendliness comes from **progressive empty states + a three-step onboarding checklist + one-click deploy guidance**, not a marketing hero.

---

## 1. Design Direction & Benchmark Brands

| Dimension | Benchmark | What we borrow | Why it fits this project |
|---|---|---|---|
| Interaction & restraint | **Linear** | Org switcher pinned to sidebar top, avatar dropdown for settings/logout, collapsible groups, `⌘K` global search, full keyboard reachability | Users are engineers who want "light, fast, non-intrusive"; Linear is the gold standard for restrained developer UX |
| Navigation structure | **Vercel Dashboard (2026 redesign)** | "Projects as filters" — the same Requests page switches between org-level and project-level in one click; org and project levels share consistent tabs | Directly solves the MVP-3 core need: many people view **their own project's** routing decisions without duplicating a page per project |
| Domain hierarchy | **Langfuse** | Organization → Project → API Key three tiers; Traces as the home base; members/keys managed centrally under Settings | Directly maps the "provide routing capability to a team / upstream SaaS" multi-tenant need, and it is an open-source self-hosted peer, so the mental model is familiar |

**Explicit trade-offs**: no Helicone-style heavy marketing landing page, no enterprise-dense dashboard. The positioning is a **startup-friendly team collaboration control plane** — the first screen gets people to their own routing decisions within three steps.

---

## 2. Color Foundation (Design Tokens · dark-primary)

Continuing the existing dark developer tone, the primary color is **Indigo `#6366F1`** (neutral-cool, developer-tool appropriate, non-purple/pink, harmonious with the existing GitHub-dark base).

```css
:root[data-theme="dark"] {
  /* Background layers */
  --bg-primary:    #0D1117;   /* page base */
  --bg-surface:    #161B22;   /* cards / table containers */
  --bg-elevated:   #21262D;   /* popovers / dropdowns / switchers */
  --bg-overlay:    rgba(0,0,0,0.6);

  /* Text */
  --text-primary:  #F0F6FC;
  --text-secondary:#8B949E;
  --text-muted:    #484F58;

  /* Brand color (Indigo, no purple gradient) */
  --color-primary:        #6366F1;
  --color-primary-hover:  #818CF8;
  --color-primary-subtle: rgba(99,102,241,0.12);

  /* Semantic colors — routing decisions */
  --color-success: #3FB950;   /* hit / healthy */
  --color-warning: #D29922;   /* fallback / degraded */
  --color-error:   #F85149;   /* failure / timeout */
  --color-info:    #58A6FF;   /* routing annotation */

  /* Borders / radius / shadow */
  --border-default: #30363D;
  --border-focus:   #6366F1;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-glow: 0 0 40px rgba(99,102,241,0.10);

  /* Motion */
  --duration-fast: 150ms; --duration-normal: 250ms;
  --easing-smooth: cubic-bezier(0.4,0,0.2,1);
}
```

A **light theme is provided as a settings option** (same semantic variables, different values), but dark is the default. Rationale: the existing dashboard is already dark, developers use it heavily at night, and the routing semantic colors (red/amber/green) have stronger contrast on a dark base.

**Project accent**: each project is assigned an accent from a fixed 8-color palette (used for the switcher dot and breadcrumb tag) to help multi-project users quickly tell which data belongs where — but it never affects the primary color system, avoiding visual noise.

---

## 3. Typography

```css
--font-display: "Inter", "Noto Sans SC", -apple-system, sans-serif;
--font-body:    "Inter", "Noto Sans SC", -apple-system, sans-serif;
--font-mono:    "JetBrains Mono", "Fira Code", monospace;  /* request id / model id / latency / token counts */
```

Only 7 sizes: 12 / 14 / 16 / 18 / 20 / 24 / 32. Tables and technical identifiers (`request_id`, `model`, `cost`, `latency`, ingest tokens) are **always monospace** — this is key to the developer sense of trust.

---

## 4. Overall Style Keywords

`restrained · developer-facing · explainable · collaboration-friendly · frictionless start · honest data (real content, not placeholders)`

Icons: **Lucide only** (16 inline / 20 in-button / 24 standalone). No emoji, no purple/pink gradients, no abstract AI hero, no model-marketplace language.

---

## 5. Page Inventory

### New

| Page | Description |
|---|---|
| **Login / Auth** | Email + OAuth (GitHub/Google), self-host friendly; includes an SSO placeholder area |
| **Onboarding / Create organization** | On first login, guides Create Organization → first Project → get ingest token (three-step checklist) |
| **Organization + Project switcher** | Sidebar-top switcher (Linear-style): switch Organization at the top, switch/filter Project below (Vercel-style project-as-filter) |
| **Settings › Members** | Member list + role (**owner / member** in MVP-3) + invite via link/email |
| **Settings › API Keys (ingest tokens)** | Generate/revoke **ingest tokens** per project (used by the SDK to report routing decisions); entry point for deploy guidance |
| **Empty / empty-state family** | Guided states for no project, no request data, no members |

### Reused & Evolved (not rebuilt)

| Page | Evolution |
|---|---|
| **Requests / Routing Decisions** | Keep the table + server-side filtering shape; add a **breadcrumb (Organization / Project)** to make data ownership explicit; add a project dimension to filters; the decision-detail drawer keeps "every step explainable"; show the member who triggered each request inline (collaboration layer) |
| **Models** | Keep the model-comparison shape; scope bound to the current project; comparison results annotated "based on this project's last N decisions" |

---

## 6. Key Page Layouts

### 6.1 Global Frame (App Shell)

```
┌───────────┬─────────────────────────────────────────┐
│  SIDEBAR  │  TOP BAR: breadcrumb Organization / Proj │
│ (collapse │           ─────────────  ⌘K search · Avat│
│  resizable├─────────────────────────────────────────┤
│           │                                           │
│ ◐ Org ▾   │   Content area                            │
│ ─────────  │   (Requests table / Models compare / Set)│
│ ● Project▾│                                           │
│           │                                           │
│ Requests  │                                           │
│ Models    │                                           │
│ ─────────  │                                           │
│ Settings  │                                           │
│ ─────────  │                                           │
│ + Invite  │                                           │
│ ( ) avatar│  (avatar menu: Settings / Theme / Logout) │
└───────────┴─────────────────────────────────────────┘
```

- **Sidebar top**: Organization switcher (opens a list of all organizations + "New organization").
- **Project row**: carries the project accent dot; clicking opens a searchable project list; selecting one applies it as a global filter — Requests/Models immediately switch to that project's data. Also supports "All projects" (org-level view).
- **Nav items**: Requests / Models / Settings — Lucide icon + label; collapsed to icon-only with tooltips.
- **Bottom**: Invite people, avatar dropdown (Settings / theme toggle / Logout).
- Global `⌘K`: search `request_id` / model / member across projects.
- Accessibility: every item has a `focus-visible` 2px ring, is Tab-reachable, and `prefers-reduced-motion` disables transitions.

### 6.2 Login / Auth

- Single centered column card (`--bg-surface`, `--radius-lg`, subtle `--shadow-glow`), **not a marketing hero**.
- Logo + one-line product positioning ("Self-hosted LLM routing control plane" — real copy, not "Welcome to").
- Primary CTA: Continue with GitHub / Google (simple outlined brand marks via Lucide); secondary: email magic link; SSO placeholder at the bottom.
- State coverage: Default / Loading (in-button spinner) / Error ("Invalid credentials" inline hint in `--color-error`).

### 6.3 Onboarding (startup-friendliness core)

On first login, land on a **three-step checklist** (progress bar + a checkmark per completed step) instead of an empty dashboard:

1. **Name your organization** — input, real-time validation.
2. **Create your first project** — name + auto-assigned accent color.
3. **Get your ingest token & route your first request** — show the token + a copyable minimal integration snippet (monospace card) that demonstrates the closed loop:

   > **configure this ingest token → the SDK auto-reports routing decisions → decisions appear in the dashboard.**

   The snippet includes a "View deploy guide" one-click deploy link. Example shape of the snippet (illustrative, not final copy):

   ```ts
   import { createRouter } from "adaptive-model-router";

   const router = createRouter({
     ingestToken: process.env.AMR_INGEST_TOKEN, // from step 3
     // ...routing config
   });
   // Every routing decision is now auto-reported to the control plane
   // and shows up under Requests for this project.
   ```

On completion, CTA "Go to Requests". The whole flow takes under a minute.

### 6.4 Requests / Routing Decisions (evolved)

- Top: breadcrumb `Organization / Project` + filter bar (time, model, status, **project (in org-level view)**, member).
- Body: monospace table — `time · request_id · model · decision · latency · cost · by (member avatar)`; decision shown as a semantic-color badge (hit/green, fallback/amber, failure/red).
- Click a row → **right-side decision-detail drawer**: step-by-step "why it routed this way" (candidate models, scores, rule matches, final choice), fully honoring the "every decision is explainable" rule.
- **Empty state**: when a project has no requests, show a "No requests yet" illustration slot (geometric line art, not emoji) + the minimal integration snippet (same ingest-token loop as onboarding) + "View deploy guide".

### 6.5 Models (evolved)

- Scope bound to the current project; model comparison table (latency / cost / hit rate / call count), with optional side-by-side diff of two models.
- Empty state: "Not enough routing data yet — send a few requests to compare models." (real guidance copy).

### 6.6 Settings › Members

- Table: `avatar · name · email · role · status`.
- **Roles (MVP-3): owner / member only.** The role dropdown presents exactly two options: **owner** and **member**. This is the full set of permissions implemented in MVP-3.
- **Future-reserved roles**: if the visual slot for four tiers is kept, `Admin` and `Viewer` must be explicitly labeled — e.g. a disabled dropdown group titled "Coming in MVP-4+" with the note *"Admin / Viewer are reserved for a future release and are not active in MVP-3."* They must **not** look like shipped, selectable functionality. This avoids signaling to the frontend that four-tier permission checks are required now — MVP-3 implements only owner/member gating.
- Top-right "Invite" popover (email invite or copy invite link, Linear-style).

### 6.7 Settings › API Keys (ingest tokens)

- This page manages **ingest tokens** — the credentials the SDK uses to report routing decisions to the control plane.
- Per-project list of tokens (monospace), each with: created time, last used, and a revoke action.
- On creation, the token is shown once with a copy button (never shown again in full).
- Includes the "View deploy guide" entry so users can wire the token into their SDK config and complete the same reporting loop shown in onboarding.

---

## 7. Onboarding / Empty-State Approach (startup-friendliness)

Principle: **never hand the user a blank page.** Three progressive layers:

1. **No organization / project** → the guided checklist (see 6.3), with one-click deploy and the minimal ingest-token snippet.
2. **A project exists but has no data** → page-level empty state: one sentence of explanation + copyable integration snippet + "View deploy guide" + "Refresh" (honest feedback while waiting for data to arrive).
3. **Data present** → normal table / comparison views.

All empty states use Lucide outline icons or minimal geometric illustrations (**no emoji**), `--text-secondary` copy, and a single primary CTA, with a pragmatic, friendly tone. Multi-user collaboration cues ("3 members in this organization", the inline by-avatar column) run throughout, making "the team uses this together" visible in the UI.

---

## 8. Pre-Submit Red-Line Self-Check (passed)

- No purple/pink gradients (primary is Indigo, only a low-opacity glow)
- No emoji as functional icons (Lucide only)
- No Lorem / "Welcome to" placeholders (all real copy)
- All colors go through tokens
- Spacing on the 4px grid
- Inter + Noto Sans SC + JetBrains Mono, three clear tiers
- No marketing hero; the first screen is onboarding / real data
- Benchmark brands are explicit and consistent with the existing tone
- Buttons / forms cover Loading / Error / Empty states
- `focus-visible` + keyboard reachable + `prefers-reduced-motion`
- No pure black / pure gray used directly (`#0D1117` / `#8B949E` carry a tint)

---

## 9. Alignment Notes (resolved with team)

- **Organization term**: the two-tier structure is adopted, and the top-level term is **Organization (Org)** — consistent with the architecture's `organizations` table and the PRD. The sidebar-top switcher switches Organization; the row below switches/filters Project. Form unchanged, term only.
- **Role tiers (scope control)**: MVP-3 implements **owner / member** only. Fine-grained RBAC (differentiated Admin/Viewer permissions) is deferred to MVP-4+. The Members role dropdown presents owner/member; any four-tier visual slot must be clearly marked "reserved for the future, not active in MVP-3."
- **Ingest token**: Settings › API Keys manages the **ingest token** used by the SDK to report routing decisions. The onboarding step-3 snippet demonstrates the closed loop: configure token → SDK auto-reports → decisions appear in the dashboard.
