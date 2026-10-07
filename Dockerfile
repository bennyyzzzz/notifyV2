# syntax=docker/dockerfile:1.7
# Multi-stage build for the api, worker and migrate images.
# Runtime images: no build tools, non-root user, read-only filesystem (set in compose/k8s).

ARG NODE_IMAGE=node:22-alpine

# ── Build ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/crypto/package.json packages/crypto/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY tests/security/package.json tests/security/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY apps apps
COPY packages packages
RUN pnpm turbo run build --filter=@notify/api --filter=@notify/worker
RUN pnpm --filter=@notify/api deploy --prod /out/api \
 && pnpm --filter=@notify/worker deploy --prod /out/worker

# ── Migrations (one-shot job, uses the DDL role) ─────────────────────────
FROM build AS migrate
USER node
WORKDIR /repo/packages/db
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# ── API runtime ──────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out/api ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3001/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]

# ── Worker runtime ───────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out/worker ./
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
