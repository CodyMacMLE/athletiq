import { GraphQLError } from "graphql";
import { OrgRole } from "@prisma/client";
import { prisma } from "../db.js";
import { tierHasFeature, getAthleteLimit, type SubscriptionTierKey, type TierConfig } from "./subscriptions.js";

export type OrgPermissionAction =
  | "canEditEvents"
  | "canApproveExcuses"
  | "canViewAnalytics"
  | "canManageMembers"
  | "canManageTeams"
  | "canManagePayments";

interface Context {
  userId?: string;
}

/** Throws UNAUTHENTICATED if no userId in context; returns the userId. */
export function requireAuth(context: Context): string {
  if (!context.userId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return context.userId;
}

/** Throws FORBIDDEN if the caller doesn't have one of the allowed roles in the org. */
export async function requireOrgRole(
  context: Context,
  organizationId: string,
  allowedRoles: OrgRole[]
): Promise<string> {
  const userId = requireAuth(context);
  const member = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  if (!member || !allowedRoles.includes(member.role)) {
    throw new GraphQLError("Insufficient permissions", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return userId;
}

/** Owner or Admin only. */
export async function requireOrgAdmin(
  context: Context,
  organizationId: string
): Promise<string> {
  return requireOrgRole(context, organizationId, [OrgRole.OWNER, OrgRole.ADMIN]);
}

/** Owner, Admin, Manager, or Coach. */
export async function requireCoachOrAbove(
  context: Context,
  organizationId: string
): Promise<string> {
  return requireOrgRole(context, organizationId, [
    OrgRole.OWNER,
    OrgRole.ADMIN,
    OrgRole.MANAGER,
    OrgRole.COACH,
  ]);
}

/** Owner only. */
export async function requireOrgOwner(
  context: Context,
  organizationId: string
): Promise<string> {
  return requireOrgRole(context, organizationId, [OrgRole.OWNER]);
}

/**
 * Throws SUBSCRIPTION_CANCELED if the org's subscription is canceled.
 * Call before any mutation that should be blocked for canceled orgs.
 */
export async function requireActiveSubscription(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionStatus: true },
  });
  if (!org) {
    throw new GraphQLError("Organization not found", { extensions: { code: "NOT_FOUND" } });
  }
  if (org.subscriptionStatus === "CANCELED") {
    throw new GraphQLError(
      "Your subscription has been canceled. Please renew to continue.",
      { extensions: { code: "SUBSCRIPTION_CANCELED" } }
    );
  }
}

/**
 * Throws SUBSCRIPTION_TIER_REQUIRED if the org's current tier does not include `feature`.
 * Call at the top of queries/mutations gated behind a tier.
 */
export async function requireTierFeature(
  organizationId: string,
  feature: keyof TierConfig["features"]
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionTier: true },
  });
  if (!org) {
    throw new GraphQLError("Organization not found", { extensions: { code: "NOT_FOUND" } });
  }
  if (!tierHasFeature(org.subscriptionTier as SubscriptionTierKey, feature)) {
    throw new GraphQLError(
      "This feature requires a higher subscription tier. Please upgrade your plan.",
      { extensions: { code: "SUBSCRIPTION_TIER_REQUIRED" } }
    );
  }
}

/**
 * Throws ATHLETE_LIMIT_REACHED if the org is at or above its plan's athlete limit.
 * Call before adding a new ATHLETE member to an org.
 */
export async function enforceAthleteLimit(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionTier: true },
  });
  if (!org) {
    throw new GraphQLError("Organization not found", { extensions: { code: "NOT_FOUND" } });
  }
  const limit = getAthleteLimit(org.subscriptionTier as SubscriptionTierKey);
  const currentCount = await prisma.organizationMember.count({
    where: { organizationId, role: "ATHLETE" },
  });
  if (currentCount >= limit) {
    throw new GraphQLError(
      `Athlete limit reached (${currentCount}/${limit}). Upgrade your plan to add more athletes.`,
      { extensions: { code: "ATHLETE_LIMIT_REACHED" } }
    );
  }
}

/**
 * Returns true if the calling user has the given permission in the org.
 * Checks customRole first; falls back to built-in role defaults.
 */
export async function hasOrgPermission(
  context: Context,
  organizationId: string,
  action: OrgPermissionAction
): Promise<boolean> {
  const userId = requireAuth(context);
  const member = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: {
      role: true,
      customRole: {
        select: {
          canEditEvents: true,
          canApproveExcuses: true,
          canViewAnalytics: true,
          canManageMembers: true,
          canManageTeams: true,
          canManagePayments: true,
        },
      },
    },
  });

  if (!member) return false;

  // If the member has a custom role, use its flags
  if (member.customRole) {
    return member.customRole[action];
  }

  // Fall back to built-in role defaults
  switch (member.role) {
    case OrgRole.OWNER:
    case OrgRole.ADMIN:
      return true;
    case OrgRole.MANAGER:
      return action !== "canManagePayments";
    case OrgRole.COACH:
      return action === "canEditEvents" || action === "canApproveExcuses" || action === "canViewAnalytics";
    default:
      // ATHLETE, GUARDIAN
      return action === "canViewAnalytics";
  }
}
