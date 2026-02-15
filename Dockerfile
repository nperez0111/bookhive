# syntax=docker/dockerfile:1
# Bun-first production image for BookHive

ARG BUN_VERSION=1.3.9

################################################################################
# Base stage: Bun runtime
################################################################################
FROM oven/bun:${BUN_VERSION}-alpine AS base

WORKDIR /usr/src/app

################################################################################
# Install dependencies (production + dev for build)
################################################################################
FROM base AS deps

COPY package.json bun.lock* ./
COPY scripts/strip-workspaces.ts ./scripts/
# Strip workspaces so we don't need the app directory in the image; remove lockfile so install resolves from package.json only
RUN bun run scripts/strip-workspaces.ts && rm -f bun.lock bun.lockb

# Install all deps (we need devDependencies for build)
RUN bun install

################################################################################
# Build stage: CSS + client JS
################################################################################
FROM deps AS build

COPY . .

RUN bun run build

################################################################################
# Production stage: minimal runtime
################################################################################
FROM base AS final

ENV NODE_ENV=production
ENV PORT=8080

# Create data directory
RUN mkdir -p /data && chown -R bun:bun /data && chmod 755 /data

# Copy package files and strip workspaces (must run as root to write package.json)
COPY package.json bun.lock* ./
COPY scripts/strip-workspaces.ts ./scripts/
RUN bun run scripts/strip-workspaces.ts && rm -f bun.lock bun.lockb

# Production install only; no cache so the image stays slim
RUN bun install --production --no-cache && rm -rf /root/.bun/install/cache 2>/dev/null || true

# Copy built server bundle (contents of dist at app root so ./entry-*.js resolve)
COPY --from=build /usr/src/app/dist ./
COPY --from=build /usr/src/app/public ./public

# Drop to non-root for runtime
RUN chown -R bun:bun /usr/src/app
USER bun

EXPOSE 8080

CMD ["bun", "index.js"]
