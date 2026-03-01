/**
 * Subscription tier configuration.
 * Pricing is per-currency: CAD is the canonical price, USD is the regional equivalent.
 * Price IDs come from env vars so they can differ between Stripe test/live modes.
 */

export type SubscriptionTierKey = "STARTER" | "GROWTH" | "PRO";
export type BillingCurrency = "cad" | "usd";

export interface TierConfig {
  key: SubscriptionTierKey;
  name: string;
  athleteLimit: number;
  features: {
    advancedAnalytics: boolean;
    advancedReporting: boolean;
    aiAtRiskDetection: boolean;
  };
  pricing: Record<
    BillingCurrency,
    { amountCents: number; stripePriceIdEnvVar: string }
  >;
}

export const TIER_CONFIG: Record<SubscriptionTierKey, TierConfig> = {
  STARTER: {
    key: "STARTER",
    name: "Starter",
    athleteLimit: 75,
    features: {
      advancedAnalytics: false,
      advancedReporting: false,
      aiAtRiskDetection: false,
    },
    pricing: {
      cad: { amountCents: 8000, stripePriceIdEnvVar: "STRIPE_PRICE_STARTER_CAD" },
      usd: { amountCents: 5900, stripePriceIdEnvVar: "STRIPE_PRICE_STARTER_USD" },
    },
  },
  GROWTH: {
    key: "GROWTH",
    name: "Growth",
    athleteLimit: 200,
    features: {
      advancedAnalytics: true,
      advancedReporting: false,
      aiAtRiskDetection: false,
    },
    pricing: {
      cad: { amountCents: 20000, stripePriceIdEnvVar: "STRIPE_PRICE_GROWTH_CAD" },
      usd: { amountCents: 14900, stripePriceIdEnvVar: "STRIPE_PRICE_GROWTH_USD" },
    },
  },
  PRO: {
    key: "PRO",
    name: "Pro",
    athleteLimit: 500,
    features: {
      advancedAnalytics: true,
      advancedReporting: true,
      aiAtRiskDetection: true,
    },
    pricing: {
      cad: { amountCents: 45000, stripePriceIdEnvVar: "STRIPE_PRICE_PRO_CAD" },
      usd: { amountCents: 32900, stripePriceIdEnvVar: "STRIPE_PRICE_PRO_USD" },
    },
  },
};

/** Returns the Stripe Price ID for a given tier + currency from env vars. */
export function getStripePriceId(
  tier: SubscriptionTierKey,
  currency: BillingCurrency
): string | undefined {
  const envVar = TIER_CONFIG[tier].pricing[currency].stripePriceIdEnvVar;
  return process.env[envVar];
}

/** Returns the athlete limit for a tier. */
export function getAthleteLimit(tier: SubscriptionTierKey): number {
  return TIER_CONFIG[tier].athleteLimit;
}

/** Returns whether a tier has access to a specific feature. */
export function tierHasFeature(
  tier: SubscriptionTierKey,
  feature: keyof TierConfig["features"]
): boolean {
  return TIER_CONFIG[tier].features[feature];
}

/** Normalizes a currency string to a supported BillingCurrency, defaulting to "usd". */
export function normalizeCurrency(raw: string | null | undefined): BillingCurrency {
  const lower = (raw ?? "").toLowerCase();
  if (lower === "cad") return "cad";
  return "usd";
}

/** Tier order for upgrade/downgrade comparisons. */
const TIER_ORDER: SubscriptionTierKey[] = ["STARTER", "GROWTH", "PRO"];

export function isTierUpgrade(
  from: SubscriptionTierKey,
  to: SubscriptionTierKey
): boolean {
  return TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(from);
}
