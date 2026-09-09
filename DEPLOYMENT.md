# Deployment (Railway)

## Architecture

One Express/tRPC process serves both the built React frontend and the `/api/*`
backend from a single origin — there is no separate frontend host. Railway
runs the repo's existing `Dockerfile` directly and provisions a managed
Postgres database alongside it. No reverse proxy, TLS config, or orchestration
platform to set up yourself — Railway handles HTTPS, the public domain, and
restarts.

```text
Browser
  │
  └── https://<your-app>.up.railway.app  ──►  Railway (HTTPS, routing)
                                                 │
                                                 └── app service (Dockerfile)
                                                       ├── serves the built frontend
                                                       ├── serves the API (/api/*)
                                                       └── Postgres (Railway-managed)
```

The browser sends an opaque local session token in the `Authorization`
header; it's hashed before storage. Passwords are stored as salted scrypt
hashes.

## 1. Create the Railway project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repository.
2. In the same project, **+ New** → **Database** → **Add PostgreSQL**. Railway provisions it and exposes a `DATABASE_URL` you can reference from the app service.
3. On the app service, go to **Variables** and reference the database's connection string rather than retyping it — Railway lets you pick `${{Postgres.DATABASE_URL}}` from the Postgres service.

## 2. Configure environment variables

On the app service, set:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
AUTH_BASE_URL=https://<your-app>.up.railway.app
NODE_ENV=production
LOG_LEVEL=info
```

- `AUTH_BASE_URL` is used to build password-reset and staff-invite links — set it to whatever public domain you'll actually use (the Railway-provided `*.up.railway.app` domain, or your custom domain once attached in step 3). Update it if you attach a custom domain later.
- `ALLOWED_ORIGIN` and `PORT` don't need to be set — this is a single-origin deployment (no CORS needed) and Railway injects `PORT` automatically; the app already reads it.
- `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` — only needed if the staff-document storage proxy is used.
- `SENTRY_DSN` — optional; leave unset to run without error monitoring.

## 3. Domain and HTTPS

Railway gives every service a free `*.up.railway.app` subdomain with HTTPS out of the box — nothing to configure. To use your own domain instead: app service → **Settings → Networking → Custom Domain**, add the domain, and create the CNAME record it shows you at your DNS provider. Railway issues and renews the TLS certificate automatically. Update `AUTH_BASE_URL` to match once the custom domain is live.

## 4. Deploy

Pushing to `main` deploys automatically (Railway watches the connected branch by default — no separate CI/CD setup needed). The Dockerfile's `CMD` already runs migrations before starting the server:

```text
./node_modules/.bin/drizzle-kit migrate && node dist/index.js
```

so every deploy applies any new migrations first, including the full multi-tenancy migration sequence (`organizations` table, `organizationId` columns and backfill) on a first deploy. Watch the **Deployments** tab for the build/deploy logs; Railway marks the service healthy once the container's health check (`GET /api/auth/session`, expects HTTP 200) passes.

To roll back, use Railway's deployment history — pick a previous successful deploy and **Redeploy** it.

## 5. Acceptance checklist

After the first deploy, verify against the live domain:

| Area | Check |
|---|---|
| Routing | `/api/auth/session` returns HTTP 200 with `{"authenticated":false,"user":null}`; `/` loads the app shell. |
| New organization signup | Register with "Create your shop"; confirm it becomes that organization's admin with its own empty dashboard. |
| Staff invite | From Owner Settings, invite a controlled staff email, accept the invite in a private window, confirm the account lands in the same organization with the chosen role. |
| Tenant isolation | With two organizations, confirm neither's customers, sales, inventory, or staff are visible to the other. |
| Persistence | Create a controlled customer/sale, redeploy, confirm it's still there. |

## 6. Backups

Railway's Postgres plugin takes automatic daily backups on paid plans — check **Postgres service → Backups** in your project. For a manual point-in-time dump, `scripts/backup-db.sh` still works against the Railway `DATABASE_URL` (run it from anywhere with `pg_dump` installed and network access to the database, e.g. your own machine, using the public connection string Railway shows under the Postgres service's **Connect** tab).

## Local development

`docker-compose.yml` is for local development only (spins up Postgres + the app together) — it isn't used for the Railway deployment, which builds the `Dockerfile` directly.

## Internal sales demo

See [DEMO.md](./DEMO.md) for setting up and scheduling resets for the internal demo organization — the scheduling approach there (a GitHub Actions cron workflow) works with this Railway deployment without any Railway-specific setup.
