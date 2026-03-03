import Stripe from "stripe";
import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireAuth, requireOrgAdmin } from "../../utils/permissions.js";
import {
  TIER_CONFIG,
  getStripePriceId,
  normalizeCurrency,
  isTierUpgrade,
  type SubscriptionTierKey,
  type BillingCurrency,
} from "../../utils/subscriptions.js";
import { logger } from "../../utils/logger.js";

const stripeClient = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" })
  : null;

const TRIAL_DAYS = 14;

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatPrice(amountCents: number, currency: BillingCurrency): string {
  const dollars = (amountCents / 100).toFixed(0);
  const symbol = currency === "cad" ? "CAD $" : "USD $";
  return `${symbol}${dollars}/mo`;
}

function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function getOrgOrThrow(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("Organization not found");
  return org;
}

async function getAthleteCount(organizationId: string): Promise<number> {
  return prisma.organizationMember.count({
    where: { organizationId, role: "ATHLETE" },
  });
}

function buildOrgSubscriptionPayload(
  org: {
    subscriptionTier: string;
    subscriptionStatus: string;
    billingPeriod: string;
    billingCurrency: string;
    athleteLimit: number;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  },
  athleteCount: number
) {
  return {
    tier: org.subscriptionTier,
    status: org.subscriptionStatus,
    billingPeriod: org.billingPeriod,
    billingCurrency: org.billingCurrency,
    athleteLimit: org.athleteLimit,
    athleteCount,
    currentPeriodEnd: toISO(org.currentPeriodEnd),
    trialEndsAt: toISO(org.trialEndsAt),
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
  };
}

// ─── resolvers ────────────────────────────────────────────────────────────────

export const subscriptionsResolvers = {
  Query: {
    subscriptionTiers: (
      _: unknown,
      { currency }: { currency?: string }
    ) => {
      const cur = normalizeCurrency(currency);
      return Object.values(TIER_CONFIG).map((tier) => ({
        key: tier.key,
        name: tier.name,
        athleteLimit: tier.athleteLimit,
        advancedAnalytics: tier.features.advancedAnalytics,
        advancedReporting: tier.features.advancedReporting,
        aiAtRiskDetection: tier.features.aiAtRiskDetection,
        pricing: [
          {
            currency: cur.toUpperCase(),
            amountCents: tier.pricing[cur].amountCents,
            formattedPrice: formatPrice(tier.pricing[cur].amountCents, cur),
          },
        ],
      }));
    },

    orgSubscription: async (
      _: unknown,
      { organizationId }: { organizationId: string },
      context: { userId?: string }
    ) => {
      await requireOrgAdmin(context, organizationId);
      const org = await getOrgOrThrow(organizationId);
      const athleteCount = await getAthleteCount(organizationId);
      return buildOrgSubscriptionPayload(org, athleteCount);
    },
  },

  Mutation: {
    createOrgSubscription: async (
      _: unknown,
      {
        organizationId,
        tier,
        currency,
        billingPeriod = "MONTHLY",
      }: {
        organizationId: string;
        tier: SubscriptionTierKey;
        currency: string;
        billingPeriod?: "MONTHLY" | "ANNUAL";
      },
      context: { userId?: string }
    ) => {
      await requireOrgAdmin(context, organizationId);

      if (!stripeClient) throw new Error("Stripe is not configured");

      const cur = normalizeCurrency(currency);
      const priceId = getStripePriceId(tier, cur);
      if (!priceId) {
        throw new Error(
          `Stripe price not configured for tier ${tier} / currency ${cur}. ` +
            `Set the ${TIER_CONFIG[tier].pricing[cur].stripePriceIdEnvVar} env var.`
        );
      }

      const org = await getOrgOrThrow(organizationId);

      // Ensure or create a Stripe Customer for this org.
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeClient.customers.create({
          name: org.name,
          metadata: { organizationId },
        });
        customerId = customer.id;
        await prisma.organization.update({
          where: { id: organizationId },
          data: { stripeCustomerId: customerId },
        });
      }

      // Create a Stripe Checkout Session for the subscription.
      const appUrl = process.env.APP_URL ?? "https://app.athletiq.fitness";
      const session = await stripeClient.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: TRIAL_DAYS,
          metadata: { organizationId, tier, currency: cur, billingPeriod },
        },
        success_url: `${appUrl}/dashboard?subscription=success`,
        cancel_url: `${appUrl}/register?subscription=cancel`,
        currency: cur,
      });

      logger.info({ organizationId, tier, currency: cur }, "Stripe Checkout session created");

      return { checkoutUrl: session.url! };
    },

    changeSubscriptionTier: async (
      _: unknown,
      { organizationId, newTier }: { organizationId: string; newTier: SubscriptionTierKey },
      context: { userId?: string }
    ) => {
      await requireOrgAdmin(context, organizationId);
      if (!stripeClient) throw new Error("Stripe is not configured");

      const org = await getOrgOrThrow(organizationId);

      // No active Stripe subscription yet (checkout was never completed).
      // Create a new Checkout session for the requested tier and return the URL.
      if (!org.stripeSubscriptionId) {
        const cur = normalizeCurrency(org.billingCurrency);
        const priceId = getStripePriceId(newTier, cur);
        if (!priceId) throw new Error(`Price not configured for ${newTier}/${cur}`);

        let customerId = org.stripeCustomerId;
        if (!customerId) {
          const customer = await stripeClient.customers.create({
            name: org.name,
            metadata: { organizationId },
          });
          customerId = customer.id;
          await prisma.organization.update({
            where: { id: organizationId },
            data: { stripeCustomerId: customerId },
          });
        }

        const appUrl = process.env.APP_URL ?? "https://app.athletiq.fitness";
        const session = await stripeClient.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: {
            trial_period_days: TRIAL_DAYS,
            metadata: { organizationId, tier: newTier, currency: cur, billingPeriod: org.billingPeriod },
          },
          success_url: `${appUrl}/settings?subscription=success`,
          cancel_url: `${appUrl}/settings?subscription=cancel`,
          currency: cur,
        });

        // Pre-update the tier in DB so the UI reflects the chosen plan.
        await prisma.organization.update({
          where: { id: organizationId },
          data: { subscriptionTier: newTier, athleteLimit: TIER_CONFIG[newTier].athleteLimit },
        });

        logger.info({ organizationId, newTier }, "changeSubscriptionTier: no sub found — redirecting to checkout");
        return { checkoutUrl: session.url! };
      }

      const cur = normalizeCurrency(org.billingCurrency);
      const newPriceId = getStripePriceId(newTier, cur);
      if (!newPriceId) throw new Error(`Price not configured for ${newTier}/${cur}`);

      const sub = await stripeClient.subscriptions.retrieve(org.stripeSubscriptionId);
      const itemId = sub.items.data[0]?.id;
      if (!itemId) throw new Error("Subscription has no line items");

      const isUpgrade = isTierUpgrade(org.subscriptionTier as SubscriptionTierKey, newTier);

      // Upgrades: prorate immediately. Downgrades: apply at period end.
      await stripeClient.subscriptions.update(org.stripeSubscriptionId, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: isUpgrade ? "create_prorations" : "none",
        billing_cycle_anchor: isUpgrade ? "now" : "unchanged",
      });

      const updatedOrg = await prisma.organization.update({
        where: { id: organizationId },
        data: {
          subscriptionTier: newTier,
          athleteLimit: TIER_CONFIG[newTier].athleteLimit,
        },
      });

      const athleteCount = await getAthleteCount(organizationId);
      logger.info({ organizationId, from: org.subscriptionTier, to: newTier }, "Subscription tier changed");
      return { subscription: buildOrgSubscriptionPayload(updatedOrg, athleteCount) };
    },

    cancelSubscription: async (
      _: unknown,
      { organizationId }: { organizationId: string },
      context: { userId?: string }
    ) => {
      await requireOrgAdmin(context, organizationId);
      if (!stripeClient) throw new Error("Stripe is not configured");

      const org = await getOrgOrThrow(organizationId);
      if (!org.stripeSubscriptionId) throw new Error("No active subscription found");

      await stripeClient.subscriptions.update(org.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      logger.info({ organizationId }, "Subscription set to cancel at period end");

      const athleteCount = await getAthleteCount(organizationId);
      return buildOrgSubscriptionPayload(org, athleteCount);
    },
  },
};

// ─── Stripe webhook handlers ───────────────────────────────────────────────────

/**
 * Handles Stripe subscription lifecycle events.
 * Call this from the main webhook route handler (Backend/src/index.ts).
 */
export async function handleSubscriptionWebhook(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return false;

      const sub = await stripeClient!.subscriptions.retrieve(
        session.subscription as string
      );
      const meta = sub.metadata as Record<string, string>;
      const organizationId = meta.organizationId ?? session.metadata?.organizationId;
      const tier = (meta.tier as SubscriptionTierKey) ?? "STARTER";
      const currency = normalizeCurrency(meta.currency);

      if (!organizationId) {
        logger.warn({ sessionId: session.id }, "checkout.session.completed missing organizationId");
        return false;
      }

      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          subscriptionTier: tier,
          subscriptionStatus: sub.status === "trialing" ? "TRIALING" : "ACTIVE",
          billingCurrency: currency,
          stripeSubscriptionId: sub.id,
          stripeCustomerId: sub.customer as string,
          athleteLimit: TIER_CONFIG[tier].athleteLimit,
          currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
          trialEndsAt: (sub as any).trial_end ? new Date((sub as any).trial_end * 1000) : null,
        },
      });
      logger.info({ organizationId, tier }, "Subscription activated via checkout");
      return true;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as any;
      const org = await prisma.organization.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!org) return false;

      const statusMap: Record<string, SubscriptionStatus> = {
        active: SubscriptionStatus.ACTIVE,
        trialing: SubscriptionStatus.TRIALING,
        past_due: SubscriptionStatus.PAST_DUE,
        canceled: SubscriptionStatus.CANCELED,
        unpaid: SubscriptionStatus.PAST_DUE,
      };

      await prisma.organization.update({
        where: { id: org.id },
        data: {
          subscriptionStatus: statusMap[sub.status] ?? SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        },
      });
      logger.info({ organizationId: org.id, status: sub.status }, "Subscription updated");
      return true;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const org = await prisma.organization.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!org) return false;

      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: "CANCELED" },
      });
      logger.info({ organizationId: org.id }, "Subscription canceled");
      return true;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as any;
      const subId: string | undefined =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : (invoice.subscription as any)?.id;
      if (!subId) return false;

      const org = await prisma.organization.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      if (!org) return false;

      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: "PAST_DUE" },
      });
      logger.warn({ organizationId: org.id }, "Subscription payment failed — marked PAST_DUE");
      return true;
    }

    case "invoice.paid": {
      const invoice = event.data.object as any;
      const subId: string | undefined =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : (invoice.subscription as any)?.id;
      if (!subId) return false;

      const org = await prisma.organization.findFirst({
        where: { stripeSubscriptionId: subId },
      });
      if (!org) return false;

      await prisma.organization.update({
        where: { id: org.id },
        data: { subscriptionStatus: "ACTIVE" },
      });
      logger.info({ organizationId: org.id }, "Subscription invoice paid — marked ACTIVE");
      return true;
    }

    default:
      return false;
  }
}
