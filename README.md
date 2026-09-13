# Tafsell Tailor ERP

This repository contains the React/Vite frontend and Express/tRPC backend for a multi-tenant tailor-shop ERP sold as a subscription to tailoring businesses across the GCC. The public landing page, the backend, local email/password authentication, and the built frontend all run from a single Express process — there is no separate frontend host.

A shop signs up from the landing page, gets a 14-day free trial with no card, and subscribes through Paddle. Once the trial lapses without a subscription, every tenant-scoped API route returns HTTP 402 and the app shows a subscription screen in place of the workspace.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
```

To run the standalone server locally, create a `.env` from `.env.example`, set `DATABASE_URL`, and run `pnpm start`.

## Production deployment

Read [DEPLOYMENT.md](./DEPLOYMENT.md) before going live. It covers provisioning a Hetzner server, deploying the Compose stack with Coolify, environment variables, domains and HTTPS, and an acceptance checklist.

Billing runs on Paddle. [PADDLE_SETUP.md](./PADDLE_SETUP.md) covers creating the account, product, price, API credentials and webhook destination, and testing a subscription end to end in Paddle's sandbox. Until Paddle credentials are set the app runs with billing disabled — nothing is paywalled.

The main operator guide is [ERP-HANDOVER-MANUAL.md](./ERP-HANDOVER-MANUAL.md). Do not commit `.env` files, database dumps, reset-link files, or production credentials.

## Internal sales demo

A separate deployment of this repo can serve as a sales demo instance with auto-resetting data. See [DEMO.md](./DEMO.md) for the one-time setup.
