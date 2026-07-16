-- 0001_better_auth.sql
-- Better-Auth schema (email/password + GitHub OAuth + organization plugin).
--
-- Team-lead Ruling 2: Better-Auth OWNS organization/member/invitation plus the
-- core auth tables (user/session/account/verification). This SQL is the
-- CLI-emitted schema, committed here HAND-REVIEWED so it runs inside our own
-- versioned schema_migrations runner (NOT an opaque runtime auto-migrate).
--
-- It MUST run before 0002_init.sql because our app tables FK into
-- organization(id) and "user"(id) (both text ids).
--
-- Provenance: generated with `npx @better-auth/cli generate --config
-- src/auth/better-auth.ts` (better-auth ^1.2, organization plugin enabled),
-- then reviewed. Better-Auth uses text ids and camelCase column names quoted to
-- preserve case in Postgres. Keep quoting exactly as emitted.

CREATE TABLE IF NOT EXISTS "user" (
  "id"            text PRIMARY KEY,
  "name"          text NOT NULL,
  "email"         text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image"         text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"                 text PRIMARY KEY,
  "expiresAt"          timestamptz NOT NULL,
  "token"              text NOT NULL UNIQUE,
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz NOT NULL DEFAULT now(),
  "ipAddress"          text,
  "userAgent"          text,
  "userId"             text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "activeOrganizationId" text
);
CREATE INDEX IF NOT EXISTS "idx_session_userId" ON "session"("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id"                    text PRIMARY KEY,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_account_userId" ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_verification_identifier" ON "verification"("identifier");

-- --- organization plugin tables ------------------------------------------
CREATE TABLE IF NOT EXISTS "organization" (
  "id"        text PRIMARY KEY,
  "name"      text NOT NULL,
  "slug"      text UNIQUE,
  "logo"      text,
  "metadata"  text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "member" (
  "id"             text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "userId"         text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role"           text NOT NULL DEFAULT 'member',
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("organizationId", "userId")
);
CREATE INDEX IF NOT EXISTS "idx_member_userId" ON "member"("userId");

CREATE TABLE IF NOT EXISTS "invitation" (
  "id"             text PRIMARY KEY,
  "organizationId" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email"          text NOT NULL,
  "role"           text,
  "status"         text NOT NULL DEFAULT 'pending',
  "expiresAt"      timestamptz NOT NULL,
  "inviterId"      text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_invitation_organizationId" ON "invitation"("organizationId");
