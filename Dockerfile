FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN NODE_ENV=development pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.22.0 --activate
ENV NODE_ENV=production
WORKDIR /app

# Owned by, and run as, the image's unprivileged "node" user rather than root.
COPY --chown=node:node --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/drizzle ./drizzle
COPY --chown=node:node --from=build /app/drizzle.config.ts ./drizzle.config.ts
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# exec replaces the shell so node is PID 1 and receives SIGTERM directly,
# letting the server's graceful shutdown run on every deploy/restart.
CMD ["sh", "-c", "./node_modules/.bin/drizzle-kit migrate && exec node dist/index.js"]
