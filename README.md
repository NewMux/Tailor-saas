# Tafsell Tailor ERP

This repository contains the React/Vite frontend and Express/tRPC backend for a multi-tenant tailor-shop ERP. In production it runs on Vercel (static frontend plus the Express app as one serverless function, same origin) with Supabase for Postgres and file storage. Locally, the backend, local email/password authentication, and the built frontend all run from a single Express process.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
```

To run the standalone server locally, create a `.env` from `.env.example`, set `DATABASE_URL`, and run `pnpm start`.

## Production deployment

Read [DEPLOYMENT.md](./DEPLOYMENT.md) before going live. It is a step-by-step launch guide: deploying to Vercel (git-push deploy, preview deployments, automatic HTTPS) with Supabase as the backend (managed Postgres and private file storage), transactional email with Resend, subscription billing with Paddle (free trial, read-only mode for unpaid shops), the public pricing/legal pages Paddle requires, and a go-live checklist.

Do not commit `.env` files, database dumps, reset-link files, or production credentials.

## Internal sales demo

This repo also runs as the sales team's internal demo instance (not public, no landing page). See [DEMO.md](./DEMO.md) for the one-time setup and how the demo data auto-resets.
