# Deployment and launch guide (Vercel + Supabase)

This guide takes the app from a fresh Vercel project to a paid, invite-only
SaaS: shops created by your team with a free trial, subscriptions through
Paddle, transactional email through Resend, and Supabase as the backend for
the Postgres database and private file storage.

## Onboarding model: invite-only

There is no public sign-up. A superadmin creates each shop from the ops
console (`/ops` → **Create shop**: shop name, owner's name and email), which
makes the owner the shop's administrator and issues a one-time setup link,
valid for 7 days, for them to choose a password. The link is emailed when
Resend is configured, and always shown to the operator to send by hand. If it
expires unused, the shop's page in `/ops` offers **New setup link** until the
owner has set a password; after that they use "Forgot password?". Owners then
add their own staff with invite links from Owner Settings.

The same is available from a shell, e.g. to create the very first shop:

```bash
DATABASE_URL=... AUTH_BASE_URL=https://app.yourdomain.com \
  pnpm shop:create --shop "Al Noor Tailors" --owner "Sara Ali" --email sara@example.com
```

The sign-in page and `/pricing` point prospective customers to
`supportEmail` in `client/src/pages/public/legalConfig.ts`; set it before
launch.

Every integration is optional and switched on by its environment variables.
Deploy with only the required variables first, confirm it works, then add
email, storage and billing one at a time.

## Architecture

Vercel serves everything from one domain. The built React app is static
files on Vercel's CDN, and the Express/tRPC backend runs as a single
serverless function that handles `/api/*` and `/manus-storage/*`. Any other
path falls back to `index.html` for client-side routing. Supabase is the
backend: its managed Postgres holds all data, and Supabase Storage holds
staff documents through its S3-compatible API.

```text
Browser ──► https://app.yourdomain.com ──► Vercel (HTTPS, CDN, routing)
                                               ├── static React app
                                               └── "api" function (Express, Tokyo hnd1)
                                                     ├──► Supabase Postgres (all data)
                                                     ├──► Supabase Storage  (staff documents)
                                                     ├──► Resend   (emails)
                                                     └──◄► Paddle  (checkout + webhooks)
```

`vercel.json` runs `pnpm run build:vercel` (`scripts/build-vercel.ts`), which
writes Vercel's Build Output API layout directly: the static site, the
Express app bundled into one self-contained file
(`server/_core/vercel.ts`), and the routing table. Nothing is left to
framework auto-detection. The function runs in Tokyo (`hnd1`), next to the
Supabase project; set `VERCEL_FUNCTION_REGION` to change that.

The app uses Supabase as a database and file store only. Sign-in stays the
app's own email/password auth, and the browser never talks to Supabase
directly: every request goes through the Express function, which enforces
tenant isolation and roles. Row-level security is turned on for every table
with no policies (migration `0015_enable_rls`), so Supabase's public Data API
cannot read or write anything even with the project's anon key, while the
server, connecting as the table owner, is unaffected.

The browser sends an opaque session token in the `Authorization` header (and
an HttpOnly cookie); it's hashed before storage. Passwords are stored as
salted scrypt hashes.

### Serverless limits to know

- **Request size:** Vercel rejects request bodies over 4.5 MB, so staff documents are capped at 3 MB each (they're sent base64-encoded).
- **Request time:** each request may run up to 30 seconds (`maxDuration` in the build script).
- **Rate limiting** of login, invite-acceptance and password-reset attempts is kept in each function instance's memory, so it's a per-instance brake on brute force rather than an exact global quota.

## Monthly cost at launch

| Piece | Provider | Cost |
|---|---|---|
| App hosting | Vercel Pro (Hobby is non-commercial only) | $20 per member |
| Postgres + file storage | Supabase Free (testing) / Pro (production) | $0 / $25 |
| Email | Resend free tier (3,000/month) | $0 |
| Billing | Paddle | no monthly fee; a % of each payment |
| Errors | Sentry free tier (optional) | $0 |
| Domain | any registrar | ~$1 |

Check current prices on each provider's site. All shops share one app and
one database, so this cost does not grow per customer until usage passes the
plans' included amounts.

Use Supabase Pro for production: Free projects pause after a week without
activity and have no daily backups.

## 1. Supabase project (database)

The production project is **Tafsell** (ref `phbiaqtxqwqzouqsexbj`, region
`ap-northeast-1`) in the NewMux Ventures organization. Its schema is already
migrated through `0015_enable_rls`. For a new project, create one at
[supabase.com/dashboard](https://supabase.com/dashboard); the first
production deploy creates the whole schema.

The app needs two connection strings, both from project → **Connect**. Copy
each host exactly as the dashboard shows it, add `sslmode=require`, and
URL-encode the password if it contains URL-reserved characters (reset it
under **Project Settings → Database** if you don't have it).

- **Transaction pooler** (port `6543`) for the running app, as `DATABASE_URL`. Serverless functions open many short-lived connections; the transaction pooler multiplexes them onto a few real ones. The app already disables prepared statements, which this pooler requires.

  ```text
  postgresql://postgres.phbiaqtxqwqzouqsexbj:<db-password>@aws-<n>-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require
  ```

- **Session pooler** (port `5432`) for migrations, as `MIGRATION_DATABASE_URL`. Migrations need a real session. (The direct `db.<ref>.supabase.co` host is IPv6-only, so use the pooler.)

  ```text
  postgresql://postgres.phbiaqtxqwqzouqsexbj:<db-password>@aws-<n>-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require
  ```

## 2. Create the Vercel project

1. [vercel.com/new](https://vercel.com/new) → import this GitHub repository. Leave **Framework Preset** as **Other** and the build, output and install settings at their defaults: `vercel.json` sets them.
2. **Settings → General → Node.js Version**: 22.x.
3. **Settings → Environment Variables**: add the variables below, scoped to **Production** only.

### Required environment variables

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:6543/postgres?sslmode=require
MIGRATION_DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres?sslmode=require
AUTH_BASE_URL=https://app.yourdomain.com
ENABLE_EXPERIMENTAL_COREPACK=1
LOG_LEVEL=info
```

- `AUTH_BASE_URL` is the public address used in reset, invite and welcome links. Use the `*.vercel.app` production domain until your custom domain is attached, then update it.
- `ENABLE_EXPERIMENTAL_COREPACK=1` makes Vercel install with the exact pnpm version pinned in `package.json` (`packageManager`).
- `NODE_ENV` and `PORT` are not needed: the build sets production mode and Vercel routes requests itself.
- `ALLOWED_ORIGIN` is not needed for this single-origin setup.
- `SENTRY_DSN` is optional; leave it unset to run without error monitoring.

**Keep the database variables out of Preview.** Every pull request gets a
preview deployment, and with production credentials it would read and write
live shop data. Without them, previews still build (they skip migrations) but
their API calls fail. To get working previews, point Preview-scoped variables
at a separate Supabase project or branch.

Production builds check the configuration and stop with a clear message if
something is wrong, for example a missing `AUTH_BASE_URL` or only half of an
integration's variables set, so a broken configuration never goes live.

## 3. Domain and HTTPS

Vercel gives every project a `*.vercel.app` domain with HTTPS. For your own
domain: **Settings → Domains** → add e.g. `app.yourdomain.com` and create the
DNS record Vercel shows at your DNS provider. Vercel issues and renews the
certificate. Then set `AUTH_BASE_URL` to the new domain and redeploy.

## 4. Deploy

Pushing to `main` deploys to production automatically; other branches get
preview deployments. A production build:

1. validates the environment variables;
2. applies pending database migrations through `MIGRATION_DATABASE_URL` (`drizzle-kit migrate`);
3. builds the frontend and bundles the API function.

If any step fails, the deployment fails and the previous one keeps serving.
Against the Tafsell Supabase project the migration step is a no-op until a
new migration is added: its schema is already at `0015_enable_rls`. Every new
table a migration creates must also `ENABLE ROW LEVEL SECURITY`;
`server/rls.test.ts` fails CI if one doesn't.

Because migrations run before the new code goes live, write them so the
currently deployed code keeps working (add columns before using them, drop
them a release later).

To roll back, open **Deployments**, pick a previous production deployment
and choose **Instant Rollback**. Rolling back code does not roll back the
database.

After a deploy, `https://<domain>/api/health` should return `{"ok":true}`; it
round-trips to Postgres.

## 5. Transactional email (Resend)

Without email, password-reset links are only written to the server log and
owners must copy invite links by hand. Set it up before inviting real shops.

1. Create an account at [resend.com](https://resend.com) → **Domains** → **Add domain** (use a subdomain such as `mail.yourdomain.com` if you like).
2. Add the DNS records Resend shows (SPF, DKIM) and wait for the domain to show **Verified**.
3. **API Keys** → create a key with **Sending access**.
4. Set in Vercel (Production):

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
2. **Project Settings → Storage → S3 access keys → New access key**. Copy the access key ID and secret. They bypass RLS and can reach every bucket, so they belong only in Vercel's server-side variables (never in a `VITE_` variable).
3. Set in Vercel (Production):

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
- A new shop gets a free trial (`TRIAL_DAYS`, default 14) with no card, starting when you create it.
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
6. Set in Vercel (Production):

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
4. Switch the Vercel variables to the live values, set `PADDLE_ENV=production`, and redeploy.

If the Paddle variables are removed, billing switches off completely: nobody
is restricted and the Billing page and banners disappear.

## 8. Go-live checklist

| Area | Check |
|---|---|
| Health | `https://<domain>/api/health` returns `{"ok":true}`. |
| Onboarding | The sign-in page has no sign-up option. `/ops` → Create shop makes a new, empty organization; the owner's setup link (emailed or copied) lets them choose a password and land in their workspace. |
| Email | "Forgot password?" delivers a working reset link. |
| Staff invite | Owner Settings → Invite staff emails the invite; accepting with the invited email works, and a different email is refused. |
| Tenant isolation | With two organizations, neither sees the other's customers, sales, inventory or staff. |
| Documents | Uploading and opening a staff document works (Staff & Payroll), and a file over 3 MB is refused with a clear message. |
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
first one, so bootstrap it from a shell with access to `DATABASE_URL`, once
the person has an account (create one with `pnpm shop:create` if needed):

```bash
DATABASE_URL=... pnpm platform:grant-staff --email you@example.com --role superadmin
```

`--role` is `support` (read-only across organizations) or `superadmin`
(can also create shops, suspend/reactivate organizations, change billing exemptions and
trials, grant/revoke other platform staff, and impersonate a user for
support). Pass `--revoke` instead of `--role` to remove access. This script
remains the break-glass path even though the ops panel can grant and revoke
staff, the same way `pnpm auth:reset-links` remains the break-glass path for
password resets.

## Security notes

- Login, invite-acceptance, forgot-password and reset endpoints are rate-limited per IP.
- Public sign-up is closed: `/api/auth/register` only accepts a valid staff invite, and only superadmins can create shops.
- The app trusts exactly one proxy hop (Vercel's, which overwrites `X-Forwarded-For` with the client address), so client IPs and HTTPS detection are correct.
- Paddle webhooks are verified against `PADDLE_WEBHOOK_SECRET` over the raw request body, and replays older than 5 minutes are rejected. A subscription can only be linked to a shop through checkout data signed by the server.
- Invite links only work for the email address they were sent to.

## Local development

`docker-compose.yml` is for local development only (it starts a plain Postgres
and the app together). Vercel doesn't use it or the `Dockerfile`; both remain
for local development and for self-hosting on any container platform. Plain
Postgres behaves the same as Supabase for this app, and CI runs
against it too. Don't point local development or tests at the production
Supabase database: the test suite writes rows.

## Internal sales demo

See [DEMO.md](./DEMO.md) for setting up and scheduling resets for the internal
demo organization. The reset keeps the demo organization billing-exempt.
