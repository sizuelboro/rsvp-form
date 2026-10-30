import type { FeatureKey, LimitKey, PlanFeatures, PlanLimits } from '@rsvp/core';
import { ApiError, parseJson } from './http';
import { first, nowIso } from './db';

export interface Entitlements {
  planId: string;
  planName: string;
  status: string;
  trialEndsAt: string | null;
  limits: PlanLimits;
  features: PlanFeatures;
}

/**
 * Resolve the effective plan for a workspace. An active trial grants the trial plan's
 * entitlements; otherwise the subscribed plan applies. All limits come from the database.
 */
export async function getEntitlements(db: D1Database, workspaceId: string): Promise<Entitlements> {
  const sub = await first<{ plan_id: string; status: string; trial_plan_id: string | null; trial_ends_at: string | null }>(
    db, 'SELECT plan_id, status, trial_plan_id, trial_ends_at FROM subscriptions WHERE workspace_id = ?', workspaceId);
  const trialActive = Boolean(sub?.trial_plan_id && sub.trial_ends_at && sub.trial_ends_at > nowIso());
  const planId = trialActive ? sub!.trial_plan_id! : sub && sub.status !== 'canceled' ? sub.plan_id : 'free';
  const plan = await first<{ id: string; name: string; limits: string; features: string }>(db, 'SELECT id, name, limits, features FROM subscription_plans WHERE id = ?', planId)
    ?? await first<{ id: string; name: string; limits: string; features: string }>(db, "SELECT id, name, limits, features FROM subscription_plans WHERE id = 'free'");
  if (!plan) throw new ApiError(500, 'plans_missing', 'Subscription plans are not configured');
  return {
    planId: plan.id,
    planName: plan.name,
    status: trialActive ? 'trialing' : sub?.status ?? 'active',
    trialEndsAt: trialActive ? sub!.trial_ends_at : null,
    limits: parseJson<PlanLimits>(plan.limits, {} as PlanLimits),
    features: parseJson<PlanFeatures>(plan.features, {} as PlanFeatures),
  };
}

const FEATURE_LABELS: Record<FeatureKey, string> = {
  conditionalLogic: 'Conditional logic', advancedThemes: 'Advanced themes', customBranding: 'Custom branding',
  guestManagement: 'Guest management', customDomain: 'Custom domains', advancedAnalytics: 'Advanced analytics',
  teamCollaboration: 'Team collaboration', emailInvitations: 'Email invitations', whiteLabel: 'White-label', integrations: 'Integrations',
};

export async function requireFeature(db: D1Database, workspaceId: string, feature: FeatureKey): Promise<Entitlements> {
  const e = await getEntitlements(db, workspaceId);
  if (!e.features[feature]) {
    throw new ApiError(402, 'upgrade_required', `${FEATURE_LABELS[feature]} is not included in the ${e.planName} plan`, { feature, plan: e.planId });
  }
  return e;
}

const USAGE_QUERIES: Record<Exclude<LimitKey, 'storageMb' | 'workspaces'>, string> = {
  forms: 'SELECT COUNT(*) AS n FROM forms WHERE workspace_id = ? AND deleted_at IS NULL',
  events: 'SELECT COUNT(*) AS n FROM events WHERE workspace_id = ? AND deleted_at IS NULL',
  guests: 'SELECT COUNT(*) AS n FROM guests WHERE workspace_id = ? AND deleted_at IS NULL',
  members: 'SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?',
  monthlySubmissions: "SELECT COUNT(*) AS n FROM submissions WHERE workspace_id = ? AND created_at >= strftime('%Y-%m-01T00:00:00.000Z','now')",
};

export async function usage(db: D1Database, workspaceId: string, key: keyof typeof USAGE_QUERIES): Promise<number> {
  return (await first<{ n: number }>(db, USAGE_QUERIES[key], workspaceId))?.n ?? 0;
}

/** Throws 402 when adding `adding` more units would exceed the plan limit. */
export async function requireWithinLimit(db: D1Database, workspaceId: string, key: keyof typeof USAGE_QUERIES, adding = 1): Promise<void> {
  const e = await getEntitlements(db, workspaceId);
  const limit = e.limits[key];
  const used = await usage(db, workspaceId, key);
  if (used + adding > limit) {
    throw new ApiError(402, 'limit_reached', `Your ${e.planName} plan allows ${limit} ${key === 'monthlySubmissions' ? 'submissions per month' : key}`, { limit: key, max: limit, used });
  }
}
