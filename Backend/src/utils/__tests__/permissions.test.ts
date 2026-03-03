import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphQLError } from "graphql";

// Mock the prisma client before importing permissions
vi.mock("../../db.js", () => ({
  prisma: {
    organizationMember: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireOrgRole, requireOrgAdmin, requireOrgOwner, requireCoachOrAbove, hasOrgPermission, requireActiveSubscription, requireTierFeature, enforceAthleteLimit } from "../permissions.js";
import { prisma } from "../../db.js";

const mockFindUnique = vi.mocked(prisma.organizationMember.findUnique);
const mockOrgFindUnique = vi.mocked(prisma.organization.findUnique);
const mockMemberCount = vi.mocked(prisma.organizationMember.count);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------
describe("requireAuth", () => {
  it("returns the userId when present", () => {
    const ctx = { userId: "user-123" };
    expect(requireAuth(ctx)).toBe("user-123");
  });

  it("throws UNAUTHENTICATED when userId is missing", () => {
    const ctx = {};
    expect(() => requireAuth(ctx)).toThrowError(
      expect.objectContaining({
        extensions: expect.objectContaining({ code: "UNAUTHENTICATED" }),
      })
    );
  });

  it("throws UNAUTHENTICATED when userId is undefined", () => {
    const ctx = { userId: undefined };
    expect(() => requireAuth(ctx)).toThrow(GraphQLError);
  });
});

// ---------------------------------------------------------------------------
// requireOrgRole
// ---------------------------------------------------------------------------
describe("requireOrgRole", () => {
  it("returns the userId when the member has an allowed role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ADMIN" } as any);
    const result = await requireOrgRole({ userId: "user-1" }, "org-1", ["OWNER", "ADMIN"] as any[]);
    expect(result).toBe("user-1");
  });

  it("throws FORBIDDEN when the member has a non-allowed role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ATHLETE" } as any);
    await expect(
      requireOrgRole({ userId: "user-1" }, "org-1", ["OWNER", "ADMIN"] as any[])
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
  });

  it("throws FORBIDDEN when the member is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      requireOrgRole({ userId: "user-1" }, "org-1", ["OWNER"] as any[])
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
  });

  it("throws UNAUTHENTICATED when no userId in context", async () => {
    await expect(
      requireOrgRole({}, "org-1", ["OWNER"] as any[])
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "UNAUTHENTICATED" }) })
    );
    // Should not hit the DB if unauthenticated
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireOrgAdmin (OWNER | ADMIN)
// ---------------------------------------------------------------------------
describe("requireOrgAdmin", () => {
  it("passes for OWNER role", async () => {
    mockFindUnique.mockResolvedValue({ role: "OWNER" } as any);
    await expect(requireOrgAdmin({ userId: "u1" }, "org-1")).resolves.toBe("u1");
  });

  it("passes for ADMIN role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ADMIN" } as any);
    await expect(requireOrgAdmin({ userId: "u1" }, "org-1")).resolves.toBe("u1");
  });

  it("blocks COACH role", async () => {
    mockFindUnique.mockResolvedValue({ role: "COACH" } as any);
    await expect(requireOrgAdmin({ userId: "u1" }, "org-1")).rejects.toThrow(GraphQLError);
  });

  it("blocks ATHLETE role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ATHLETE" } as any);
    await expect(requireOrgAdmin({ userId: "u1" }, "org-1")).rejects.toThrow(GraphQLError);
  });
});

// ---------------------------------------------------------------------------
// requireOrgOwner (OWNER only)
// ---------------------------------------------------------------------------
describe("requireOrgOwner", () => {
  it("passes for OWNER role", async () => {
    mockFindUnique.mockResolvedValue({ role: "OWNER" } as any);
    await expect(requireOrgOwner({ userId: "u1" }, "org-1")).resolves.toBe("u1");
  });

  it("blocks ADMIN role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ADMIN" } as any);
    await expect(requireOrgOwner({ userId: "u1" }, "org-1")).rejects.toThrow(GraphQLError);
  });
});

// ---------------------------------------------------------------------------
// requireCoachOrAbove (OWNER | ADMIN | MANAGER | COACH)
// ---------------------------------------------------------------------------
describe("requireCoachOrAbove", () => {
  it.each(["OWNER", "ADMIN", "MANAGER", "COACH"] as const)(
    "passes for %s role",
    async (role) => {
      mockFindUnique.mockResolvedValue({ role } as any);
      await expect(requireCoachOrAbove({ userId: "u1" }, "org-1")).resolves.toBe("u1");
    }
  );

  it("blocks ATHLETE role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ATHLETE" } as any);
    await expect(requireCoachOrAbove({ userId: "u1" }, "org-1")).rejects.toThrow(GraphQLError);
  });

  it("blocks GUARDIAN role", async () => {
    mockFindUnique.mockResolvedValue({ role: "GUARDIAN" } as any);
    await expect(requireCoachOrAbove({ userId: "u1" }, "org-1")).rejects.toThrow(GraphQLError);
  });
});

// ---------------------------------------------------------------------------
// hasOrgPermission
// ---------------------------------------------------------------------------
describe("hasOrgPermission", () => {
  it("returns false when member is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await hasOrgPermission({ userId: "u1" }, "org-1", "canEditEvents");
    expect(result).toBe(false);
  });

  it("throws UNAUTHENTICATED when no userId in context", async () => {
    await expect(
      hasOrgPermission({}, "org-1", "canEditEvents")
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "UNAUTHENTICATED" }) })
    );
  });

  describe("custom role path", () => {
    it("returns the customRole flag value when customRole is set", async () => {
      mockFindUnique.mockResolvedValue({
        role: "ATHLETE",
        customRole: {
          canEditEvents: true,
          canApproveExcuses: false,
          canViewAnalytics: true,
          canManageMembers: false,
          canManageTeams: true,
          canManagePayments: false,
        },
      } as any);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canEditEvents")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canApproveExcuses")).toBe(false);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canManageTeams")).toBe(true);
    });
  });

  describe("built-in role fallback", () => {
    it("OWNER has all permissions", async () => {
      mockFindUnique.mockResolvedValue({ role: "OWNER", customRole: null } as any);
      for (const action of ["canEditEvents", "canApproveExcuses", "canViewAnalytics", "canManageMembers", "canManageTeams", "canManagePayments"] as const) {
        expect(await hasOrgPermission({ userId: "u1" }, "org-1", action)).toBe(true);
      }
    });

    it("ADMIN has all permissions", async () => {
      mockFindUnique.mockResolvedValue({ role: "ADMIN", customRole: null } as any);
      for (const action of ["canEditEvents", "canApproveExcuses", "canViewAnalytics", "canManageMembers", "canManageTeams", "canManagePayments"] as const) {
        expect(await hasOrgPermission({ userId: "u1" }, "org-1", action)).toBe(true);
      }
    });

    it("MANAGER cannot manage payments", async () => {
      mockFindUnique.mockResolvedValue({ role: "MANAGER", customRole: null } as any);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canManagePayments")).toBe(false);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canEditEvents")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canManageMembers")).toBe(true);
    });

    it("COACH can edit events, approve excuses, and view analytics only", async () => {
      mockFindUnique.mockResolvedValue({ role: "COACH", customRole: null } as any);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canEditEvents")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canApproveExcuses")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canViewAnalytics")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canManageMembers")).toBe(false);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canManagePayments")).toBe(false);
    });

    it("ATHLETE can only view analytics", async () => {
      mockFindUnique.mockResolvedValue({ role: "ATHLETE", customRole: null } as any);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canViewAnalytics")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canEditEvents")).toBe(false);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canManageMembers")).toBe(false);
    });

    it("GUARDIAN can only view analytics", async () => {
      mockFindUnique.mockResolvedValue({ role: "GUARDIAN", customRole: null } as any);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canViewAnalytics")).toBe(true);
      expect(await hasOrgPermission({ userId: "u1" }, "org-1", "canEditEvents")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// requireActiveSubscription
// ---------------------------------------------------------------------------
describe("requireActiveSubscription", () => {
  it("resolves without error for ACTIVE status", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionStatus: "ACTIVE" } as any);
    await expect(requireActiveSubscription("org-1")).resolves.toBeUndefined();
  });

  it("resolves without error for TRIALING status", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionStatus: "TRIALING" } as any);
    await expect(requireActiveSubscription("org-1")).resolves.toBeUndefined();
  });

  it("resolves without error for PAST_DUE status", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionStatus: "PAST_DUE" } as any);
    await expect(requireActiveSubscription("org-1")).resolves.toBeUndefined();
  });

  it("throws SUBSCRIPTION_CANCELED for CANCELED status", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionStatus: "CANCELED" } as any);
    await expect(requireActiveSubscription("org-1")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "SUBSCRIPTION_CANCELED" }) })
    );
  });

  it("throws NOT_FOUND when org does not exist", async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    await expect(requireActiveSubscription("org-missing")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "NOT_FOUND" }) })
    );
  });
});

// ---------------------------------------------------------------------------
// requireTierFeature
// ---------------------------------------------------------------------------
describe("requireTierFeature", () => {
  it("resolves when GROWTH tier has advancedAnalytics", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "GROWTH" } as any);
    await expect(requireTierFeature("org-1", "advancedAnalytics")).resolves.toBeUndefined();
  });

  it("resolves when PRO tier has advancedReporting", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "PRO" } as any);
    await expect(requireTierFeature("org-1", "advancedReporting")).resolves.toBeUndefined();
  });

  it("throws SUBSCRIPTION_TIER_REQUIRED when STARTER tier lacks advancedAnalytics", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "STARTER" } as any);
    await expect(requireTierFeature("org-1", "advancedAnalytics")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "SUBSCRIPTION_TIER_REQUIRED" }) })
    );
  });

  it("throws SUBSCRIPTION_TIER_REQUIRED when GROWTH tier lacks advancedReporting", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "GROWTH" } as any);
    await expect(requireTierFeature("org-1", "advancedReporting")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "SUBSCRIPTION_TIER_REQUIRED" }) })
    );
  });

  it("throws NOT_FOUND when org does not exist", async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    await expect(requireTierFeature("org-missing", "advancedAnalytics")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "NOT_FOUND" }) })
    );
  });
});

// ---------------------------------------------------------------------------
// enforceAthleteLimit
// ---------------------------------------------------------------------------
describe("enforceAthleteLimit", () => {
  it("resolves when current athlete count is below the tier limit", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "STARTER" } as any); // limit = 75
    mockMemberCount.mockResolvedValue(74 as any);
    await expect(enforceAthleteLimit("org-1")).resolves.toBeUndefined();
  });

  it("throws ATHLETE_LIMIT_REACHED when at the limit", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "STARTER" } as any); // limit = 75
    mockMemberCount.mockResolvedValue(75 as any);
    await expect(enforceAthleteLimit("org-1")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "ATHLETE_LIMIT_REACHED" }) })
    );
  });

  it("throws ATHLETE_LIMIT_REACHED when above the limit", async () => {
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "GROWTH" } as any); // limit = 200
    mockMemberCount.mockResolvedValue(201 as any);
    await expect(enforceAthleteLimit("org-1")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "ATHLETE_LIMIT_REACHED" }) })
    );
  });

  it("throws NOT_FOUND when org does not exist", async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    await expect(enforceAthleteLimit("org-missing")).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "NOT_FOUND" }) })
    );
  });
});
