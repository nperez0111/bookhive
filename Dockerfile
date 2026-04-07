# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9-alpine AS base
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
# Own the workdir as root before switching user
RUN chown bun:bun /usr/src/app
USER bun
# Nitro bundles all JS and traces native deps (sharp) into .output/server/node_modules — no bun install needed
COPY --chown=bun:bun --from=build /usr/src/app/.output ./.output
# @takumi-rs/core is a NAPI-RS package; Nitro's tracer only auto-detects packages in nf3's
# NodeNativePackages list (e.g. sharp). Copy the full @takumi-rs scope so the platform-specific
# binary (e.g. core-linux-arm64-musl) is available at runtime.
# TODO: remove once https://github.com/nitrojs/nitro/issues/4140 is fixed upstream.
COPY --chown=bun:bun --from=build /usr/src/app/node_modules/@takumi-rs ./.output/server/node_modules/@takumi-rs
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthcheck || exit 1
CMD ["bun", "run", ".output/server/index.mjs"]
