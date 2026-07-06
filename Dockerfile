# syntax=docker/dockerfile:1
FROM oven/bun:1-alpine AS base
WORKDIR /usr/src/app
RUN rm -rf /var/cache/apk/*

FROM base AS deps
COPY package.json bun.lock* ./
COPY patches/ ./patches/
COPY scripts/strip-workspaces.ts ./scripts/
RUN bun run scripts/strip-workspaces.ts && rm -f bun.lock bun.lockb && bun install

FROM deps AS build
COPY . .
RUN bun run build

FROM base AS final
ARG BUILD_SHA
ENV BUILD_SHA=${BUILD_SHA} NODE_ENV=production PORT=8080
# Own the workdir and /data as root before switching user (cheap — directories are empty)
RUN mkdir -p /data && chown bun:bun /data /usr/src/app && chmod 755 /data
USER bun
# Nitro bundles all JS and traces native deps (@takumi-rs/core) into .output/server/node_modules — no bun install needed
COPY --chown=bun:bun --from=build /usr/src/app/.output ./.output
COPY --chown=bun:bun --from=build /usr/src/app/server/cluster.ts ./cluster.ts
EXPOSE 8080
# start-period covers migrations on worker 0 plus the staggered sibling spawn
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthcheck || exit 1
# Supervisor spawns WEB_CONCURRENCY workers sharing port 8080 via SO_REUSEPORT
CMD ["bun", "run", "cluster.ts"]
