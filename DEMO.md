# Internal sales demo

This repo doubles as the sales team's own internal demo instance — a real,
working ERP with realistic sample data the team can pull up on a call to give
a hands-on walkthrough. This is separate from any paying customer's dedicated
deployment (each of those is its own fork/rebrand/domain, per the normal
sales process). The demo is **not public and not self-serve**: no link to it
is published anywhere, and there is no landing page in this app — visitors
who aren't logged in just see the sign-in screen.

There's no `isDemo` flag or schema change involved. The demo organization is
just an ordinary organization, identified by a fixed, known owner email.

## One-time setup (only ever done once)

Register the demo organization through the app's normal sign-up flow —
"Create your shop" — using credentials the whole sales team can reuse:

- **Organization name**: e.g. "Tafsell Demo Tailors"
- **Owner email**: a fixed address, e.g. `demo@yourcompany.example` — this
  becomes `DEMO_OWNER_EMAIL` below
- **Password**: store it in the team's password manager. **Never commit it
  or put it in this file.**

The reset script (below) never touches this user, its password, its
organization, or its role — only the business-data tables get wiped and
reseeded. So this registration step happens exactly once, ever; login stays
stable across every future reset.

## Running the reset manually

```bash
DATABASE_URL=postgresql://... DEMO_OWNER_EMAIL=demo@yourcompany.example pnpm demo:reset
```

This wipes the demo org's customers, inventory, tailoring orders, sales,
invoices, staff, payroll, and audit trail, then reseeds a fresh, realistic
sample dataset (a handful of customers, fabric/accessory inventory, two
services, two staff members, one tailoring order, two POS sales, and one
payout) by calling the app's own tRPC procedures — the same code path a real
click-through would take, so sequence numbers, stock levels, and audit
entries all come out exactly as they would for a real user.

Optionally set `DEMO_ORG_SLUG` (the organization's slug, visible in Shop
Settings) as an extra safety check — the script refuses to run if the
resolved organization's slug doesn't match, to guard against pointing it at
the wrong environment.

## Scheduling automatic resets

**Coolify (preferred — this repo already deploys through Coolify's Docker
Compose stack per `HETZNER_DEPLOYMENT.md`)**: in the `app` service's
*Scheduled Tasks* tab, add a task that runs `pnpm demo:reset` on a cron
schedule, with `DEMO_OWNER_EMAIL` set as the task's environment variable (or
inherited from the service). Example — nightly at 03:00 UTC:

```
0 3 * * *
```

**Plain crontab (non-Coolify hosts)** — example line for the deploy user's
crontab, resetting nightly at 03:00 server time:

```
0 3 * * * cd /opt/tailor-erp/app && DEMO_OWNER_EMAIL=demo@yourcompany.example DATABASE_URL=postgresql://... /usr/bin/pnpm demo:reset >> /var/log/tailor-erp/demo-reset.log 2>&1
```

## What gets wiped vs. preserved

| Wiped and reseeded every run | Never touched |
|---|---|
| customers, measurementProfiles | organizations |
| tailoringOrders, sales, saleItems | users |
| posSessions, posOrders, posPayments | userBusinessRoles |
| invoices, invoicePayments, invoiceDeliveries | shopSettings |
| customerBalanceDeliveries | authSessions |
| inventoryItems, stockMovements | passwordResetTokens |
| services, discountCodes | pendingAccessRequests |
| staffProfiles, staffDocuments | |
| attendance, performanceRecords, salaryPayouts | |
| customRoles, userCustomRoles, staffAccessInvites | |
| auditLogs | |

Login credentials and shop branding never change across a reset.
