# Tafsell Tailor ERP

This repository contains the React/Vite frontend and Express/tRPC backend for a multi-tenant tailor-shop ERP. PostgreSQL, the backend, local email/password authentication, and the built frontend all run from a single Express process on the Hetzner server — there is no separate frontend host.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
```

To run the standalone server locally, create a `.env` from `.env.example`, set `DATABASE_URL`, and run `pnpm start`.

## Production deployment

Read [HETZNER_DEPLOYMENT.md](./HETZNER_DEPLOYMENT.md) before cutover. It describes the PostgreSQL backup and restore sequence, Coolify Docker Compose deployment, Coolify HTTPS domain and health checks, existing-user password reset links, acceptance testing, and recurring backups.

The main operator guide is [ERP-HANDOVER-MANUAL.md](./ERP-HANDOVER-MANUAL.md). Do not commit `.env` files, database dumps, reset-link files, or production credentials.
