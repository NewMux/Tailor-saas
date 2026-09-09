# Tafsell Tailor ERP

This repository contains the React/Vite frontend and Express/tRPC backend for a multi-tenant tailor-shop ERP. The backend, local email/password authentication, and the built frontend all run from a single Express process — there is no separate frontend host.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
```

To run the standalone server locally, create a `.env` from `.env.example`, set `DATABASE_URL`, and run `pnpm start`.

## Production deployment

Read [DEPLOYMENT.md](./DEPLOYMENT.md) before going live. It covers deploying to Railway (git-push deploy, managed Postgres, automatic HTTPS — no reverse proxy or orchestration platform to configure), environment variables, custom domains, and an acceptance checklist.

The main operator guide is [ERP-HANDOVER-MANUAL.md](./ERP-HANDOVER-MANUAL.md). Do not commit `.env` files, database dumps, reset-link files, or production credentials.

## Internal sales demo

This repo also runs as the sales team's internal demo instance (not public, no landing page). See [DEMO.md](./DEMO.md) for the one-time setup and how the demo data auto-resets.
