# Gateway image. No secrets are baked in: pass HARNESS_API_KEY at run time.

# The web app is built here, so the final image carries only its static files.
FROM node:22-slim AS web
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile --filter @harness/web...
COPY packages/core packages/core
COPY packages/web packages/web
RUN pnpm --filter @harness/web build

FROM node:22-slim

ENV NODE_ENV=production
RUN corepack enable
WORKDIR /app

# Install only what the gateway needs (core + gateway workspaces) from the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/tools/package.json packages/tools/
COPY packages/claude/package.json packages/claude/
COPY packages/gateway/package.json packages/gateway/
RUN pnpm install --frozen-lockfile --filter @harness/gateway... --prod=false

COPY packages/core packages/core
COPY packages/tools packages/tools
COPY packages/claude packages/claude
COPY packages/gateway packages/gateway
COPY --from=web /app/packages/web/dist packages/web/dist

# Inside a container the port is published on the host's Tailscale address, so listen on all
# container interfaces. The gateway still refuses to start without HARNESS_API_KEY.
ENV HOST=0.0.0.0 \
    PORT=8787 \
    HARNESS_ALLOW_ANY_INTERFACE=1

# Coding sessions are saved here so they survive a restart. Mount a volume at /data to keep them.
RUN mkdir -p /data && chown node:node /data
ENV HARNESS_DATA_DIR=/data
VOLUME /data

EXPOSE 8787
USER node
WORKDIR /app/packages/gateway
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
