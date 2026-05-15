ARG NODE_IMAGE=docker.io/library/node:24-alpine
ARG RUNTIME_IMAGE=docker.io/library/node:24-alpine

FROM ${NODE_IMAGE} AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV no_proxy=${no_proxy}
ENV NO_PROXY=${NO_PROXY}
ENV CI=true

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY packages ./packages
COPY tools ./tools
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    pnpm install --frozen-lockfile

COPY apps ./apps
RUN pnpm --filter @open-design/daemon build && \
    pnpm --filter @open-design/web build && \
    pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon && \
    pnpm store prune && \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

FROM ${RUNTIME_IMAGE}

# tini for PID 1 signal handling, plus agent CLIs that the daemon spawns
# at runtime. The CLIs ship as npm packages so we install them globally
# inside the runtime image. Pin versions explicitly so the image stays
# reproducible.
RUN apk add --no-cache tini git ca-certificates && \
    addgroup -S -g 1001 open-design && \
    adduser -S -D -H -u 1001 -G open-design open-design && \
    npm install --omit=dev -g \
      @anthropic-ai/claude-code \
      @openai/codex \
    || echo "[deploy] agent CLI install soft-failed; install via runtime hook if needed"

WORKDIR /app
COPY --from=build --chown=open-design:open-design /app/deploy/daemon ./apps/daemon
# Migrations live next to dist/db/. The TS compile step does not move
# .sql files, so copy them in explicitly.
COPY --from=build --chown=open-design:open-design /app/apps/daemon/src/db/migrations ./apps/daemon/dist/db/migrations
COPY --from=build --chown=open-design:open-design /app/apps/web/out ./apps/web/out
COPY --chown=open-design:open-design skills ./skills
COPY --chown=open-design:open-design design-systems ./design-systems
COPY --chown=open-design:open-design craft ./craft
COPY --chown=open-design:open-design prompt-templates ./prompt-templates
COPY --chown=open-design:open-design assets/frames ./assets/frames
COPY --chown=open-design:open-design assets/community-pets ./assets/community-pets

RUN mkdir -p /data && \
    chown -R open-design:open-design /app /data

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=512
ENV OD_BIND_HOST=0.0.0.0
ENV OD_PORT=7456
ENV OD_DATA_DIR=/data
ENV OD_RUN_MIGRATIONS=1

EXPOSE 7456

USER open-design
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
