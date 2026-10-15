# Deployment and launch guide (Railway + Supabase)

This guide takes the app from a fresh Railway project to a paid, self-serve
SaaS: sign-up with a free trial, subscriptions through Paddle, transactional
email through Resend, and Supabase as the backend for the Postgres database
and private file storage.

Every integration is optional and switched on by its environment variables.
Deploy with only the required variables first, confirm it works, then add
email, storage and billing one at a time.

## Architecture

One Express/tRPC process serves both the built React frontend and the `/api/*`
backend from a single origin — there is no separate frontend host. Railway
runs the repo's existing `Dockerfile` directly (configured by `railway.json`).
Supabase is the backend: its managed Postgres holds all data, and Supabase
Storage holds staff documents through its S3-compatible API.

```text
Browser ──► https://app.yourdomain.com ──► Railway (HTTPS, routing)
                                               │
                                               └── app service (Dockerfile)
                                                     ├── React frontend + /api/*
                                                     ├──► Supabase Postgres (all data)
                                                     ├──► Supabase Storage  (staff documents)
                                                     ├──► Resend   (emails)
                                                     └──◄► Paddle  (checkout + webhooks)
```

The app uses Supabase as a database and file store only. Sign-in stays the
app's own email/password auth, and the browser never talks to Supabase
directly: every request goes through the Express server, which enforces
tenant isolation and roles. Row-level security is turned on for every table
with no policies (migration `0015_enable_rls`), so Supabase's public Data API
cannot read or write anything even with the project's anon key, while the
server, connecting as the table owner, is unaffected.

The browser sends an opaque session token in the `Authorization` header (and
an HttpOnly cookie); it's hashed before storage. Passwords are stored as
salted scrypt hashes.

## Monthly cost at launch

| Piece | Provider | Cost |
|---|---|---|
| App | Railway Hobby | ~$5 |
| Postgres + file storage | Supabase Free (testing) / Pro (production) | $0 / $25 |
| Email | Resend free tier (3,000/month) | $0 |
| Billing | Paddle | no monthly fee; a % of each payment |
| Errors | Sentry free tier (optional) | $0 |
| Domain | any registrar | ~$1 |

Check current prices on each provider's site. All shops share one app and
one database, so this cost does not grow per customer.

Use Supabase Pro for production: Free projects pause after a week without
activity and have no daily backups.

## 1. Supabase project (database)

The production project is **Tafsell** (ref `phbiaqtxqwqzouqsexbj`, region
`ap-northeast-1`) in the NewMux Ventures organization. Its schema is already
migrated through `0015_enable_rls`; the container's `drizzle-kit migrate`
applies any later migrations on each deploy. For a new project, create one at
[supabase.com/dashboard](https://supabase.com/dashboard) and the first deploy
creates the whole schema.

Get the connection string: project → **Connect** → **Session pooler** (port
`5432`). Use the session pooler rather than the direct connection: the direct
host is IPv6-only, while the pooler works over IPv4 from Railway, and session
mode keeps full Postgres behavior for migrations. Add `sslmode=require`:

```text
postgresql://postgres.phbiaqtxqwqzouqsexbj:<db-password>@aws-<n>-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Copy the host exactly as the dashboard shows it. URL-encode the password if
it contains URL-reserved characters; reset it under **Project Settings →
Database** if you don't have it.

## 2. Create the Railway project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repository. Don't add a Railway Postgres database; Supabase is the database.
2. On the app service → **Variables**, set `DATABASE_URL` to the Supabase session-pooler string from step 1.

`railway.json` tells Railway to build the `Dockerfile` and to use
`GET /api/health` as the health check. That endpoint queries Postgres, so a
container with a broken database connection is restarted instead of looking
healthy.

### Required environment variables

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres?sslmode=require
AUTH_BASE_URL=https://app.yourdomain.com
NODE_ENV=production
LOG_LEVEL=info
```

- `AUTH_BASE_URL` is the public address used in reset, invite and welcome links. Use the `*.up.railway.app` domain until your custom domain is attached, then update it.
- `PORT` is injected by Railway; the app binds exactly that port in production.
- `ALLOWED_ORIGIN` is not needed for this single-origin setup.
- `SENTRY_DSN` is optional; leave it unset to run without error monitoring.

The app validates its configuration at startup and refuses to start with a
clear message if something is wrong, for example only half of an
integration's variables set.

## 3. Domain and HTTPS

Railway gives every service a free `*.up.railway.app` subdomain with HTTPS.
For your own domain: app service → **Settings → Networking → Custom Domain**,
add e.g. `app.yourdomain.com`, and create the CNAME record it shows at your
DNS provider. Railway issues and renews the certificate. Then set
`AUTH_BASE_URL` to the new domain.

## 4. Deploy

Pushing to `main` deploys automatically. The container runs migrations before
starting the server:

```text
./node_modules/.bin/drizzle-kit migrate && exec node dist/index.js
```

Against the Tafsell Supabase project this is a no-op until a new migration
is added: its schema is already at `0015_enable_rls`. Every new table a
migration creates must also `ENABLE ROW LEVEL SECURITY`; `server/rls.test.ts`
fails CI if one doesn't.

On each deploy Railway sends SIGTERM to the old container. The server stops
accepting connections, lets in-flight requests finish (up to 10 seconds), and
closes the database pool. To roll back, redeploy a previous successful
deployment from the **Deployments** tab.

## 5. Transactional email (Resend)

Without email, password-reset links are only written to the server log and
owners must copy invite links by hand. Set it up before inviting real shops.

1. Create an account at [resend.com](https://resend.com) → **Domains** → **Add domain** (use a subdomain such as `mail.yourdomain.com` if you like).
2. Add the DNS records Resend shows (SPF, DKIM) and wait for the domain to show **Verified**.
3. **API Keys** → create a key with **Sending access**.
4. Set on Railway:

```dotenv
RESEND_API_KEY=re_...
EMAIL_FROM=Tafsell <hello@yourdomain.com>
```

`EMAIL_FROM` must use the verified domain. Check it by using "Forgot password?"
on your own account.

## 6. File storage for staff documents (Supabase Storage)

Staff documents (contracts, IDs) are private: the app streams them through a
permission check and a signed link that expires after 5 minutes. The app
talks to Supabase Storage through its S3-compatible API.

1. The private bucket `staff-documents` (10 MB per file) already exists in the Tafsell project. For a new project: **Storage → New bucket**, name `staff-documents`, leave **Public bucket** off.
2. **Project Settings → Storage → S3 access keys → New access key**. Copy the access key ID and secret. They bypass RLS and can reach every bucket, so they belong only in Railway's variables.
3. Set on Railway:

```dotenv
S3_ENDPOINT=https://phbiaqtxqwqzouqsexbj.storage.supabase.co/storage/v1/s3
S3_REGION=ap-northeast-1
S3_BUCKET=staff-documents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Any other S3-compatible provider (Cloudflare R2, AWS S3, Backblaze B2) works
with the same five variables.

## 7. Subscription billing (Paddle)

Paddle is the merchant of record: it charges the customer, handles sales
tax/VAT and sends receipts. The app only needs to know each shop's
subscription status, which Paddle pushes to it by webhook.

**How it behaves for shops**
- A new shop gets a free trial (`TRIAL_DAYS`, default 14) with no card.
- The owner subscribes from **Billing** in the sidebar (Paddle checkout overlay), and later manages their card, invoices or cancellation through Paddle's customer portal.
- When the trial ends without a subscription, or a payment fails (`past_due`), or the subscription is paused or canceled, the shop becomes **read-only**. Everyone can still sign in, view and export, but saving anything is refused until the subscription is active again. A banner explains this and links to Billing.
- Platform staff can mark any shop **billing-exempt** (partners, manual invoicing) or **extend a trial** from the ops console (`/ops` → organization).

### 7a. Sandbox first

1. Create a sandbox account at [sandbox-vendors.paddle.com](https://sandbox-vendors.paddle.com).
2. **Catalog → Products** → create a product (e.g. "Tafsell"), then add a **Price**: recurring, monthly, in your currency. Don't add a Paddle trial; the app runs its own no-card trial. Copy the price ID (`pri_...`).
3. **Developer tools → Authentication**:
   - create an **API key** (`pdl_sdbx_apikey_...`) with permission to read prices and write customer portal sessions;
   - create a **client-side token** (`test_...`).
4. **Developer tools → Notifications → New destination**:
   - URL: `https://app.yourdomain.com/api/billing/paddle-webhook`
   - Events: `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.canceled`
   - Save, then copy the destination's **secret key** (`pdl_ntfset_...`).
5. **Checkout → Checkout settings** → set the **default payment link** to your app URL, and add your domain under approved domains.
6. Set on Railway:

```dotenv
PADDLE_ENV=sandbox
PADDLE_API_KEY=pdl_sdbx_apikey_...
PADDLE_CLIENT_TOKEN=test_...
PADDLE_PRICE_ID=pri_...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
TRIAL_DAYS=14
```

7. Test the full loop: create a shop → **Billing → Subscribe now** → pay with Paddle's test card `4242 4242 4242 4242` (any future expiry, any CVC) → within a few seconds the page shows **Active**. Then open **Manage billing**, cancel, and confirm the shop turns read-only once the cancellation takes effect. In Paddle, **Notifications → your destination → logs** shows each delivery; they should all be `200`.

### 7b. Go live

1. Fill in your legal details in `client/src/pages/public/legalConfig.ts` (business name, address, support email, jurisdiction, date). Review the Terms, Privacy and Refund pages at `/terms`, `/privacy` and `/refunds`; they are templates, not legal advice. Deploy.
2. Create a live account at [vendors.paddle.com](https://vendors.paddle.com) and complete verification. Paddle reviews your website: it needs to see `/pricing`, `/terms`, `/privacy` and `/refunds` on your domain, all public and all linked from the sign-in page.
3. Repeat steps 2–5 of 7a in the live dashboard (live IDs and keys differ from sandbox).
4. Switch the Railway variables to the live values and set `PADDLE_ENV=production`.

If the Paddle variables are removed, billing switches off completely: nobody
is restricted and the Billing page and banners disappear.

## 8. Go-live checklist

| Area | Check |
|---|---|
| Health | `https://<domain>/api/health` returns `{"ok":true}`. |
| Sign-up | "Create your shop" creates a new, empty organization with its owner as admin; the welcome email arrives. |
| Email | "Forgot password?" delivers a working reset link. |
| Staff invite | Owner Settings → Invite staff emails the invite; accepting with the invited email works, and a different email is refused. |
| Tenant isolation | With two organizations, neither sees the other's customers, sales, inventory or staff. |
| Documents | Uploading and opening a staff document works (Staff & Payroll). |
| Billing | Sandbox checkout activates the shop; an expired trial makes it read-only; the ops console can exempt it. |
| Public pages | `/pricing`, `/terms`, `/privacy`, `/refunds` load while signed out and show your real business details. |
| Persistence | Create a customer, redeploy, and confirm it's still there. |
| Backups | The Supabase project is on Pro with daily backups (see below). |
| Data API | `curl https://phbiaqtxqwqzouqsexbj.supabase.co/rest/v1/users -H "apikey: <anon key>"` returns `[]`, never rows. |

## 9. Backups

Supabase Pro takes daily backups (7 days kept); check **Database →
Backups**. Point-in-time recovery is a paid add-on. For an extra off-site
copy, run `pg_dump` (version 17 or newer, matching Supabase's Postgres 17) on
a schedule from any machine:

```bash
pg_dump --format=custom --no-owner --no-acl --schema=public --schema=drizzle \
  "$DATABASE_URL" > tafsell-$(date -u +%Y%m%dT%H%M%SZ).dump
```

`scripts/backup-db.sh` does the same for the local docker-compose database.

## 10. Granting platform-staff access

Platform staff (your own operators, as opposed to a shop's own staff) is a
separate concept from any organization's roles; see the comment on the
`platformStaff` table in `drizzle/schema.ts`. There is no UI to grant the
first one, so bootstrap it from a shell with access to `DATABASE_URL`, after
the person has signed up for an ordinary account:

```bash
DATABASE_URL=... pnpm platform:grant-staff --email you@example.com --role superadmin
```

`--role` is `support` (read-only across organizations) or `superadmin`
(can also suspend/reactivate organizations, change billing exemptions and
trials, grant/revoke other platform staff, and impersonate a user for
support). Pass `--revoke` instead of `--role` to remove access. This script
remains the break-glass path even though the ops panel can grant and revoke
staff, the same way `pnpm auth:reset-links` remains the break-glass path for
password resets.

## Security notes

- Login, sign-up, forgot-password and reset endpoints are rate-limited per IP.
- The app trusts exactly one proxy hop (Railway's), so client IPs and HTTPS detection are correct.
- Paddle webhooks are verified against `PADDLE_WEBHOOK_SECRET` over the raw request body, and replays older than 5 minutes are rejected. A subscription can only be linked to a shop through checkout data signed by the server.
- Invite links only work for the email address they were sent to.
- The container runs as an unprivileged user.

## Local development

`docker-compose.yml` is for local development only (it starts a plain Postgres
and the app together); Railway builds the `Dockerfile` directly and doesn't
use it. Plain Postgres behaves the same as Supabase for this app, and CI runs
against it too. Don't point local development or tests at the production
Supabase database: the test suite writes rows.

## Internal sales demo

See [DEMO.md](./DEMO.md) for setting up and scheduling resets for the internal
demo organization. The reset keeps the demo organization billing-exempt.
