import { prisma } from "../../db.js";
import { TeamRole } from "@prisma/client";
import { requireAuth, requireOrgAdmin, requireCoachOrAbove, requireActiveSubscription } from "../../utils/permissions.js";
import { auditLog } from "../../utils/audit.js";
import { toISO, getSeasonDateRange, generateSeasonDisplayString } from "../../utils/time.js";
import { filterEventsByMembership, MembershipPeriod } from "../../utils/membershipPeriods.js";
import { getAthleteLimit } from "../../utils/subscriptions.js";
import { computeEventDuration } from "../../utils/time.js";
import type { Loaders } from "../../utils/dataLoaders.js";

interface Context {
  userId?: string;
  loaders: Loaders;
}

export const teamResolvers = {
  Query: {
    team: async (_: unknown, { id }: { id: string }) => {
      return prisma.team.findUnique({ where: { id } });
    },

    teams: async (_: unknown, { organizationId, includeArchived }: { organizationId: string; includeArchived?: boolean }) => {
      return prisma.team.findMany({
        where: {
          organizationId,
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
    },
  },

  Mutation: {
    createTeam: async (_: unknown, { input }: { input: { name: string; season?: string; sport?: string; color?: string; description?: string; organizationId: string; orgSeasonId?: string; seasonYear?: number } }, context: { userId?: string }) => {
      await requireCoachOrAbove(context, input.organizationId);
      await requireActiveSubscription(input.organizationId);
      let season = input.season;
      if (input.orgSeasonId && input.seasonYear) {
        const orgSeason = await prisma.orgSeason.findUnique({ where: { id: input.orgSeasonId } });
        if (orgSeason) {
          season = generateSeasonDisplayString(orgSeason.name, input.seasonYear);
        }
      }
      return prisma.team.create({
        data: {
          name: input.name,
          season,
          sport: input.sport,
          color: input.color,
          description: input.description,
          organizationId: input.organizationId,
          orgSeasonId: input.orgSeasonId,
          seasonYear: input.seasonYear,
        },
      });
    },

    updateTeam: async (_: unknown, { id, name, season, sport, color, description, orgSeasonId, seasonYear }: { id: string; name?: string; season?: string; sport?: string; color?: string; description?: string; orgSeasonId?: string; seasonYear?: number }) => {
      let computedSeason = season;
      if (orgSeasonId !== undefined && seasonYear !== undefined) {
        if (orgSeasonId) {
          const orgSeason = await prisma.orgSeason.findUnique({ where: { id: orgSeasonId } });
          if (orgSeason) {
            computedSeason = generateSeasonDisplayString(orgSeason.name, seasonYear);
          }
        } else {
          // Clearing the season assignment
          computedSeason = season || null as any;
        }
      }
      return prisma.team.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(computedSeason !== undefined && { season: computedSeason }),
          ...(sport !== undefined && { sport }),
          ...(color !== undefined && { color }),
          ...(description !== undefined && { description }),
          ...(orgSeasonId !== undefined && { orgSeasonId: orgSeasonId || null }),
          ...(seasonYear !== undefined && { seasonYear: seasonYear || null }),
        },
      });
    },

    deleteTeam: async (_: unknown, { id, hardDelete }: { id: string; hardDelete?: boolean }, context: { userId?: string }) => {
      const actorId = requireAuth(context);
      const team = await prisma.team.findUnique({ where: { id }, select: { organizationId: true } });
      if (team) await requireOrgAdmin(context, team.organizationId);
      await prisma.$transaction(async (tx) => {
        // Remove all team members
        await tx.teamMember.deleteMany({ where: { teamId: id } });
        // Disconnect from any participatingEvents join table
        const participatingEvents = await tx.event.findMany({
          where: { participatingTeams: { some: { id } } },
          select: { id: true },
        });
        for (const event of participatingEvents) {
          await tx.event.update({
            where: { id: event.id },
            data: { participatingTeams: { disconnect: { id } } },
          });
        }

        if (hardDelete) {
          // Collect all event IDs owned by this team
          const teamEventIds = (
            await tx.event.findMany({ where: { teamId: id }, select: { id: true } })
          ).map((e) => e.id);

          if (teamEventIds.length > 0) {
            // Delete child records in dependency order before deleting events
            await tx.checkIn.deleteMany({ where: { eventId: { in: teamEventIds } } });
            await tx.excuseRequest.deleteMany({ where: { eventId: { in: teamEventIds } } });
            await tx.eventRsvp.deleteMany({ where: { eventId: { in: teamEventIds } } });
            await tx.event.deleteMany({ where: { id: { in: teamEventIds } } });
          }

          // Delete recurring event templates tied to this team
          await tx.recurringEvent.deleteMany({ where: { teamId: id } });
          // Hard delete the team
          await tx.team.delete({ where: { id } });
        } else {
          // Archive the team
          await tx.team.update({
            where: { id },
            data: { archivedAt: new Date() },
          });
        }
      });
      await auditLog({ action: "DELETE_TEAM", actorId, targetId: id, targetType: "Team", organizationId: team?.organizationId, metadata: { hardDelete: !!hardDelete } });
      return true;
    },

    restoreTeam: async (_: unknown, { id }: { id: string }) => {
      return prisma.team.update({
        where: { id },
        data: { archivedAt: null },
      });
    },

    reorderTeams: async (
      _: unknown,
      { organizationId, teamIds }: { organizationId: string; teamIds: string[] }
    ) => {
      await Promise.all(
        teamIds.map((id, index) =>
          prisma.team.update({
            where: { id },
            data: { sortOrder: index },
          })
        )
      );
      return true;
    },

    addTeamMember: async (
      _: unknown,
      { input }: { input: { userId: string; teamId: string; role?: TeamRole; hoursRequired?: number } }
    ) => {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.teamMember.findUnique({
          where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
        });

        // Enforce athlete limit when adding a new ATHLETE member (not re-adding existing).
        if (!existing && (!input.role || input.role === "MEMBER")) {
          const team = await tx.team.findUnique({
            where: { id: input.teamId },
            select: { organizationId: true },
          });
          if (team) {
            const org = await tx.organization.findUnique({
              where: { id: team.organizationId },
              select: { athleteLimit: true, subscriptionTier: true },
            });
            if (org) {
              const currentCount = await tx.organizationMember.count({
                where: { organizationId: team.organizationId, role: "ATHLETE" },
              });
              const limit = org.athleteLimit;
              if (currentCount >= limit) {
                throw new Error(
                  `Athlete limit reached (${limit}). Upgrade your plan to add more athletes.`
                );
              }
            }
          }
        }

        const member = await tx.teamMember.upsert({
          where: { userId_teamId: { userId: input.userId, teamId: input.teamId } },
          update: {},
          create: {
            userId: input.userId,
            teamId: input.teamId,
            role: input.role || "MEMBER",
            hoursRequired: input.hoursRequired || 0,
          },
        });

        // Only create a history entry on new memberships (not idempotent re-adds)
        if (!existing) {
          await tx.teamMemberHistory.create({
            data: {
              userId: input.userId,
              teamId: input.teamId,
              joinedAt: new Date(),
            },
          });
        }

        return member;
      });
    },

    removeTeamMember: async (_: unknown, { userId, teamId }: { userId: string; teamId: string }) => {
      await prisma.$transaction(async (tx) => {
        // Close the open membership history window
        await tx.teamMemberHistory.updateMany({
          where: { userId, teamId, leftAt: null },
          data: { leftAt: new Date() },
        });
        await tx.teamMember.delete({
          where: { userId_teamId: { userId, teamId } },
        });
      });
      return true;
    },

    updateTeamMemberRole: async (
      _: unknown,
      { userId, teamId, role }: { userId: string; teamId: string; role: TeamRole }
    ) => {
      return prisma.teamMember.update({
        where: { userId_teamId: { userId, teamId } },
        data: { role },
      });
    },
  },

  Team: {
    organization: (parent: { organizationId: string }, _: unknown, context: Context) =>
      context.loaders.organization.load(parent.organizationId),
    orgSeason: (parent: { orgSeasonId?: string | null }) =>
      parent.orgSeasonId ? prisma.orgSeason.findUnique({ where: { id: parent.orgSeasonId } }) : null,
    members: (parent: { id: string }) => prisma.teamMember.findMany({ where: { teamId: parent.id } }),
    events: (parent: { id: string }) =>
      prisma.event.findMany({
        where: {
          isAdHoc: false,
          OR: [
            { teamId: parent.id },
            { participatingTeams: { some: { id: parent.id } } },
          ],
        },
        orderBy: { date: "asc" },
      }),
    recurringEvents: (parent: { id: string }) =>
      prisma.recurringEvent.findMany({ where: { teamId: parent.id } }),
    memberCount: (parent: { id: string }) => prisma.teamMember.count({ where: { teamId: parent.id, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } } }),
    attendancePercent: async (parent: { id: string; orgSeasonId?: string | null; seasonYear?: number | null }, { timeRange }: { timeRange?: string }) => {
      // Fetch team with season info to use season date range
      const team = await prisma.team.findUnique({
        where: { id: parent.id },
        include: { orgSeason: true },
      });

      const { start: startDate, end: endDate } = team?.orgSeason && team?.seasonYear
        ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
        : { start: new Date(0), end: new Date() }; // Fallback for legacy teams

      const members = await prisma.teamMember.findMany({ where: { teamId: parent.id, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } } });
      const athleteUserIds = members.map(m => m.userId);
      const checkIns = await prisma.checkIn.findMany({
        where: {
          event: { teamId: parent.id },
          createdAt: { gte: startDate, lte: endDate },
          userId: { in: athleteUserIds },
          approved: true,
        },
      });
      const totalHoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
      const totalHoursRequired = members.reduce((sum, m) => sum + m.hoursRequired, 0);
      return totalHoursRequired > 0 ? Math.min(100, (totalHoursLogged / totalHoursRequired) * 100) : 0;
    },
    createdAt: (parent: any) => toISO(parent.createdAt),
    updatedAt: (parent: any) => toISO(parent.updatedAt),
  },

  TeamMember: {
    user: (parent: { userId: string }, _: unknown, context: Context) =>
      context.loaders.user.load(parent.userId),
    team: (parent: { teamId: string }, _: unknown, context: Context) =>
      context.loaders.team.load(parent.teamId),
    hoursLogged: async (parent: { userId: string; teamId: string; joinedAt?: Date }, _: unknown, context: Context) => {
      const team = await context.loaders.team.load(parent.teamId) as any;

      const { start: startDate, end: rawEnd } = team?.orgSeason && team?.seasonYear
        ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
        : { start: new Date(0), end: new Date() };
      const cappedEnd = new Date(Math.min(rawEnd.getTime(), Date.now()));

      const historyRows = await prisma.teamMemberHistory.findMany({
        where: { userId: parent.userId, teamId: parent.teamId },
        orderBy: { joinedAt: "asc" },
      });
      const periods: MembershipPeriod[] = historyRows.length > 0
        ? historyRows
        : [{ joinedAt: parent.joinedAt ?? startDate, leftAt: null }];

      const teamEvents = await prisma.event.findMany({
        where: {
          OR: [{ teamId: parent.teamId }, { participatingTeams: { some: { id: parent.teamId } } }],
          date: { gte: startDate, lte: cappedEnd },
          isAdHoc: false,
        },
        select: { id: true, date: true },
      });
      const memberEventIds = filterEventsByMembership(teamEvents, periods).map((e) => e.id);

      const checkIns = await prisma.checkIn.findMany({
        where: {
          userId: parent.userId,
          eventId: { in: memberEventIds },
          approved: true,
        },
      });
      return checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
    },
    attendancePercent: async (
      parent: { userId: string; teamId: string; hoursRequired: number; joinedAt?: Date },
      _: unknown,
      context: Context
    ) => {
      const team = await context.loaders.team.load(parent.teamId) as any;

      const { start: startDate, end: rawEnd } = team?.orgSeason && team?.seasonYear
        ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
        : { start: new Date(0), end: new Date() };
      const cappedEnd = new Date(Math.min(rawEnd.getTime(), Date.now()));

      const historyRows = await prisma.teamMemberHistory.findMany({
        where: { userId: parent.userId, teamId: parent.teamId },
        orderBy: { joinedAt: "asc" },
      });
      const periods: MembershipPeriod[] = historyRows.length > 0
        ? historyRows
        : [{ joinedAt: parent.joinedAt ?? startDate, leftAt: null }];

      const teamEvents = await prisma.event.findMany({
        where: {
          OR: [{ teamId: parent.teamId }, { participatingTeams: { some: { id: parent.teamId } } }],
          date: { gte: startDate, lte: cappedEnd },
          isAdHoc: false,
        },
        select: { id: true, date: true, startTime: true, endTime: true },
      });
      const memberEvents = filterEventsByMembership(teamEvents, periods);
      const hoursRequired = memberEvents.reduce(
        (sum, e) => sum + computeEventDuration(e.startTime, e.endTime), 0
      );

      const checkIns = await prisma.checkIn.findMany({
        where: {
          userId: parent.userId,
          eventId: { in: memberEvents.map((e) => e.id) },
          approved: true,
        },
      });
      const hoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
      return hoursRequired > 0 ? Math.min(100, (hoursLogged / hoursRequired) * 100) : 0;
    },
    joinedAt: (parent: any) => toISO(parent.joinedAt),
  },
};
