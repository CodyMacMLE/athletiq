export const subscriptionsSchema = `#graphql
  # ---- Enums ----

  enum SubscriptionTier {
    STARTER
    GROWTH
    PRO
  }

  enum SubscriptionStatus {
    TRIALING
    ACTIVE
    PAST_DUE
    CANCELED
  }

  enum BillingPeriod {
    MONTHLY
    ANNUAL
  }

  # ---- Types ----

  type TierPricing {
    currency: String!
    amountCents: Int!
    formattedPrice: String!   # e.g. "CAD $80/mo"
  }

  type TierInfo {
    key: SubscriptionTier!
    name: String!
    athleteLimit: Int!
    advancedAnalytics: Boolean!
    advancedReporting: Boolean!
    aiAtRiskDetection: Boolean!
    pricing: [TierPricing!]!
  }

  type OrgSubscription {
    tier: SubscriptionTier!
    status: SubscriptionStatus!
    billingPeriod: BillingPeriod!
    billingCurrency: String!
    athleteLimit: Int!
    athleteCount: Int!
    currentPeriodEnd: String
    trialEndsAt: String
    stripeCustomerId: String
    stripeSubscriptionId: String
  }

  type SubscriptionCheckoutResult {
    checkoutUrl: String!
  }

  # Returned by changeSubscriptionTier.
  # checkoutUrl is set when the org has no active Stripe subscription yet
  # (e.g. checkout was never completed) — frontend should redirect there.
  # subscription is set when the tier was updated in place.
  type SubscriptionChangeResult {
    checkoutUrl: String
    subscription: OrgSubscription
  }

  # ---- Queries ----
  extend type Query {
    # All available tiers with pricing for the given currency (default: usd)
    subscriptionTiers(currency: String): [TierInfo!]!
    # Current subscription state for an org (admin only)
    orgSubscription(organizationId: ID!): OrgSubscription!
  }

  # ---- Mutations ----
  extend type Mutation {
    # Creates a Stripe Checkout Session for a new subscription; returns the hosted URL.
    createOrgSubscription(
      organizationId: ID!
      tier: SubscriptionTier!
      currency: String!
      billingPeriod: BillingPeriod
    ): SubscriptionCheckoutResult!

    # Changes tier (upgrade or downgrade) on the existing subscription.
    # If no Stripe subscription exists yet, returns a checkoutUrl to complete setup.
    changeSubscriptionTier(
      organizationId: ID!
      newTier: SubscriptionTier!
    ): SubscriptionChangeResult!

    # Cancels the subscription at period end.
    cancelSubscription(organizationId: ID!): OrgSubscription!

    # Renews a canceled subscription.
    # If a Stripe subscription exists it is reactivated (cancel_at_period_end → false);
    # tier and currency are ignored in that case.
    # If no Stripe subscription exists (e.g. trial canceled) a new Checkout session
    # is created for the given tier/currency and checkoutUrl is returned.
    renewSubscription(
      organizationId: ID!
      tier: SubscriptionTier
      currency: String
    ): SubscriptionChangeResult!
  }
`;
