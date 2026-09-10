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

## Alternative: split deployment (frontend on Netlify, backend on Railway)

The app supports a split-origin setup too — the frontend build already reads `VITE_API_URL` to call a different origin (`client/src/lib/auth.ts`, `client/src/main.tsx`), and the backend already has a CORS allowlist for it (`ALLOWED_ORIGIN` in `server/_core/app.ts`). No code changes needed. This is two separate deployments instead of one, so only use it if you specifically want the frontend on Netlify — the single-origin Railway setup above is simpler to operate day to day.

1. **Deploy the backend to Railway first**, following steps 1–2 above, but leave `AUTH_BASE_URL` pointing at the Railway domain (invite/reset links should still point at wherever staff actually log in — see step 4 below) and don't attach a custom domain to it if the public-facing site is the Netlify one. Note the Railway app's URL, e.g. `https://<your-app>.up.railway.app`.
2. **Create the Netlify site**: [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project** → connect this GitHub repo. Netlify auto-detects `netlify.toml` at the repo root (build command, publish directory, the pnpm flag, and a SPA fallback redirect are all already configured there). Note the site's `*.netlify.app` domain Netlify assigns immediately.
3. **Set environment variables**:
   - On Netlify (site **Settings → Environment variables**): `VITE_API_URL=https://<your-app>.up.railway.app` (the Railway backend from step 1). This is a *build-time* variable — trigger a new deploy after setting or changing it.
   - On Railway (the app service's variables): `ALLOWED_ORIGIN=https://<your-site>.netlify.app` (the Netlify domain from step 2). Comma-separate multiple origins if you later add a custom domain too.
4. **`AUTH_BASE_URL`** (on Railway) should be whichever domain staff actually use day to day — the Netlify frontend domain, since that's where password-reset and invite links need to open.
5. Trigger deploys on both sides (Railway redeploys on push automatically; Netlify builds on push once connected). Verify: open the Netlify URL, confirm `/api/auth/session` calls succeed in the browser network tab (no CORS errors) and login works.

## Local development

`docker-compose.yml` is for local development only (spins up Postgres + the app together) — it isn't used for the Railway deployment, which builds the `Dockerfile` directly.

## Internal sales demo

See [DEMO.md](./DEMO.md) for setting up and scheduling resets for the internal demo organization — the scheduling approach there (a GitHub Actions cron workflow) works with this Railway deployment without any Railway-specific setup.
