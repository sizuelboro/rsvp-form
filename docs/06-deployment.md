# 06 — Deployment (Cloudflare)

> This repository has **not** been deployed by the build agent — no Cloudflare credentials were provided. The steps below were validated locally against Wrangler's local D1/R2/Queues simulation.

## 1. Create resources

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create rsvp-form                 # copy database_id into wrangler.toml
npx wrangler r2 bucket create rsvp-form-uploads
npx wrangler queues create rsvp-form-notifications
npx wrangler queues create rsvp-form-notifications-dlq
```

## 2. Configure

Edit `apps/api/wrangler.toml`:
- `database_id` from step 1
- `[vars] APP_URL` → your production origin (used in emails, QR codes and share links)
- `EMAIL_FROM` → a sender on your Resend-verified domain, and `EMAIL_MODE = "resend"`
- optionally `TRIAL_PLAN` / `TRIAL_DAYS`

Set secrets:

```bash
npx wrangler secret put IP_HASH_SALT          # long random string
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_WEBHOOK_SECRET # optional: delivery tracking (POST /api/v1/public/webhooks/resend)
npx wrangler secret put SENTRY_DSN            # optional
# Billing (optional):
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET          # endpoint: /api/v1/billing/webhooks/stripe
npx wrangler secret put STRIPE_PRICE_IDS               # JSON: {"starter":"price_…","pro":"price_…",…}
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET        # endpoint: /api/v1/billing/webhooks/razorpay
npx wrangler secret put RAZORPAY_PLAN_IDS              # JSON: {"starter":"plan_…",…}
```

## 3. Migrate and deploy

```bash
npm run db:migrate:remote -w @rsvp/api
npm run deploy            # builds apps/web then `wrangler deploy` (Worker + static assets + queue consumer + cron)
```

## 4. Verify

```bash
curl https://<your-domain>/api/v1/health      # {"ok":true,…}
```

Then sign up, publish a template, submit it from a phone and check the response arrives. Watch logs with `npx wrangler tail`.

## Custom domains for customers

Customers add a hostname under Settings → Domains and create the TXT record `_invitely.<host>`. To serve traffic, add the hostname to your Cloudflare zone (or use Cloudflare for SaaS custom hostnames) pointing at the Worker. Ownership verification is implemented; automatic certificate provisioning via Cloudflare for SaaS is a follow-up.

## Changing plan limits

Edit `packages/core/src/plans.ts`, run `node --experimental-strip-types apps/api/scripts/gen-plan-seed.mjs`, and add the regenerated SQL as a new migration — or update `subscription_plans` directly. Limits take effect immediately without a deploy.
