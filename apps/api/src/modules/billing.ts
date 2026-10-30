import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings, Env } from '../env';
import { permission } from '../lib/auth';
import { hmacSha256Hex, timingSafeEqual } from '../lib/crypto';
import { all, first, nowIso, run } from '../lib/db';
import { ApiError, body, parseJson } from '../lib/http';
import { getEntitlements } from '../lib/entitlements';
import { audit } from '../lib/audit';

type BillingEnv = Env & {
  STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_IDS?: string;
  RAZORPAY_KEY_ID?: string; RAZORPAY_KEY_SECRET?: string; RAZORPAY_WEBHOOK_SECRET?: string; RAZORPAY_PLAN_IDS?: string;
};

export const billing = new Hono<AppBindings>();

billing.get('/plans', async (c) => {
  const plans = await all<{ id: string; name: string; price_monthly_inr: number; price_monthly_usd: number; limits: string; features: string }>(c.env.DB, 'SELECT * FROM subscription_plans WHERE active = 1 ORDER BY sort_order');
  return c.json({ items: plans.map((p) => ({ ...p, limits: parseJson(p.limits, {}), features: parseJson(p.features, {}) })) });
});

billing.get('/subscription', async (c) => {
  const wid = c.get('workspace').id;
  const sub = await first(c.env.DB, 'SELECT plan_id, status, trial_plan_id, trial_ends_at, provider, current_period_end FROM subscriptions WHERE workspace_id = ?', wid);
  const env = c.env as BillingEnv;
  return c.json({ subscription: sub, entitlements: await getEntitlements(c.env.DB, wid), providers: { stripe: Boolean(env.STRIPE_SECRET_KEY), razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) } });
});

/**
 * Starts a hosted checkout. Stripe (international) or Razorpay (India). Plan → provider price
 * mappings come from STRIPE_PRICE_IDS / RAZORPAY_PLAN_IDS JSON env vars so nothing is hardcoded.
 */
billing.post('/checkout', permission('billing.manage'), async (c) => {
  const input = await body(c, z.object({ planId: z.enum(['starter', 'pro', 'business', 'agency']), provider: z.enum(['stripe', 'razorpay']) }));
  const env = c.env as BillingEnv;
  const wid = c.get('workspace').id;
  if (input.provider === 'stripe') {
    const price = parseJson<Record<string, string>>(env.STRIPE_PRICE_IDS, {})[input.planId];
    if (!env.STRIPE_SECRET_KEY || !price) throw new ApiError(503, 'billing_not_configured', 'Stripe billing is not configured for this deployment');
    const form = new URLSearchParams({
      mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1',
      success_url: `${env.APP_URL}/settings/billing?checkout=success`, cancel_url: `${env.APP_URL}/settings/billing?checkout=cancelled`,
      client_reference_id: wid, 'metadata[workspace_id]': wid, 'metadata[plan_id]': input.planId,
      'subscription_data[metadata][workspace_id]': wid, 'subscription_data[metadata][plan_id]': input.planId,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    const json = (await res.json()) as { url?: string; error?: { message: string } };
    if (!res.ok || !json.url) throw new ApiError(503, 'billing_error', json.error?.message ?? 'Could not start checkout');
    await audit(c, 'billing.checkout_started', undefined, input);
    return c.json({ url: json.url });
  }
  const planIdRzp = parseJson<Record<string, string>>(env.RAZORPAY_PLAN_IDS, {})[input.planId];
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !planIdRzp) throw new ApiError(503, 'billing_not_configured', 'Razorpay billing is not configured for this deployment');
  const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ plan_id: planIdRzp, total_count: 120, customer_notify: 1, notes: { workspace_id: wid, plan_id: input.planId } }),
  });
  const json = (await res.json()) as { short_url?: string; id?: string; error?: { description: string } };
  if (!res.ok || !json.short_url) throw new ApiError(503, 'billing_error', json.error?.description ?? 'Could not start checkout');
  await audit(c, 'billing.checkout_started', undefined, input);
  return c.json({ url: json.short_url });
});

// ─── Provider webhooks (public, signature-verified) ───
export const billingWebhooks = new Hono<AppBindings>();

async function setPlan(db: D1Database, wid: string, planId: string, status: string, provider: string, customer: string | null, subId: string | null, periodEnd: string | null) {
  await run(db, `UPDATE subscriptions SET plan_id = ?, status = ?, provider = ?, provider_customer_id = COALESCE(?, provider_customer_id), provider_subscription_id = COALESCE(?, provider_subscription_id),
    current_period_end = ?, trial_plan_id = NULL, trial_ends_at = NULL, updated_at = ? WHERE workspace_id = ?`, planId, status, provider, customer, subId, periodEnd, nowIso(), wid);
}

billingWebhooks.post('/stripe', async (c) => {
  const env = c.env as BillingEnv;
  if (!env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, 'not_configured', 'Stripe webhooks are not configured');
  const raw = await c.req.text();
  const header = c.req.header('stripe-signature') ?? '';
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  if (!parts.t || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new ApiError(400, 'bad_request', 'Stale signature');
  const expected = await hmacSha256Hex(env.STRIPE_WEBHOOK_SECRET, `${parts.t}.${raw}`);
  const enc = new TextEncoder();
  if (!parts.v1 || !timingSafeEqual(enc.encode(expected), enc.encode(parts.v1))) throw new ApiError(401, 'invalid_signature', 'Invalid signature');
  const evt = parseJson<{ type: string; data: { object: Record<string, unknown> } }>(raw, { type: '', data: { object: {} } });
  const obj = evt.data.object as { metadata?: Record<string, string>; customer?: string; id?: string; subscription?: string; status?: string; current_period_end?: number };
  const wid = obj.metadata?.workspace_id;
  const plan = obj.metadata?.plan_id;
  if (wid && plan) {
    if (evt.type === 'checkout.session.completed') await setPlan(c.env.DB, wid, plan, 'active', 'stripe', obj.customer ?? null, obj.subscription ?? null, null);
    if (evt.type === 'customer.subscription.updated') await setPlan(c.env.DB, wid, plan, obj.status === 'past_due' ? 'past_due' : obj.status === 'canceled' ? 'canceled' : 'active', 'stripe', obj.customer ?? null, obj.id ?? null, obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null);
    if (evt.type === 'customer.subscription.deleted') await setPlan(c.env.DB, wid, 'free', 'active', 'stripe', obj.customer ?? null, obj.id ?? null, null);
  }
  return c.json({ received: true });
});

billingWebhooks.post('/razorpay', async (c) => {
  const env = c.env as BillingEnv;
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new ApiError(503, 'not_configured', 'Razorpay webhooks are not configured');
  const raw = await c.req.text();
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, raw);
  const enc = new TextEncoder();
  if (!timingSafeEqual(enc.encode(expected), enc.encode(c.req.header('x-razorpay-signature') ?? ''))) throw new ApiError(401, 'invalid_signature', 'Invalid signature');
  const evt = parseJson<{ event: string; payload?: { subscription?: { entity?: { id: string; customer_id?: string; notes?: Record<string, string>; current_end?: number } } } }>(raw, { event: '' });
  const sub = evt.payload?.subscription?.entity;
  const wid = sub?.notes?.workspace_id;
  const plan = sub?.notes?.plan_id;
  if (sub && wid && plan) {
    const periodEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null;
    if (['subscription.activated', 'subscription.charged', 'subscription.resumed'].includes(evt.event)) await setPlan(c.env.DB, wid, plan, 'active', 'razorpay', sub.customer_id ?? null, sub.id, periodEnd);
    if (evt.event === 'subscription.halted' || evt.event === 'subscription.pending') await setPlan(c.env.DB, wid, plan, 'past_due', 'razorpay', sub.customer_id ?? null, sub.id, periodEnd);
    if (evt.event === 'subscription.cancelled' || evt.event === 'subscription.completed') await setPlan(c.env.DB, wid, 'free', 'active', 'razorpay', sub.customer_id ?? null, sub.id, null);
  }
  return c.json({ received: true });
});
