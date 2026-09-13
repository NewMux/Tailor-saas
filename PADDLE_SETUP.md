# Paddle setup

Everything in this guide happens in the Paddle dashboard, not in the code. The
application reads all of it from environment variables, so nothing here needs a
rebuild — set the variables, restart the app, done.

> **Plan for the approval delay.** Paddle is a Merchant of Record: it sells to
> your customers on your behalf and handles VAT. Before it will take live
> payments it has to approve your business (KYC — company documents, ownership,
> what you sell, your website). **This review commonly takes several business
> days.** You cannot shorten it by deploying faster. Deploy against the
> **sandbox** on day one, launch publicly when approval lands.

## 0. Before you start

Have ready:

- A registered business (CR/trade licence). Paddle's approval of sellers based
  in GCC countries is decided case by case — apply early, and if Paddle cannot
  onboard your entity, see "If Paddle will not onboard you" at the end.
- A live website at your real domain. Paddle reviewers open it. The landing
  page in this repo is what they will look at, so deploy it **before** you
  submit for approval.
- Terms of service, a privacy policy and a refund policy reachable from that
  site. Paddle routinely rejects applications that lack these.

## 1. Create the account

1. Sign up at <https://www.paddle.com>. Choose **Paddle Billing** (not the
   legacy "Paddle Classic" product).
2. Complete the business verification form and submit for approval.
3. While waiting, do everything below in the **sandbox** dashboard
   (<https://sandbox-vendors.paddle.com>). Sandbox and live are entirely
   separate: separate logins, keys, products and prices. Nothing you create in
   one appears in the other, so you will repeat section 2-4 once approved.

## 2. Create the product and price

1. **Catalog → Products → New product.** Name it (for example
   "Tafsell Tailor ERP"). Add a description and an icon — these show on the
   checkout your customers see.
2. Inside that product, **New price**:
   - Billing period: **Monthly** (recurring).
   - Amount: your monthly price.
   - Currency: pick your base currency. Paddle converts and displays local
     currency to buyers automatically; the landing page asks Paddle for a
     localized price so a visitor in Riyadh sees SAR and one in Dubai sees AED.
   - Trial period: **leave empty.** This app runs its own 14-day trial before
     checkout (no card required), which is why signup does not ask for one.
3. Copy the price ID — it starts with `pri_`. That is `PADDLE_PRICE_ID`.

## 3. Create the API credentials

**Developer tools → Authentication.**

| Create | Dashboard section | Environment variable | Secret? |
|---|---|---|---|
| API key | Authentication → API keys | `PADDLE_API_KEY` | **Yes — server only** |
| Client-side token | Authentication → Client-side tokens | `PADDLE_CLIENT_TOKEN` | No — published to the browser by design |

The API key is shown once. Store it in a password manager; if you lose it,
revoke it and issue a new one rather than hunting for it.

## 4. Create the webhook destination

This is the step that makes subscriptions actually activate. Without it a
customer can pay and still stay locked out, because nothing tells the app the
payment succeeded.

1. **Developer tools → Notifications → New destination.**
2. URL: `https://YOUR-DOMAIN/api/billing/webhook`
   (your real domain, HTTPS, no trailing slash).
3. Notification type: **Webhook**.
4. Subscribe to these events — the app ignores everything else:
   - `subscription.created`
   - `subscription.activated`
   - `subscription.updated`
   - `subscription.canceled`
   - `subscription.paused`
   - `subscription.resumed`
   - `subscription.past_due`
   - `subscription.trialing`
5. Save, then copy the destination's **secret key** (starts with `pdl_ntfset_`).
   That is `PADDLE_WEBHOOK_SECRET`.

Every request to that URL is verified with an HMAC-SHA256 signature computed
over the raw request body. A request with a missing, malformed or wrong
signature is rejected (401/400) and changes nothing.

## 5. Set the environment variables

In Coolify (or your `.env` locally):

```dotenv
PADDLE_ENVIRONMENT=sandbox          # "production" once approved and live
PADDLE_API_KEY=pdl_sdbx_apikey_...
PADDLE_CLIENT_TOKEN=test_...
PADDLE_PRICE_ID=pri_...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_...
BILLING_TRIAL_DAYS=14
BILLING_GRACE_DAYS=7
BILLING_DISPLAY_PRICE=29            # fallback landing-page price
BILLING_DISPLAY_CURRENCY=USD
```

Restart the app. Until `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN` and
`PADDLE_PRICE_ID` are all set, the app deliberately runs with **billing
disabled**: nothing is paywalled and no checkout is offered. That is a safety
property, not a bug — a deployment nobody can pay for must not lock its users
out.

## 6. Test the whole loop in sandbox

Use Paddle's test card: **4242 4242 4242 4242**, any future expiry, any CVC.

1. Register a new shop on your deployed site. You should land in the ERP with a
   14-day trial (Subscription page shows "14 days left in your free trial").
2. Go to **Subscription → Subscribe now** and pay with the test card.
3. Within seconds the page should show "Your subscription is active".
4. Confirm the webhook arrived: **Developer tools → Notifications → your
   destination → Logs** should show a delivered event with a 200 response.
5. Confirm it was stored — on the server:

   ```sql
   SELECT "subscriptionStatus", "paddleSubscriptionId", "currentPeriodEndsAt"
   FROM organizations ORDER BY id DESC LIMIT 1;
   ```

   Expect `active` and a populated subscription ID.

### Testing the paywall itself

Force a lockout without waiting 14 days:

```sql
UPDATE organizations SET "trialEndsAt" = now() - interval '1 day'
WHERE id = <org id>;
```

Reload the app: the whole workspace is replaced by the subscription screen, and
the API returns HTTP 402 for every ERP request. Subscribing restores it.

## 7. Going live

Once Paddle approves the account:

1. Redo sections 2-4 in the **live** dashboard. The sandbox IDs will not work.
2. Replace all five Paddle variables with the live values.
3. Set `PADDLE_ENVIRONMENT=production`.
4. Restart, and run one **real** card payment end to end. Refund it from the
   Paddle dashboard afterwards.

Do not mix sandbox and live values. A live client token with a sandbox price ID
fails at checkout with an unhelpful error.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Checkout button disabled / "payment form is still loading" | `PADDLE_CLIENT_TOKEN` unset or wrong environment. Check the browser console. |
| Paid, but still locked out | Webhook not reaching the app. Check Notifications → Logs. A 401 means `PADDLE_WEBHOOK_SECRET` is wrong; a timeout means the URL is unreachable from the internet. |
| Webhook log shows 503 | The app has no Paddle credentials set — it refuses webhooks rather than acting on unverifiable ones. |
| "Billing is not configured" on the Subscription page | One of the three required variables is missing. All three must be set. |
| Landing page shows the fallback price, not a local one | Paddle.js could not load (ad blocker, network). Harmless: checkout still works and still shows local currency. |
| Nothing is paywalled even after the trial ended | Billing disabled — credentials missing. Same three variables. |

## If Paddle will not onboard you

Paddle's seller eligibility depends on your registered entity's country, and
GCC-registered businesses are not guaranteed acceptance. If your application is
declined, the options are, in rough order of effort:

- **Another Merchant of Record** — Lemon Squeezy (now Paddle-owned), Gumroad,
  FastSpring. Same model, same webhook-driven design; the integration in
  `server/billingService.ts` is deliberately thin and would need rewriting only
  at the boundary.
- **A regional PSP** — Tap Payments, HyperPay, Moyasar, PayTabs and Checkout.com
  all onboard GCC businesses readily, but they are payment processors, not
  merchants of record: VAT registration and filing in each country you sell to
  become **your** responsibility.
- **Manual invoicing** — set `BILLING_TRIAL_DAYS` high, invoice customers
  offline, and flip `subscriptionStatus` to `active` by hand. Crude, but it
  unblocks selling while payment onboarding is sorted out.
