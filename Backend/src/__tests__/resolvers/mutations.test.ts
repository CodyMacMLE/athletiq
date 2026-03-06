/**
 * Integration tests for GraphQL Mutation resolvers.
 * Prisma and external services are fully mocked — no DB or network required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock all external dependencies ─────────────────────────────────────────
vi.mock("../../db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    organization: { create: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    organizationMember: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    team: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    teamMember: { findMany: vi.fn(), deleteMany: vi.fn() },
    checkIn: { deleteMany: vi.fn() },
    event: { findMany: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    customRole: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    teamChallenge: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    athleteRecognition: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), delete: vi.fn() },
    invoice: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    payment: { create: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((fn: (tx: any) => Promise<any>) => fn({
      invoice: { findUnique: vi.fn(), update: vi.fn() },
      payment: { create: vi.fn(), findFirst: vi.fn() },
    })),
  },
}));

vi.mock("../../email.js", () => ({
  sendInviteEmail: vi.fn(),
  sendFeedbackEmail: vi.fn(),
  sendInvoiceEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminderEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../s3.js", () => ({ generateProfilePictureUploadUrl: vi.fn() }));
vi.mock("../../utils/time.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/time.js")>();
  return { ...actual, parseTimeString: vi.fn() };
});
vi.mock("../../services/markAbsent.js", () => ({ markAbsentForEndedEvents: vi.fn() }));
vi.mock("../../notifications/sns.js", () => ({ registerPushToken: vi.fn(), sendPushToEndpoint: vi.fn() }));
vi.mock("../../notifications/pushNotifications.js", () => ({ sendPushNotification: vi.fn() }));
vi.mock("../../notifications/announcements.js", () => ({ broadcastAnnouncement: vi.fn() }));
vi.mock("../../notifications/emailReports.js", () => ({ generateGuardianReport: vi.fn() }));
vi.mock("../../notifications/emailNotifications.js", () => ({ sendExcuseStatusEmail: vi.fn() }));
vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class { send = vi.fn(); },
  AdminDeleteUserCommand: vi.fn(),
  ListUsersCommand: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { create: vi.fn() };
    webhooks = { constructEvent: vi.fn() };
    accounts = { create: vi.fn(), createLoginLink: vi.fn() };
    accountLinks = { create: vi.fn() };
    oauth = { deauthorize: vi.fn() };
  },
}));

import { resolvers } from "../../resolvers/index.js";
import { prisma } from "../../db.js";

// ─── Typed mocks ─────────────────────────────────────────────────────────────
const mockOrgCreate = vi.mocked(prisma.organization.create);
const mockOrgMemberCreate = vi.mocked(prisma.organizationMember.create);
const mockOrgMemberFindUnique = vi.mocked(prisma.organizationMember.findUnique);
const mockOrgMemberUpdate = vi.mocked(prisma.organizationMember.update);
const mockOrgFindUnique = vi.mocked(prisma.organization.findUnique);
const mockOrgFindUniqueOrThrow = vi.mocked(prisma.organization.findUniqueOrThrow);
const mockOrgDelete = vi.mocked(prisma.organization.delete);
const mockAuditCreate = vi.mocked(prisma.auditLog.create);
const mockUserUpdate = vi.mocked(prisma.user.update);
const mockCustomRoleCreate = vi.mocked(prisma.customRole.create);
const mockCustomRoleFindUnique = vi.mocked(prisma.customRole.findUnique);
const mockTeamChallengeCreate = vi.mocked(prisma.teamChallenge.create);
const mockAthleteRecognitionCreate = vi.mocked(prisma.athleteRecognition.create);
const mockAthleteRecognitionDeleteMany = vi.mocked(prisma.athleteRecognition.deleteMany);
const mockInvoiceCreate = vi.mocked(prisma.invoice.create);
const mockInvoiceFindUniqueOrThrow = vi.mocked(prisma.invoice.findUniqueOrThrow);
const mockInvoiceUpdate = vi.mocked(prisma.invoice.update);

const makeContext = (userId?: string) => ({
  userId,
  loaders: {
    user: { load: vi.fn() },
    team: { load: vi.fn() },
    organization: { load: vi.fn() },
    venue: { load: vi.fn() },
    event: { load: vi.fn() },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createOrganization ───────────────────────────────────────────────────────
describe("Mutation.createOrganization", () => {
  it("creates an org and makes the caller the OWNER", async () => {
    const org = { id: "org-new", name: "New Org" };
    mockOrgCreate.mockResolvedValue(org as any);
    mockOrgMemberCreate.mockResolvedValue({} as any);

    const result = await resolvers.Mutation.createOrganization(
      null,
      { input: { name: "New Org" } },
      makeContext("user-1")
    );

    expect(mockOrgCreate).toHaveBeenCalledWith({ data: { name: "New Org" } });
    expect(mockOrgMemberCreate).toHaveBeenCalledWith({
      data: { userId: "user-1", organizationId: "org-new", role: "OWNER" },
    });
    expect(result).toEqual(org);
  });

  it("throws when unauthenticated", async () => {
    await expect(
      resolvers.Mutation.createOrganization(null, { input: { name: "X" } }, makeContext())
    ).rejects.toThrow("Authentication required");

    expect(mockOrgCreate).not.toHaveBeenCalled();
  });
});

// ─── updateUser ──────────────────────────────────────────────────────────────
describe("Mutation.updateUser", () => {
  it("updates allowed user fields", async () => {
    const updated = { id: "u1", firstName: "Jane", lastName: "Doe" };
    mockUserUpdate.mockResolvedValue(updated as any);

    const result = await resolvers.Mutation.updateUser(
      null,
      { id: "u1", input: { firstName: "Jane", lastName: "Doe" } }
    );

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({ firstName: "Jane", lastName: "Doe" }),
    });
    expect(result).toEqual(updated);
  });

  it("strips non-digit characters from phone numbers", async () => {
    const updated = { id: "u1", phone: "6135550123" };
    mockUserUpdate.mockResolvedValue(updated as any);

    await resolvers.Mutation.updateUser(
      null,
      { id: "u1", input: { phone: "(613) 555-0123" } }
    );

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: "6135550123" }),
      })
    );
  });

  it("converts dateOfBirth string to a Date object", async () => {
    mockUserUpdate.mockResolvedValue({} as any);

    await resolvers.Mutation.updateUser(
      null,
      { id: "u1", input: { dateOfBirth: "1990-06-15" } }
    );

    const callArg = mockUserUpdate.mock.calls[0][0];
    expect(callArg.data.dateOfBirth).toBeInstanceOf(Date);
    expect((callArg.data.dateOfBirth as Date).getFullYear()).toBe(1990);
  });

  it("sets dateOfBirth to null when empty string provided", async () => {
    mockUserUpdate.mockResolvedValue({} as any);

    await resolvers.Mutation.updateUser(
      null,
      { id: "u1", input: { dateOfBirth: "" } }
    );

    const callArg = mockUserUpdate.mock.calls[0][0];
    expect(callArg.data.dateOfBirth).toBeNull();
  });
});

// ─── deleteOrganization ───────────────────────────────────────────────────────
describe("Mutation.deleteOrganization", () => {
  it("requires OWNER role — throws FORBIDDEN for ADMIN", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "ADMIN" } as any);

    await expect(
      resolvers.Mutation.deleteOrganization(
        null,
        { id: "org-1" },
        makeContext("user-1")
      )
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );

    expect(mockOrgDelete).not.toHaveBeenCalled();
  });

  it("deletes the org and writes an audit log when caller is OWNER", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "OWNER" } as any);
    mockOrgFindUniqueOrThrow.mockResolvedValue({
      id: "org-1",
      name: "Old Org",
      subscriptionStatus: "CANCELED",
      stripeSubscriptionId: null,
    } as any);
    mockAuditCreate.mockResolvedValue({} as any);

    // Provide a tx with all the deleteMany/delete stubs the resolver needs
    const txOrgDelete = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      await fn({
        checkIn: { deleteMany: vi.fn() },
        excuseRequest: { deleteMany: vi.fn() },
        eventRsvp: { deleteMany: vi.fn() },
        event: { deleteMany: vi.fn() },
        recurringEvent: { deleteMany: vi.fn() },
        teamMember: { deleteMany: vi.fn() },
        teamChallenge: { deleteMany: vi.fn() },
        athleteRecognition: { deleteMany: vi.fn() },
        team: { deleteMany: vi.fn() },
        orgSeason: { deleteMany: vi.fn() },
        organizationMember: { deleteMany: vi.fn() },
        customRole: { deleteMany: vi.fn() },
        notificationDelivery: { deleteMany: vi.fn() },
        announcement: { deleteMany: vi.fn() },
        invite: { deleteMany: vi.fn() },
        nfcTag: { deleteMany: vi.fn() },
        guardianLink: { deleteMany: vi.fn() },
        medicalInfo: { deleteMany: vi.fn() },
        emergencyContact: { deleteMany: vi.fn() },
        earnedBadge: { deleteMany: vi.fn() },
        payment: { deleteMany: vi.fn() },
        invoice: { deleteMany: vi.fn() },
        venue: { deleteMany: vi.fn() },
        organization: { delete: txOrgDelete },
      });
    });

    const result = await resolvers.Mutation.deleteOrganization(
      null,
      { id: "org-1" },
      makeContext("owner-1")
    );

    expect(txOrgDelete).toHaveBeenCalledWith({ where: { id: "org-1" } });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DELETE_ORGANIZATION",
          actorId: "owner-1",
          targetId: "org-1",
        }),
      })
    );
    expect(result).toBe(true);
  });

  it("throws if subscription is ACTIVE", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "OWNER" } as any);
    mockOrgFindUniqueOrThrow.mockResolvedValue({
      id: "org-1",
      name: "Old Org",
      subscriptionStatus: "ACTIVE",
      stripeSubscriptionId: null,
    } as any);

    await expect(
      resolvers.Mutation.deleteOrganization(null, { id: "org-1" }, makeContext("owner-1"))
    ).rejects.toThrow("You must cancel your subscription before deleting this organization.");
  });

  it("throws UNAUTHENTICATED when no user in context", async () => {
    await expect(
      resolvers.Mutation.deleteOrganization(null, { id: "org-1" }, makeContext())
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "UNAUTHENTICATED" }) })
    );
  });
});

// ─── createCustomRole ─────────────────────────────────────────────────────────
describe("Mutation.createCustomRole", () => {
  it("creates a custom role when called by an admin", async () => {
    // requireOrgAdmin → findUnique returns ADMIN role
    mockOrgMemberFindUnique.mockResolvedValue({ role: "ADMIN" } as any);
    const role = {
      id: "role-1", organizationId: "org-1", name: "Video Coordinator",
      canEditEvents: false, canApproveExcuses: false, canViewAnalytics: true,
      canManageMembers: false, canManageTeams: false, canManagePayments: false,
    };
    mockCustomRoleCreate.mockResolvedValue(role as any);

    const result = await resolvers.Mutation.createCustomRole(
      null,
      { organizationId: "org-1", name: "Video Coordinator", canViewAnalytics: true },
      makeContext("admin-1")
    );

    expect(mockCustomRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Video Coordinator", organizationId: "org-1" }) })
    );
    expect(result).toEqual(role);
  });

  it("throws FORBIDDEN when called by a non-admin", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    await expect(
      resolvers.Mutation.createCustomRole(
        null,
        { organizationId: "org-1", name: "Test Role" },
        makeContext("coach-1")
      )
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
    expect(mockCustomRoleCreate).not.toHaveBeenCalled();
  });

  it("throws UNAUTHENTICATED when unauthenticated", async () => {
    await expect(
      resolvers.Mutation.createCustomRole(null, { organizationId: "org-1", name: "Test" }, makeContext())
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "UNAUTHENTICATED" }) })
    );
  });
});

// ─── assignCustomRole ─────────────────────────────────────────────────────────
describe("Mutation.assignCustomRole", () => {
  it("assigns a custom role to a member", async () => {
    // First findUnique: OrganizationMember lookup to get organizationId
    // Second findUnique (via requireOrgAdmin): to check the caller's role
    mockOrgMemberFindUnique
      .mockResolvedValueOnce({ organizationId: "org-1" } as any)  // get member's org
      .mockResolvedValueOnce({ role: "ADMIN" } as any);            // auth check
    const updatedMember = { id: "mem-1", customRoleId: "role-1" };
    mockOrgMemberUpdate.mockResolvedValue(updatedMember as any);

    const result = await resolvers.Mutation.assignCustomRole(
      null,
      { memberId: "mem-1", customRoleId: "role-1" },
      makeContext("admin-1")
    );

    expect(mockOrgMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "mem-1" }, data: { customRoleId: "role-1" } })
    );
    expect(result).toEqual(updatedMember);
  });

  it("unassigns a custom role when customRoleId is null", async () => {
    mockOrgMemberFindUnique
      .mockResolvedValueOnce({ organizationId: "org-1" } as any)
      .mockResolvedValueOnce({ role: "OWNER" } as any);
    mockOrgMemberUpdate.mockResolvedValue({ id: "mem-1", customRoleId: null } as any);

    await resolvers.Mutation.assignCustomRole(
      null,
      { memberId: "mem-1", customRoleId: null },
      makeContext("owner-1")
    );

    expect(mockOrgMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customRoleId: null } })
    );
  });
});

// ─── createTeamChallenge ──────────────────────────────────────────────────────
describe("Mutation.createTeamChallenge", () => {
  it("creates a team challenge when called by a coach", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    const challenge = {
      id: "chal-1", teamId: "team-1", title: "80% Attendance",
      targetPercent: 80, startDate: new Date("2025-01-01"), endDate: new Date("2025-03-31"),
      createdBy: "coach-1", creator: { id: "coach-1" }, team: { id: "team-1" },
    };
    mockTeamChallengeCreate.mockResolvedValue(challenge as any);

    const result = await resolvers.Mutation.createTeamChallenge(
      null,
      {
        teamId: "team-1",
        organizationId: "org-1",
        title: "80% Attendance",
        targetPercent: 80,
        startDate: "2025-01-01",
        endDate: "2025-03-31",
      },
      makeContext("coach-1")
    );

    expect(mockTeamChallengeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: "team-1",
          organizationId: "org-1",
          title: "80% Attendance",
          targetPercent: 80,
          createdBy: "coach-1",
        }),
      })
    );
    expect(result).toMatchObject({ id: "chal-1", currentPercent: 0 });
  });

  it("throws FORBIDDEN when called by an athlete", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "ATHLETE" } as any);
    await expect(
      resolvers.Mutation.createTeamChallenge(
        null,
        { teamId: "t1", organizationId: "org-1", title: "Test", targetPercent: 80, startDate: "2025-01-01", endDate: "2025-03-31" },
        makeContext("athlete-1")
      )
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
  });
});

// ─── createAthleteRecognition ─────────────────────────────────────────────────
describe("Mutation.createAthleteRecognition", () => {
  it("creates an athlete recognition when called by a coach", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    mockAthleteRecognitionDeleteMany.mockResolvedValue({ count: 0 } as any);
    const recognition = {
      id: "rec-1", userId: "athlete-1", teamId: "team-1",
      period: expect.any(String), periodType: "WEEK",
      user: { id: "athlete-1" }, team: { id: "team-1" }, nominator: { id: "coach-1" },
      createdAt: new Date(),
    };
    mockAthleteRecognitionCreate.mockResolvedValue(recognition as any);

    const result = await resolvers.Mutation.createAthleteRecognition(
      null,
      {
        userId: "athlete-1",
        teamId: "team-1",
        organizationId: "org-1",
        periodType: "WEEK",
        note: "Great hustle this week",
      },
      makeContext("coach-1")
    );

    expect(mockAthleteRecognitionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: "team-1" }) })
    );
    expect(mockAthleteRecognitionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "athlete-1",
          teamId: "team-1",
          organizationId: "org-1",
          nominatedBy: "coach-1",
          periodType: "WEEK",
          note: "Great hustle this week",
        }),
      })
    );
    expect(result).toEqual(recognition);
  });

  it("throws FORBIDDEN when called by an athlete", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "ATHLETE" } as any);
    await expect(
      resolvers.Mutation.createAthleteRecognition(
        null,
        { userId: "a1", teamId: "t1", organizationId: "org-1", periodType: "WEEK" },
        makeContext("athlete-1")
      )
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
  });
});

// ─── createInvoice ────────────────────────────────────────────────────────────

describe("Mutation.createInvoice", () => {
  const invoiceArgs = {
    organizationId: "org-1",
    userId: "athlete-1",
    title: "Season Dues 2025",
    amountCents: 15000,
  };

  const mockInvoice = {
    id: "inv-1",
    organizationId: "org-1",
    userId: "athlete-1",
    title: "Season Dues 2025",
    amountCents: 15000,
    currency: "usd",
    status: "DRAFT",
    createdBy: "coach-1",
    user: { id: "athlete-1", firstName: "Jane", lastName: "Doe", email: "jane@test.com" },
    creator: { id: "coach-1", firstName: "Coach", lastName: "Smith", email: "coach@test.com" },
    payments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates an invoice when called by a coach", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    mockInvoiceCreate.mockResolvedValue(mockInvoice as any);

    const result = await resolvers.Mutation.createInvoice(
      null,
      invoiceArgs,
      makeContext("coach-1")
    );

    expect(mockInvoiceCreate).toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "inv-1",
      title: "Season Dues 2025",
      amountCents: 15000,
      totalPaidCents: 0,
      balanceCents: 15000,
    });
  });

  it("throws when unauthenticated", async () => {
    await expect(
      resolvers.Mutation.createInvoice(null, invoiceArgs, makeContext())
    ).rejects.toThrow("Authentication required");
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when called by an athlete", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "ATHLETE" } as any);
    await expect(
      resolvers.Mutation.createInvoice(null, invoiceArgs, makeContext("athlete-1"))
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
  });

  it("rejects amountCents of zero", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    await expect(
      resolvers.Mutation.createInvoice(
        null,
        { ...invoiceArgs, amountCents: 0 },
        makeContext("coach-1")
      )
    ).rejects.toThrow(/Validation error/);
  });
});

// ─── sendInvoice ──────────────────────────────────────────────────────────────

describe("Mutation.sendInvoice", () => {
  const mockInvoice = {
    id: "inv-1",
    organizationId: "org-1",
    userId: "athlete-1",
    title: "Dues",
    amountCents: 5000,
    currency: "usd",
    status: "DRAFT",
    dueDate: null,
    user: { id: "athlete-1", firstName: "Jane", lastName: "Doe", email: "jane@test.com" },
    creator: { id: "coach-1", firstName: "Coach", lastName: "Smith", email: "coach@test.com" },
    payments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("marks invoice as SENT and sends email", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    mockInvoiceFindUniqueOrThrow.mockResolvedValue(mockInvoice as any);
    mockInvoiceUpdate.mockResolvedValue({ ...mockInvoice, status: "SENT", payments: [] } as any);

    const result = await resolvers.Mutation.sendInvoice(
      null,
      { id: "inv-1" },
      makeContext("coach-1")
    );

    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(result).toMatchObject({ status: "SENT" });
  });

  it("throws when unauthenticated", async () => {
    await expect(
      resolvers.Mutation.sendInvoice(null, { id: "inv-1" }, makeContext())
    ).rejects.toThrow("Authentication required");
  });
});

// ─── createStripeConnectLink ──────────────────────────────────────────────────

describe("Mutation.createStripeConnectLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when unauthenticated", async () => {
    await expect(
      resolvers.Mutation.createStripeConnectLink(null, { organizationId: "org-1" }, makeContext())
    ).rejects.toThrow("Authentication required");
  });

  it("throws FORBIDDEN for non-admin members", async () => {
    vi.mocked(prisma.organizationMember.findUnique).mockResolvedValue({
      role: "COACH", customRoleId: null, customRole: null,
    } as any);
    await expect(
      resolvers.Mutation.createStripeConnectLink(null, { organizationId: "org-1" }, makeContext("user-1"))
    ).rejects.toThrow("Insufficient permissions");
  });
});

// ─── disconnectStripeAccount ──────────────────────────────────────────────────

describe("Mutation.disconnectStripeAccount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears stripeAccountId and returns true", async () => {
    vi.mocked(prisma.organizationMember.findUnique).mockResolvedValue({
      role: "ADMIN", customRoleId: null, customRole: null,
    } as any);
    vi.mocked(prisma.organization.findUniqueOrThrow).mockResolvedValue({
      id: "org-1", stripeAccountId: "acct_test123",
    } as any);
    vi.mocked(prisma.organization.update).mockResolvedValue({} as any);

    const result = await resolvers.Mutation.disconnectStripeAccount(
      null,
      { organizationId: "org-1" },
      makeContext("user-1")
    );
    expect(result).toBe(true);
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stripeAccountId: null, stripeAccountEnabled: false } })
    );
  });

  it("returns true immediately when no account is connected", async () => {
    vi.mocked(prisma.organizationMember.findUnique).mockResolvedValue({
      role: "ADMIN", customRoleId: null, customRole: null,
    } as any);
    vi.mocked(prisma.organization.findUniqueOrThrow).mockResolvedValue({
      id: "org-1", stripeAccountId: null,
    } as any);

    const result = await resolvers.Mutation.disconnectStripeAccount(
      null,
      { organizationId: "org-1" },
      makeContext("user-1")
    );
    expect(result).toBe(true);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN for non-admin members", async () => {
    vi.mocked(prisma.organizationMember.findUnique).mockResolvedValue({
      role: "COACH", customRoleId: null, customRole: null,
    } as any);
    await expect(
      resolvers.Mutation.disconnectStripeAccount(null, { organizationId: "org-1" }, makeContext("user-1"))
    ).rejects.toThrow("Insufficient permissions");
  });
});

