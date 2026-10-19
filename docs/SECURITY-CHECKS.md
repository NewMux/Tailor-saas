# Checking authorization, isolation and security

What to run, what to look at in `/ops`, and what "good" looks like. Everything
here is safe on production unless it says otherwise.

## 1. Automated checks (run on every change)

| Check | What it proves | How |
| --- | --- | --- |
| `server/procedure-matrix.test.ts` | Every tRPC procedure is classified in `server/_core/procedureManifest.ts`, and the real router refuses the callers it should: anonymous, no shop, suspended shop, shop user on operator routes, support on superadmin routes, impersonation sessions, missing password confirmation. Adding a procedure without classifying it fails the build. | `pnpm test` |
| `server/tenant-isolation.test.ts`, `tenant-references.test.ts` | One shop cannot read or change another's data, including through ids it supplies (customers, services, sessions, staff). | `pnpm test` |
| Tenant guard (`server/db.ts`) | During any tenant request, every tenant table in a query must be constrained by its own `organizationId`; inserts must set it. The whole test suite runs under it, so a new unscoped query fails whichever test exercises it. | `pnpm test` |
| `server/schema-drift.test.ts` | Hand-written migrations produce the schema the code expects. | `pnpm test` |
| `server/rls.test.ts` | Row-level security is on for every table. | `pnpm test` |
| `scripts/security-probe.ts` | Black-box over HTTP: headers, CORS, anonymous access, closed sign-up, no reset link in responses, and (full mode) two throwaway shops attacking each other. | CI e2e job; see section 2 |

## 2. Probing a deployment

```bash
# Read-only; safe against production
pnpm security:probe --base-url https://your-app.example \
  --supabase-url https://<ref>.supabase.co --anon-key <publishable key>

# Local / CI only: creates two throwaway shops and an operator
pnpm security:probe --base-url http://localhost:3000 --mode full --bootstrap
```

From GitHub: **Actions -> Security probe -> Run workflow** (read-only).
Expect no `FAIL`. A `WARN` on Content-Security-Policy means it is not enforced yet.

## 3. Manual walkthrough in `/ops` (about 20 minutes)

Create two test shops ("ZZ Test A", "ZZ Test B") from `/ops` -> Create shop and
finish each owner's setup. Suspend both when you are done.

1. **Isolation.** Sign in as A's owner in one browser and B's in another. Add a
   customer and an inventory item in A. In B, confirm Customers, Inventory, POS
   catalog and Sales history show nothing of A's. Note A's customer URL ids are
   not guessable into B's data.
2. **Roles.** In A, create a custom role with only "Dashboard", invite a
   teammate to it, accept the invite, and confirm they can open the dashboard
   but get "not permitted" on customers, sales, inventory and staff. Clear the
   role in Settings and confirm they lose access entirely.
3. **Access review.** `/ops` -> Users -> search that teammate. The
   "Effective access" list must match what you just saw in step 2.
4. **Read-only impersonation.** `/ops` -> open shop A -> Impersonate (Read-only).
   Browse; try to add a customer: it must be refused. Exit.
5. **Write impersonation.** Impersonate again with *Write*; confirm the
   password prompt. Add a customer, then check `/ops` -> Audit -> *Actions during
   impersonation*: the change shows your name. Try inviting staff or changing
   roles while impersonating: it must be refused.
6. **Suspension.** Suspend B; B's owner is refused at sign-in and an open
   session stops working. Reactivate it.
7. **Sessions.** `/ops` -> Security -> Active sessions: revoke a session and
   confirm that browser is signed out.
8. **Operators.** Invite a teammate as `support`; confirm they land in the
   console, can read everything, and see none of the superadmin actions.
   Try to revoke your own access: it must be refused.

## 4. What the Security page tells you

- **Database:** tables without row-level security (must be none); grants held by
  the public API roles (must be 0 after migration 0018); migrations applied vs
  the repository.
- **Operators:** active superadmins with a password (keep at least 2).
- **Cross-tenant references:** rows whose parent belongs to another shop. Must be
  zero. If not, find them with the query below and fix or delete the offending
  rows after checking what they are.
- **Alerts:** lockouts and failed sign-ins in the last 24 h, operator sign-ins
  from a new address, write-mode impersonations this week.

```sql
-- Example: services pointing at another shop's inventory item
select s.id, s."organizationId", i."organizationId" as item_org
from "services" s join "inventoryItems" i on i.id = s."inventoryItemId"
where i."organizationId" <> s."organizationId";
-- Fix (keeps the service, drops the bad link):
-- update "services" s set "inventoryItemId" = null from "inventoryItems" i
--  where i.id = s."inventoryItemId" and i."organizationId" <> s."organizationId";
```

## 5. Incidents

- **Suspected stolen session or password:** `/ops` -> Users -> *Sign out*. For
  everyone: `/ops` -> Security -> *Sign out everyone* (or
  `pnpm auth:revoke-sessions`). Then reset the person's password.
- **An operator leaves:** `/ops` -> Platform staff -> Revoke (signs them out at once).
- **Lost the last superadmin:** `pnpm platform:grant-staff --email ... --name ... --role superadmin`
  from a shell with `DATABASE_URL`; it prints a one-time link.
- **Account locked by repeated attempts:** wait 15 minutes, or use *Forgot
  password* (reset links are never locked out).
- **Leaked database or storage credentials:** rotate them in Supabase and Vercel,
  then sign everyone out.
