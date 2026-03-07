# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9-alpine AS base
WORKDIR /usr/src/app
RUN rm -rf /var/cache/apk/*

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
# Own the workdir and /data as root before switching user (cheap — directories are empty)
RUN mkdir -p /data && chown bun:bun /data /usr/src/app && chmod 755 /data
# Reuse already-stripped package.json from deps stage (workspaces field already removed)
COPY --chown=bun:bun --from=deps /usr/src/app/package.json ./
USER bun
RUN bun install --production --no-cache && \
    rm -rf ~/.bun/install/cache && \
    rm -rf node_modules/@img/sharp-libvips-linux-arm64
COPY --chown=bun:bun --from=build /usr/src/app/dist ./dist
WORKDIR /usr/src/app/dist
EXPOSE 8080
CMD ["bun", "index.js"]
