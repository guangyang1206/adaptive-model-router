-- 0002_init.sql
-- App-domain tables owned by control-plane (Team-lead Ruling 2): ONLY
-- projects, ingest_tokens, router_traces. organizations/memberships are DROPPED
-- from our schema — Better-Auth's organization plugin owns org/member/invitation
-- (see 0001_better_auth.sql). FKs point at Better-Auth's "organization"(id) and
-- "user"(id), which are TEXT ids.
--
-- Indexes are EXACTLY the Spec §5 set — no speculative composite indexes.
-- gen_random_uuid() is built into Postgres 13+ (pgcrypto folded into core); the
-- deploy target is postgres:17, so no CREATE EXTENSION needed.

CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  accent      text,                          -- one of the fixed 8-color palette
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS ingest_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,               -- sha256 hex; plaintext never stored
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz                  -- soft delete / revocation
);
-- FK/lookup index (Spec §5 "ingest_tokens | project_id").
CREATE INDEX IF NOT EXISTS idx_ingest_tokens_project ON ingest_tokens(project_id);
-- token_hash is looked up on the hot ingest path; UNIQUE doubles as the O(1)
-- lookup index and prevents duplicate hashes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_tokens_hash ON ingest_tokens(token_hash);

CREATE TABLE IF NOT EXISTS router_traces (
  trace_id            text PRIMARY KEY,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  decision_id         text NOT NULL,
  status              text NOT NULL,
  chosen_model        text,
  reason              text NOT NULL,
  latency_ms          integer,
  estimated           boolean NOT NULL DEFAULT true,
  estimated_cost_usd  real,
  input_tokens        integer,
  output_tokens       integer,
  total_tokens        integer,
  trace_json          jsonb NOT NULL,        -- full RouterTrace, forward-compat
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Verbatim Spec §5 router_traces indexes. Nothing more.
CREATE INDEX IF NOT EXISTS idx_traces_project_created ON router_traces(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_project_status  ON router_traces(project_id, status);
