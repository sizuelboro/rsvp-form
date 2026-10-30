/**
 * Subscription plan definitions. These are the defaults seeded into the
 * `subscription_plans` table; the API reads limits from the database so they can be
 * changed without a deploy. Feature checks always go through `entitlements` on the server.
 */
export type PlanId = 'free' | 'starter' | 'pro' | 'business' | 'agency';

export interface PlanLimits {
  forms: number;
  monthlySubmissions: number;
  events: number;
  guests: number;
  members: number;
  workspaces: number;
  storageMb: number;
}

export interface PlanFeatures {
  conditionalLogic: boolean;
  advancedThemes: boolean;
  customBranding: boolean;
  guestManagement: boolean;
  customDomain: boolean;
  advancedAnalytics: boolean;
  teamCollaboration: boolean;
  emailInvitations: boolean;
  whiteLabel: boolean;
  integrations: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthlyInr: number;
  priceMonthlyUsd: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

const none: PlanFeatures = {
  conditionalLogic: false, advancedThemes: false, customBranding: false, guestManagement: false, customDomain: false,
  advancedAnalytics: false, teamCollaboration: false, emailInvitations: false, whiteLabel: false, integrations: false,
};

export const DEFAULT_PLANS: PlanDefinition[] = [
  { id: 'free', name: 'Free', priceMonthlyInr: 0, priceMonthlyUsd: 0, limits: { forms: 3, monthlySubmissions: 100, events: 1, guests: 50, members: 1, workspaces: 1, storageMb: 100 }, features: { ...none } },
  { id: 'starter', name: 'Starter', priceMonthlyInr: 499, priceMonthlyUsd: 9, limits: { forms: 20, monthlySubmissions: 1000, events: 5, guests: 300, members: 2, workspaces: 1, storageMb: 1024 }, features: { ...none, advancedThemes: true, emailInvitations: true } },
  { id: 'pro', name: 'Pro', priceMonthlyInr: 1499, priceMonthlyUsd: 29, limits: { forms: 100, monthlySubmissions: 10000, events: 50, guests: 5000, members: 3, workspaces: 1, storageMb: 10240 }, features: { ...none, advancedThemes: true, conditionalLogic: true, customBranding: true, guestManagement: true, customDomain: true, advancedAnalytics: true, emailInvitations: true, integrations: true } },
  { id: 'business', name: 'Business', priceMonthlyInr: 3999, priceMonthlyUsd: 79, limits: { forms: 1000, monthlySubmissions: 100000, events: 500, guests: 50000, members: 25, workspaces: 5, storageMb: 102400 }, features: { ...none, advancedThemes: true, conditionalLogic: true, customBranding: true, guestManagement: true, customDomain: true, advancedAnalytics: true, teamCollaboration: true, emailInvitations: true, integrations: true } },
  { id: 'agency', name: 'Agency', priceMonthlyInr: 9999, priceMonthlyUsd: 199, limits: { forms: 10000, monthlySubmissions: 500000, events: 5000, guests: 500000, members: 100, workspaces: 50, storageMb: 512000 }, features: { conditionalLogic: true, advancedThemes: true, customBranding: true, guestManagement: true, customDomain: true, advancedAnalytics: true, teamCollaboration: true, emailInvitations: true, whiteLabel: true, integrations: true } },
];

export type FeatureKey = keyof PlanFeatures;
export type LimitKey = keyof PlanLimits;
