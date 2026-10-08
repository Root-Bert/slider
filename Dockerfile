# syntax=docker/dockerfile:1
#
# Slider as one container: the Bun API also serves the built web app (apps/web/dist).
#   docker build -t slider .
#   docker run -p 8787:8787 -v slider-data:/data -e SLIDER_SECRET=… -e WEB_ORIGIN=… slider
# See docs/self-hosting.md (docker compose with Postgres and Caddy).
#
# Debian slim, not Alpine: @napi-rs/canvas (PDF → slide images) ships glibc binaries.

ARG BUN_VERSION=1.3.13
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS node

# ── Workspace manifests only, so the dependency layers stay cached between code changes ──────
FROM oven/bun:${BUN_VERSION}-slim AS manifests
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/pptx/package.json packages/pptx/

# ── Build the web app (tsc + Vite run on Node, like in CI) ───────────────────────────────────
FROM manifests AS web
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/pptx packages/pptx
COPY apps/web apps/web
RUN cd apps/web && bun run build

# ── Production dependencies of the API (and the workspace packages it uses) ──────────────────
FROM manifests AS api-deps
RUN bun install --frozen-lockfile --production --filter @slider/api

# ── Runtime ──────────────────────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data

# LibreOffice draws the slide images of uploaded decks like PowerPoint (BER-94; linked decks use
# Office via Microsoft Graph). Impress only (no Java, no recommends), plus fonts metric-compatible with the
# Office ones (Carlito ≙ Calibri, Caladea ≙ Cambria, Liberation ≙ Arial/Times/Courier) so text
# wraps where PowerPoint wraps it. Costs roughly 450–550 MB of image size; without it uploads
# fall back to the built-in SVG preview. The `soffice` binary is found on the PATH.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu \
 && rm -rf /var/lib/apt/lists/*

# package.json files and node_modules (workspace symlinks included).
COPY --from=api-deps /app ./
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/pptx/src packages/pptx/src
COPY packages/pptx/tsconfig.json packages/pptx/
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist

# Blobs, recordings and – without DATABASE_URL – the PGlite database.
RUN mkdir -p /data && chown bun:bun /data
VOLUME ["/data"]
USER bun

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Bun handles SIGTERM itself (server.ts closes the server and the database).
CMD ["bun", "apps/api/src/server.ts"]
