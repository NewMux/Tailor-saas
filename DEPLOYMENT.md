# Deployment: Hetzner + Coolify

Coolify runs one Docker Compose stack on a Hetzner server. The stack is two
services: `postgres`, and `app` — an Express process that serves the tRPC/REST
API, the built React frontend and the public landing page from a single origin.

```text
Visitor / shop staff
    │
    └── https://your-domain           ──►  Coolify proxy (terminates TLS)
                                             │
                                             └── app service :3000
                                                   ├── /              landing page (signed out)
                                                   ├── /api/*         API + Paddle webhook
                                                   └── postgres  ──►  postgres_data volume
```

There is no separate frontend host and no reverse proxy to hand-configure:
Coolify's proxy handles the domain, HTTPS certificate and renewal.

Read [PADDLE_SETUP.md](./PADDLE_SETUP.md) alongside this. **Paddle's approval
of a new seller usually takes several business days**, so plan to launch on the
sandbox and flip to live when approval lands — the switch is one env var.

---

## 1. Provision the Hetzner server

Hetzner Cloud → new project → **Add Server**:

| Setting | Value |
|---|---|
| Location | Falkenstein/Nuremberg (EU) or Ashburn (US). Hetzner has no GCC region; EU gives ~90-130 ms to the Gulf, which is fine for this app. |
| Image | Ubuntu 24.04 LTS |
| Type | **CPX31** (4 vCPU / 8 GB / 160 GB) for a real launch. CPX21 (3 vCPU / 4 GB) works for a pilot; below that the Docker build itself will struggle. |
| Volume | Not required — the Postgres volume lives on the server disk. Add one if you expect heavy document storage. |
| Backups | **Enable.** This is the cheapest insurance you will ever buy on customer data. |
| SSH key | Add yours. Do not rely on a root password. |

Point your domain's DNS at the server before installing Coolify, so the
certificate can be issued on the first deploy:

| Type | Name | Value |
|---|---|---|
| A | `@` (or your subdomain) | the server's IPv4 |
| AAAA | same | the server's IPv6 (optional) |

Wait for DNS to resolve (`dig +short your-domain`) before step 3.

## 2. Install Coolify

SSH in as root and run the official installer:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Then open `http://YOUR-SERVER-IP:8000`, create the admin account **immediately**
(the instance is unauthenticated until you do), and set up the firewall:

```bash
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
```

Leave port 8000 closed to the internet and reach the Coolify dashboard over an
SSH tunnel (`ssh -L 8000:localhost:8000 root@YOUR-SERVER-IP`), or restrict it
to your own IP. Do not expose Postgres publicly at all.

## 3. Create the application in Coolify

**Projects → New Project → New Resource → Public/Private Repository.**

| Coolify field | Value |
|---|---|
| Repository | this repo |
| Branch | `main` |
| Build pack | **Docker Compose** |
| Base directory | `/` |
| Docker Compose location | `docker-compose.yml` |
| Public service | `app` |
| Public port | `3000` |
| Domain | `https://your-domain` |
| Database public exposure | **Disabled** |

Do not add a `networks:` section or a host port mapping in Coolify's editor —
Coolify creates the network itself, and a custom one makes its proxy routing
intermittent. The Compose file in this repo is written for exactly this.

## 4. Set the environment variables

In the resource's **Environment Variables** screen. Generate real secrets — do
not copy the placeholders:

```dotenv
POSTGRES_DB=tailor_erp
POSTGRES_USER=erp
POSTGRES_PASSWORD=<openssl rand -base64 24>
DATABASE_URL=postgres://erp:<same password, URL-encoded>@postgres:5432/tailor_erp

AUTH_BASE_URL=https://your-domain
NODE_ENV=production
PORT=3000

PADDLE_ENVIRONMENT=sandbox
PADDLE_API_KEY=<from Paddle>
PADDLE_CLIENT_TOKEN=<from Paddle>
PADDLE_PRICE_ID=<pri_... from Paddle>
PADDLE_WEBHOOK_SECRET=<pdl_ntfset_... from Paddle>
BILLING_TRIAL_DAYS=14
BILLING_GRACE_DAYS=7
BILLING_DISPLAY_PRICE=29
BILLING_DISPLAY_CURRENCY=USD

LOG_LEVEL=info
SENTRY_DSN=
```

Two things that will bite you if you get them wrong:

- **`DATABASE_URL` host is `postgres`**, the Compose service name — not
  `localhost` and not your domain.
- **URL-encode the password** inside `DATABASE_URL` if it contains `@ : / ? # &`.
  `openssl rand -base64 24` can emit `/` and `+`; either encode them or
  regenerate until it doesn't.

Leave the three Paddle credentials blank if you want to launch with billing
switched off — nothing is paywalled in that mode.

## 5. Deploy

Press **Deploy**. Coolify builds the Dockerfile and starts the stack. Database
migrations run automatically on container start (the image's `CMD` runs
`drizzle-kit migrate` before the server), so there is no separate migrate step.

Watch the logs until you see the server listening. First deploy takes several
minutes — the image installs dependencies and builds the frontend.

## 6. Point Paddle's webhook at the deployment

In Paddle → **Developer tools → Notifications**, set the destination URL to:

```
https://your-domain/api/billing/webhook
```

Subscribe to the eight `subscription.*` events listed in PADDLE_SETUP.md, then
copy the destination's secret into `PADDLE_WEBHOOK_SECRET` and redeploy.

The webhook must be reachable from the public internet over HTTPS with a valid
certificate. Paddle will not deliver to a self-signed certificate.

---

## Acceptance checklist

Run all of this against the deployed domain before you announce it.

| # | Check | Expected |
|---|---|---|
| 1 | Visit `https://your-domain` signed out | Landing page, not a login form |
| 2 | Switch the language to العربية | Whole page flips right-to-left |
| 3 | Click "Start free trial", register a shop | Lands in the ERP dashboard |
| 4 | Open **Subscription** | "14 days left in your free trial" |
| 5 | Create a customer, then a tailoring order | Both save and appear in lists |
| 6 | Register a *second* shop in a private window | Its dashboard is empty — none of shop one's data |
| 7 | Subscribe with Paddle's test card `4242 4242 4242 4242` | Page shows "Your subscription is active" |
| 8 | Paddle → Notifications → Logs | Delivered, HTTP 200 |
| 9 | Force-expire the trial (SQL in PADDLE_SETUP.md) on an unsubscribed shop | Workspace replaced by the subscription screen |
| 10 | Reload with the browser offline, make a counter sale | Sale queues locally and syncs when back online |
| 11 | Password reset from the sign-in screen | Reset link uses your real domain, not `localhost` |

Checks 6 and 9 are the two that matter most: 6 proves tenant isolation, 9
proves the paywall. Neither can be inferred from the others.

## Backups

Hetzner snapshots cover the whole server, but take a database dump you can
restore independently:

```bash
docker exec -t $(docker ps -qf name=postgres) \
  pg_dump -U erp --format=custom tailor_erp > "backup-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Copy it **off the server**. A backup that only exists on the machine it is
backing up is not a backup. Schedule it in Coolify → **Scheduled Tasks**, and
restore-test it at least once before you have real customers.

## Updating

Push to `main`. Coolify redeploys automatically if you enabled the webhook, or
press **Redeploy**. Migrations run on start; new columns are additive, so a
deploy does not need downtime.

Roll back from **Deployments** — Coolify keeps previous images. Note that a
rollback does **not** undo a database migration, so a deploy containing a
destructive migration needs a database restore too.

## Operating notes

- **Logs**: Coolify → the resource → Logs. Structured JSON via pino; set
  `LOG_LEVEL=debug` temporarily to trace a problem.
- **Health check**: the container reports healthy via `/api/auth/session`.
  Coolify restarts it automatically if that fails.
- **Errors**: set `SENTRY_DSN` to get server exceptions reported.
- **Scaling**: this is a single Node process. It comfortably serves dozens of
  shops. Before it stops being enough you will want a managed Postgres and more
  than one app container, which is a change to this Compose file, not to the
  application.
