# syntax=docker/dockerfile:1

# One image serves both halves: Fastify answers /api and /ws, and the built
# frontend is served from the same origin as static files. That is why there is
# no CORS configuration in this project and why the browser can derive the
# websocket URL from window.location.

# deps: the install layer, invalidated only by a dependency change
FROM node:22-alpine AS deps
WORKDIR /app

# The lockfile and every workspace manifest, and nothing else. Copying sources
# first would reinstall the whole tree on every edit.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --workspaces --include-workspace-root

# build: the frontend bundle
FROM deps AS build
WORKDIR /app

# Only what the bundle imports. database/ is deliberately absent: the browser
# never touches it.
COPY shared/ shared/
COPY frontend/ frontend/

RUN npm run build --workspace @tapedeck/frontend

# runtime: production dependencies, sources and the bundle
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/frontend/dist

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# A second, much smaller install rather than copying the builder's node_modules,
# which carries vite, vitest and biome into the shipped image.
RUN npm ci --omit=dev --workspaces --include-workspace-root \
  && npm cache clean --force

COPY shared/ shared/
COPY database/ database/
COPY backend/ backend/
COPY --from=build /app/frontend/dist frontend/dist
COPY docker/entrypoint.sh docker/entrypoint.sh

# node:22-alpine ships busybox wget and no curl, so this cannot be the usual
# curl one-liner.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

EXPOSE 3000

USER node

ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]
