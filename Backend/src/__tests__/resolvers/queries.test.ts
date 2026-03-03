/**
 * Integration tests for GraphQL Query resolvers.
 * Prisma and external services are fully mocked — no DB or network required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock all external dependencies ─────────────────────────────────────────
vi.mock("../../db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    organization: { findUnique: vi.fn(), findMany: vi.fn() },
    organizationMember: { findMany: vi.fn(), findUnique: vi.fn() },
    teamMember: { findMany: vi.fn(), count: vi.fn() },
    team: { findMany: vi.fn(), findUnique: vi.fn() },
    event: { findMany: vi.fn() },
    checkIn: { findMany: vi.fn(), count: vi.fn() },
    customRole: { findMany: vi.fn() },
    teamChallenge: { findMany: vi.fn() },
    athleteRecognition: { findMany: vi.fn() },
  },
}));

vi.mock("../../email.js", () => ({ sendInviteEmail: vi.fn(), sendFeedbackEmail: vi.fn() }));
vi.mock("../../s3.js", () => ({ generateProfilePictureUploadUrl: vi.fn() }));
vi.mock("../../utils/time.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/time.js")>();
  return { ...actual, parseTimeString: vi.fn(), computeEventDuration: vi.fn().mockReturnValue(2) };
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

import { resolvers } from "../../resolvers/index.js";
import { prisma } from "../../db.js";

// ─── Typed mocks ─────────────────────────────────────────────────────────────
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockOrgFindUnique = vi.mocked(prisma.organization.findUnique);
const mockOrgMemberFindMany = vi.mocked(prisma.organizationMember.findMany);
const mockOrgMemberFindUnique = vi.mocked(prisma.organizationMember.findUnique);
const mockCustomRoleFindMany = vi.mocked(prisma.customRole.findMany);
const mockTeamChallengeFindMany = vi.mocked(prisma.teamChallenge.findMany);
const mockAthleteRecognitionFindMany = vi.mocked(prisma.athleteRecognition.findMany);
const mockEventFindManyQ = vi.mocked(prisma.event.findMany);
const mockCheckInCount = vi.mocked(prisma.checkIn.count);

/** Minimal loaders stub — queries tests don't exercise field resolvers */
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

// ─── me ──────────────────────────────────────────────────────────────────────
describe("Query.me", () => {
  it("returns the current user when authenticated", async () => {
    const user = { id: "user-1", email: "test@test.com", firstName: "Test", lastName: "User" };
    mockUserFindUnique.mockResolvedValue(user as any);

    const result = await resolvers.Query.me(null, null, makeContext("user-1"));

    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(result).toEqual(user);
  });

  it("returns null when unauthenticated", async () => {
    const result = await resolvers.Query.me(null, null, makeContext());
    expect(result).toBeNull();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});

// ─── user ─────────────────────────────────────────────────────────────────────
describe("Query.user", () => {
  it("returns a user by ID", async () => {
    const user = { id: "user-42", email: "u@test.com" };
    mockUserFindUnique.mockResolvedValue(user as any);

    const result = await resolvers.Query.user(null, { id: "user-42" });

    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: "user-42" } });
    expect(result).toEqual(user);
  });

  it("returns null for a non-existent user", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const result = await resolvers.Query.user(null, { id: "ghost" });
    expect(result).toBeNull();
  });
});

// ─── organization ─────────────────────────────────────────────────────────────
describe("Query.organization", () => {
  it("returns an organization by ID", async () => {
    const org = { id: "org-1", name: "Test Org" };
    mockOrgFindUnique.mockResolvedValue(org as any);

    const result = await resolvers.Query.organization(null, { id: "org-1" });

    expect(mockOrgFindUnique).toHaveBeenCalledWith({ where: { id: "org-1" } });
    expect(result).toEqual(org);
  });
});

// ─── myOrganizations ──────────────────────────────────────────────────────────
describe("Query.myOrganizations", () => {
  it("returns organizations the user belongs to", async () => {
    const org = { id: "org-1", name: "My Org" };
    mockOrgMemberFindMany.mockResolvedValue([{ organization: org }] as any);

    const result = await resolvers.Query.myOrganizations(null, null, makeContext("user-1"));

    expect(mockOrgMemberFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      include: { organization: true },
    });
    expect(result).toEqual([org]);
  });

  it("returns an empty array when unauthenticated", async () => {
    const result = await resolvers.Query.myOrganizations(null, null, makeContext());
    expect(result).toEqual([]);
    expect(mockOrgMemberFindMany).not.toHaveBeenCalled();
  });
});

// ─── attendanceTrends ─────────────────────────────────────────────────────────
describe("Query.attendanceTrends", () => {
  const mockTeamFindMany = vi.mocked(prisma.team.findMany);
  const mockEventFindMany = vi.mocked(prisma.event.findMany);
  const mockCheckInFindMany = vi.mocked(prisma.checkIn.findMany);

  beforeEach(() => {
    // attendanceTrends requires advancedAnalytics (GROWTH+)
    mockOrgFindUnique.mockResolvedValue({ subscriptionTier: "GROWTH" } as any);
  });

  it("returns weekly trend points grouped by Monday week start", async () => {
    // Two events in the same week (2025-09-08 is a Monday)
    const events = [
      { id: "e1", date: new Date("2025-09-08T12:00:00Z"), startTime: "10:00", endTime: "12:00" },
      { id: "e2", date: new Date("2025-09-10T12:00:00Z"), startTime: "14:00", endTime: "16:00" },
    ];
    // Check-ins for event e1 only (2h logged out of 4h required across both events)
    const checkIns = [{ eventId: "e1", hoursLogged: 2 }];

    // Team with a season that covers 2025-09-01 to 2026-06-30
    mockTeamFindMany.mockResolvedValue([
      {
        id: "team-1",
        organizationId: "org-1",
        archivedAt: null,
        seasonYear: 2026,
        orgSeasonId: "season-1",
        orgSeason: { startMonth: 9, endMonth: 6 },
      },
    ] as any);
    mockEventFindMany.mockResolvedValue(events as any);
    mockCheckInFindMany.mockResolvedValue(checkIns as any);

    const result = await resolvers.Query.attendanceTrends(null, { organizationId: "org-1" });

    expect(result).toHaveLength(1);
    expect(result[0].weekStart).toBe("2025-09-08");
    expect(result[0].eventsCount).toBe(2);
    // computeEventDuration is mocked to return 2, so hoursRequired = 2*2 = 4, hoursLogged = 2
    expect(result[0].hoursRequired).toBe(4);
    expect(result[0].hoursLogged).toBe(2);
    expect(result[0].attendancePercent).toBeCloseTo(50);
  });

  it("returns empty array when there are no events", async () => {
    mockTeamFindMany.mockResolvedValue([
      {
        id: "team-1",
        organizationId: "org-1",
        archivedAt: null,
        seasonYear: 2026,
        orgSeasonId: "season-1",
        orgSeason: { startMonth: 9, endMonth: 6 },
      },
    ] as any);
    mockEventFindMany.mockResolvedValue([] as any);

    const result = await resolvers.Query.attendanceTrends(null, { organizationId: "org-1" });

    expect(result).toEqual([]);
    expect(mockCheckInFindMany).not.toHaveBeenCalled();
  });

  it("sorts results by weekStart ascending across multiple weeks", async () => {
    const events = [
      { id: "e1", date: new Date("2025-09-15T12:00:00Z"), startTime: "10:00", endTime: "12:00" },
      { id: "e2", date: new Date("2025-09-08T12:00:00Z"), startTime: "10:00", endTime: "12:00" },
    ];

    mockTeamFindMany.mockResolvedValue([
      {
        id: "team-1",
        organizationId: "org-1",
        archivedAt: null,
        seasonYear: 2026,
        orgSeasonId: "season-1",
        orgSeason: { startMonth: 9, endMonth: 6 },
      },
    ] as any);
    mockEventFindMany.mockResolvedValue(events as any);
    mockCheckInFindMany.mockResolvedValue([] as any);

    const result = await resolvers.Query.attendanceTrends(null, { organizationId: "org-1" });

    expect(result).toHaveLength(2);
    expect(result[0].weekStart).toBe("2025-09-08");
    expect(result[1].weekStart).toBe("2025-09-15");
  });
});

// ─── customRoles ──────────────────────────────────────────────────────────────
describe("Query.customRoles", () => {
  it("returns custom roles ordered by name for an admin", async () => {
    // requireOrgAdmin → findUnique returns ADMIN role
    mockOrgMemberFindUnique.mockResolvedValue({ role: "ADMIN" } as any);
    const roles = [
      { id: "r1", name: "Analyst" },
      { id: "r2", name: "Video Coordinator" },
    ];
    mockCustomRoleFindMany.mockResolvedValue(roles as any);

    const result = await resolvers.Query.customRoles(
      null,
      { organizationId: "org-1" },
      makeContext("admin-1")
    );

    expect(mockCustomRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1" }, orderBy: { name: "asc" } })
    );
    expect(result).toEqual(roles);
  });

  it("throws FORBIDDEN when called by a non-admin", async () => {
    mockOrgMemberFindUnique.mockResolvedValue({ role: "COACH" } as any);
    await expect(
      resolvers.Query.customRoles(null, { organizationId: "org-1" }, makeContext("coach-1"))
    ).rejects.toThrow(
      expect.objectContaining({ extensions: expect.objectContaining({ code: "FORBIDDEN" }) })
    );
    expect(mockCustomRoleFindMany).not.toHaveBeenCalled();
  });
});

// ─── teamChallenges ───────────────────────────────────────────────────────────
describe("Query.teamChallenges", () => {
  it("returns team challenges with currentPercent computed", async () => {
    const now = new Date();
    const challenges = [
      {
        id: "chal-1",
        teamId: "team-1",
        title: "80% Challenge",
        targetPercent: 80,
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-03-31"),
        completedAt: null,
        createdBy: "coach-1",
        creator: { id: "coach-1" },
        team: { id: "team-1" },
      },
    ];
    mockTeamChallengeFindMany.mockResolvedValue(challenges as any);
    mockEventFindManyQ.mockResolvedValue([{ id: "e1" }, { id: "e2" }] as any);
    mockCheckInCount
      .mockResolvedValueOnce(8)   // attended (ON_TIME | LATE)
      .mockResolvedValueOnce(10); // total check-ins

    const result = await resolvers.Query.teamChallenges(
      null,
      { teamId: "team-1" },
      makeContext("coach-1")
    );

    expect(result).toHaveLength(1);
    expect(result[0].currentPercent).toBeCloseTo(80);
  });

  it("returns empty array when no challenges exist", async () => {
    mockTeamChallengeFindMany.mockResolvedValue([] as any);
    const result = await resolvers.Query.teamChallenges(null, { teamId: "t1" }, makeContext("u1"));
    expect(result).toEqual([]);
  });
});

// ─── teamRecognitions ─────────────────────────────────────────────────────────
describe("Query.teamRecognitions", () => {
  it("returns recognitions ordered by createdAt desc", async () => {
    const recognitions = [
      { id: "rec-1", userId: "a1", teamId: "team-1", period: "2025-W37", user: {}, team: {}, nominator: {}, createdAt: new Date() },
    ];
    mockAthleteRecognitionFindMany.mockResolvedValue(recognitions as any);

    const result = await resolvers.Query.teamRecognitions(
      null,
      { teamId: "team-1", limit: 5 },
      makeContext("coach-1")
    );

    expect(mockAthleteRecognitionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: "team-1" },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    );
    expect(result).toEqual(recognitions);
  });
});
