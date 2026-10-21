# syntax=docker/dockerfile:1
#
# The product website (apps/site) as a small static-file container behind the Caddy of
# deploy/docker-compose.yml – only on the server that hosts bertro.dev/slider, never part of a
# self-hosted Slider. Built by docker-compose.website.yml (context: the repository root).
#
# The files sit under /srv/slider, the path they are served at: Caddy's directory redirects
# (/slider/blog → /slider/blog/) then keep the prefix.

ARG BUN_VERSION=1.3.13
ARG NODE_VERSION=22

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS node

# ── Build (Astro runs on Node, like the web app in the main Dockerfile) ──────────────────────
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-slim AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/shared/package.json packages/shared/
COPY packages/pptx/package.json packages/pptx/
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# All workspaces: the site renders the app's components (apps/web/src) with the app's dependencies.
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/site apps/site
RUN cd apps/site && bun run build

# ── Static files ─────────────────────────────────────────────────────────────────────────────
FROM caddy:2
COPY deploy/website/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/site/dist /srv/slider
