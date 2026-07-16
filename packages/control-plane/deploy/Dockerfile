# Multi-stage build for @adaptive-router/control-plane. Build context is the
# MONOREPO ROOT (see docker-compose `context: ../../..`) so pnpm can resolve the
# workspace deps (@adaptive-router/sdk, @adaptive-router/dashboard).
#
# Stage 1 installs + builds the whole workspace; stage 2 is a slim runtime image
# with only the built control-plane and its production node_modules.

# ---- build stage -----------------------------------------------------------
FROM node:20-slim AS build
ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable
WORKDIR /repo

# Copy manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/control-plane/package.json packages/control-plane/package.json

RUN pnpm install --frozen-lockfile

# Copy the rest of the sources and build the workspace.
COPY . .
RUN pnpm --filter @adaptive-router/sdk --filter @adaptive-router/dashboard --filter @adaptive-router/control-plane build

# Prune dev dependencies for a lean runtime.
RUN pnpm --filter @adaptive-router/control-plane deploy --prod /out

# ---- runtime stage ---------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
EXPOSE 3000
# The bin boots: loadEnv → connect pg → runMigrations → listen (§2.3).
CMD ["node", "dist/server.js"]
