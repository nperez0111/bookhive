# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9-alpine AS base
WORKDIR /usr/src/app

FROM base AS deps
COPY package.json bun.lock* ./
COPY scripts/strip-workspaces.ts ./scripts/
RUN bun run scripts/strip-workspaces.ts && rm -f bun.lock bun.lockb && bun install

FROM deps AS build
COPY . .
RUN bun run build

FROM base AS final
ARG BUILD_SHA
ENV BUILD_SHA=${BUILD_SHA} NODE_ENV=production PORT=8080
RUN mkdir -p /data && chown -R bun:bun /data && chmod 755 /data
COPY package.json bun.lock* ./
COPY scripts/strip-workspaces.ts ./scripts/
RUN bun run scripts/strip-workspaces.ts && rm -f bun.lock bun.lockb && \
    bun install --production --no-cache && rm -rf /root/.bun/install/cache 2>/dev/null || true
COPY --from=build /usr/src/app/dist ./dist
WORKDIR /usr/src/app/dist
RUN chown -R bun:bun /usr/src/app
USER bun
EXPOSE 8080
CMD ["bun", "index.js"]
