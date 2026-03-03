import { prisma } from "../../db.js";
import { OrgRole, TeamRole } from "@prisma/client";
import { requireTierFeature } from "../../utils/permissions.js";
import { toISO, getSeasonDateRange, isTeamInCurrentSeason, toWeekStart } from "../../utils/time.js";
import { computeEventDuration } from "../../utils/time.js";
import { filterEventsByMembership, MembershipPeriod } from "../../utils/membershipPeriods.js";
import { getNonAthleteTeamMap, isAthleteCheckIn } from "../../utils/analyticsHelpers.js";

// ============================================
// Gamification helpers
// ============================================

function computeStreaks(checkIns: Array<{ status: string; event: { date: Date | string } }>) {
  const sorted = [...checkIns].sort(
    (a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime()
  );

  let bestStreak = 0;
  let runningStreak = 0;

  for (const ci of sorted) {
    if (ci.status === "ON_TIME" || ci.status === "LATE") {
      runningStreak++;
      if (runningStreak > bestStreak) bestStreak = runningStreak;
    } else if (ci.status === "ABSENT") {
      runningStreak = 0;
    }
    // EXCUSED does not break streak
  }

  // Current streak: walk backwards from the most recent event
  let currentStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const ci = sorted[i];
    if (ci.status === "ON_TIME" || ci.status === "LATE") {
      currentStreak++;
    } else if (ci.status === "ABSENT") {
      break;
    }
  }

  return { currentStreak, bestStreak };
}

const BADGE_DEFINITIONS = [
  // Hours milestones
  { id: "hours_10",  name: "Getting Started",    description: "Log 10 hours of training",   category: "hours",      icon: "⏱️",  threshold: 10,  field: "hoursLogged" },
  { id: "hours_25",  name: "Committed",           description: "Log 25 hours of training",   category: "hours",      icon: "💪",  threshold: 25,  field: "hoursLogged" },
  { id: "hours_50",  name: "Dedicated",           description: "Log 50 hours of training",   category: "hours",      icon: "🔥",  threshold: 50,  field: "hoursLogged" },
  { id: "hours_100", name: "Century Club",        description: "Log 100 hours of training",  category: "hours",      icon: "🏆",  threshold: 100, field: "hoursLogged" },
  { id: "hours_250", name: "Elite Athlete",       description: "Log 250 hours of training",  category: "hours",      icon: "⭐",  threshold: 250, field: "hoursLogged" },
  // Streak milestones (best streak ever)
  { id: "streak_5",  name: "On a Roll",           description: "Attend 5 events in a row",   category: "streak",     icon: "🔥",  threshold: 5,   field: "bestStreak" },
  { id: "streak_10", name: "Unstoppable",         description: "Attend 10 events in a row",  category: "streak",     icon: "⚡",  threshold: 10,  field: "bestStreak" },
  { id: "streak_25", name: "Streak Master",       description: "Attend 25 events in a row",  category: "streak",     icon: "🌟",  threshold: 25,  field: "bestStreak" },
  // Attendance rate
  { id: "attend_75", name: "Reliable",            description: "Reach 75% attendance rate",  category: "attendance", icon: "✅",  threshold: 75,  field: "attendancePercent" },
  { id: "attend_90", name: "Consistent",          description: "Reach 90% attendance rate",  category: "attendance", icon: "🎯",  threshold: 90,  field: "attendancePercent" },
  { id: "attend_100",name: "Perfect Attendance",  description: "Reach 100% attendance rate", category: "attendance", icon: "💎",  threshold: 100, field: "attendancePercent" },
  // Check-in count
  { id: "checkin_10",  name: "Regular",           description: "Check in to 10 events",      category: "checkins",   icon: "📍",  threshold: 10,  field: "checkInCount" },
  { id: "checkin_25",  name: "Veteran",           description: "Check in to 25 events",      category: "checkins",   icon: "🏅",  threshold: 25,  field: "checkInCount" },
  { id: "checkin_50",  name: "All-Star",          description: "Check in to 50 events",      category: "checkins",   icon: "🌠",  threshold: 50,  field: "checkInCount" },
  { id: "checkin_100", name: "Legend",            description: "Check in to 100 events",     category: "checkins",   icon: "👑",  threshold: 100, field: "checkInCount" },
];

export const analyticsResolvers = {
  Query: {
    // Attendance log queries
    attendanceLog: async (
      _: unknown,
      { organizationId, limit, offset }: { organizationId: string; limit?: number; offset?: number }
    ) => {
      const coachTeamMap = await getNonAthleteTeamMap(organizationId);
      const checkIns = await prisma.checkIn.findMany({
        where: {
          event: { organizationId },
          status: { in: ["ON_TIME", "LATE"] },
          approved: true,
        },
        orderBy: { createdAt: "desc" },
        include: { event: { select: { teamId: true } } },
      });
      const filtered = checkIns.filter(c => isAthleteCheckIn(c, coachTeamMap));
      return filtered.slice(offset || 0, (offset || 0) + (limit || 30));
    },

    absentExcusedLog: async (
      _: unknown,
      { organizationId, limit, offset }: { organizationId: string; limit?: number; offset?: number }
    ) => {
      const coachTeamMap = await getNonAthleteTeamMap(organizationId);
      const checkIns = await prisma.checkIn.findMany({
        where: {
          event: { organizationId },
          status: { in: ["ABSENT", "EXCUSED"] },
          approved: true,
        },
        orderBy: { createdAt: "desc" },
        include: { event: { select: { teamId: true } } },
      });
      const filtered = checkIns.filter(c => isAthleteCheckIn(c, coachTeamMap));
      return filtered.slice(offset || 0, (offset || 0) + (limit || 30));
    },

    allAttendanceRecords: async (
      _: unknown,
      { organizationId, search, status, teamId, userId, startDate, endDate, sortField, sortDir, limit, offset }: {
        organizationId: string;
        search?: string;
        status?: string;
        teamId?: string;
        userId?: string;
        startDate?: string;
        endDate?: string;
        sortField?: string;
        sortDir?: string;
        limit?: number;
        offset?: number;
      }
    ) => {
      const coachTeamMap = await getNonAthleteTeamMap(organizationId);
      const dir = sortDir === "asc" ? "asc" : "desc";
      const orderBy: any[] = (() => {
        switch (sortField) {
          case "name": return [{ user: { firstName: dir } }, { user: { lastName: dir } }];
          case "event": return [{ event: { title: dir } }];
          case "status": return [{ status: dir }, { event: { date: "desc" } }];
          case "checkIn": return [{ checkInTime: dir }];
          case "checkOut": return [{ checkOutTime: dir }];
          case "hours": return [{ hoursLogged: dir }];
          default: return [{ event: { date: "desc" } }];
        }
      })();

      const eventFilter: any = { organizationId };
      if (teamId) eventFilter.teamId = teamId;
      if (startDate || endDate) {
        eventFilter.date = {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        };
      }

      const where: any = {
        event: eventFilter,
        approved: true,
        ...(status && status !== "ALL" && { status }),
        ...(userId && { userId }),
        ...(search && {
          OR: [
            { user: { firstName: { contains: search, mode: "insensitive" } } },
            { user: { lastName: { contains: search, mode: "insensitive" } } },
            { event: { title: { contains: search, mode: "insensitive" } } },
          ],
        }),
      };

      const checkIns = await prisma.checkIn.findMany({
        where,
        orderBy,
        include: { event: { select: { teamId: true } } },
      });
      const filtered = checkIns.filter(c => isAthleteCheckIn(c, coachTeamMap));
      return filtered.slice(offset || 0, (offset || 0) + (limit || 20));
    },

    attendanceRecordsCount: async (
      _: unknown,
      { organizationId, search, status, teamId, userId, startDate, endDate }: {
        organizationId: string;
        search?: string;
        status?: string;
        teamId?: string;
        userId?: string;
        startDate?: string;
        endDate?: string;
      }
    ) => {
      const coachTeamMap = await getNonAthleteTeamMap(organizationId);

      const eventFilter: any = { organizationId };
      if (teamId) eventFilter.teamId = teamId;
      if (startDate || endDate) {
        eventFilter.date = {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        };
      }

      const where: any = {
        event: eventFilter,
        approved: true,
        ...(status && status !== "ALL" && { status }),
        ...(userId && { userId }),
        ...(search && {
          OR: [
            { user: { firstName: { contains: search, mode: "insensitive" } } },
            { user: { lastName: { contains: search, mode: "insensitive" } } },
            { event: { title: { contains: search, mode: "insensitive" } } },
          ],
        }),
      };
      // Load minimal fields for the athlete filter, then count
      const checkIns = await prisma.checkIn.findMany({
        where,
        select: { userId: true, event: { select: { teamId: true } } },
      });
      return checkIns.filter(c => isAthleteCheckIn(c, coachTeamMap)).length;
    },

    attendanceInsights: async (
      _: unknown,
      { organizationId, teamId, timeRange }: { organizationId: string; teamId?: string; timeRange?: string }
    ) => {
      await requireTierFeature(organizationId, "advancedAnalytics");
      const coachTeamMap = await getNonAthleteTeamMap(organizationId);

      // Get season date range - if teamId provided, use that team's season, otherwise use first current season team
      let startDate: Date, endDate: Date;
      if (teamId) {
        const team = await prisma.team.findUnique({
          where: { id: teamId },
          include: { orgSeason: true },
        });
        const range = team?.orgSeason && team?.seasonYear
          ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
          : { start: new Date(0), end: new Date() };
        startDate = range.start;
        endDate = range.end;
      } else {
        // Get first current season team for org-wide insights
        const teams = await prisma.team.findMany({
          where: { organizationId, archivedAt: null },
          include: { orgSeason: true },
        });
        const currentSeasonTeams = teams.filter(isTeamInCurrentSeason);
        const firstTeam = currentSeasonTeams[0];
        const range = firstTeam?.orgSeason && firstTeam?.seasonYear
          ? getSeasonDateRange(firstTeam.orgSeason.startMonth, firstTeam.orgSeason.endMonth, firstTeam.seasonYear)
          : { start: new Date(0), end: new Date() };
        startDate = range.start;
        endDate = range.end;
      }

      const eventWhere: any = { organizationId, date: { gte: startDate, lte: endDate } };
      if (teamId) {
        eventWhere.OR = [
          { teamId },
          { participatingTeams: { some: { id: teamId } } },
        ];
      }

      const allCheckIns = await prisma.checkIn.findMany({
        where: {
          event: eventWhere,
          approved: true,
        },
        include: { event: { select: { teamId: true } } },
      });

      const filtered = allCheckIns.filter(c => isAthleteCheckIn(c, coachTeamMap));

      const onTimeCount = filtered.filter(c => c.status === "ON_TIME").length;
      const lateCount = filtered.filter(c => c.status === "LATE").length;
      const absentCount = filtered.filter(c => c.status === "ABSENT").length;
      const excusedCount = filtered.filter(c => c.status === "EXCUSED").length;
      const eventCount = await prisma.event.count({ where: eventWhere });

      const totalExpected = onTimeCount + lateCount + absentCount + excusedCount;
      const attendanceRate = totalExpected > 0 ? (onTimeCount + lateCount) / totalExpected : 0;

      return { totalExpected, onTimeCount, lateCount, absentCount, excusedCount, attendanceRate, eventCount };
    },

    teamAttendanceRecords: async (
      _: unknown,
      { teamId, limit, offset }: { teamId: string; limit?: number; offset?: number }
    ) => {
      return prisma.checkIn.findMany({
        where: {
          event: {
            OR: [
              { teamId },
              { participatingTeams: { some: { id: teamId } } },
            ],
          },
          approved: true,
        },
        orderBy: { createdAt: "desc" },
        skip: offset || 0,
        take: limit || 30,
      });
    },

    // Analytics queries
    userStats: async (
      _: unknown,
      { userId, organizationId, teamId, timeRange }: { userId: string; organizationId: string; teamId?: string; timeRange?: string }
    ) => {
      const emptyStats = {
        hoursLogged: 0,
        hoursRequired: 0,
        attendancePercent: 0,
        teamRank: 0,
        teamSize: 0,
        orgRank: 0,
        orgSize: 0,
        currentStreak: 0,
        bestStreak: 0,
      };

      // When teamId is provided, scope stats to that team only
      if (teamId) {
        const membership = await prisma.teamMember.findFirst({
          where: { userId, teamId },
        });

        if (!membership) return emptyStats;

        // Fetch team with season info to use season date range
        const team = await prisma.team.findUnique({
          where: { id: teamId },
          include: { orgSeason: true },
        });

        const { start: startDate, end: endDate } = team?.orgSeason && team?.seasonYear
          ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
          : { start: new Date(0), end: new Date() }; // Fallback for legacy teams

        // Cap the season end at today — only count hours that have already occurred
        const now = new Date();
        const cappedEnd = new Date(Math.min(endDate.getTime(), now.getTime()));

        // Fetch membership history for this user+team so we can filter events
        // to only the windows when the member was actually active
        const historyRows = await prisma.teamMemberHistory.findMany({
          where: { userId, teamId },
          orderBy: { joinedAt: "asc" },
        });
        // Fallback for legacy data: treat the full season as one active period
        const periods: MembershipPeriod[] = historyRows.length > 0
          ? historyRows
          : [{ joinedAt: startDate, leftAt: null }];

        // Fetch all team events in the (capped) season window
        const allTeamEvents = await prisma.event.findMany({
          where: {
            OR: [
              { teamId },
              { participatingTeams: { some: { id: teamId } } },
            ],
            date: { gte: startDate, lte: cappedEnd },
            isAdHoc: false,
          },
          select: { id: true, date: true, startTime: true, endTime: true },
        });

        // Only include events during the member's active membership windows
        const memberEvents = filterEventsByMembership(allTeamEvents, periods);
        const memberEventIds = memberEvents.map((e) => e.id);

        const hoursRequired = memberEvents.reduce(
          (sum, e) => sum + computeEventDuration(e.startTime, e.endTime), 0
        );

        // Check-ins scoped to those specific events
        const checkIns = await prisma.checkIn.findMany({
          where: {
            userId,
            eventId: { in: memberEventIds },
            approved: true,
          },
        });

        const hoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
        const attendancePercent = hoursRequired > 0 ? (hoursLogged / hoursRequired) * 100 : 0;

        // Team rank — athletes only
        const teamMembers = await prisma.teamMember.findMany({
          where: { teamId, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } },
        });

        // Org rank — athletes only across all org teams
        const orgMembers = await prisma.teamMember.findMany({
          where: { team: { organizationId }, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } },
        });

        // Compute streaks from check-ins with event dates
        const checkInsWithEvent = await prisma.checkIn.findMany({
          where: {
            userId,
            event: {
              OR: [
                { teamId },
                { participatingTeams: { some: { id: teamId } } },
              ],
            },
          },
          include: { event: { select: { date: true } } },
          orderBy: { event: { date: "asc" } },
        });
        const { currentStreak, bestStreak } = computeStreaks(checkInsWithEvent);

        return {
          hoursLogged,
          hoursRequired,
          attendancePercent: Math.min(100, attendancePercent),
          teamRank: 1,
          teamSize: teamMembers.length,
          orgRank: 1,
          orgSize: orgMembers.length,
          currentStreak,
          bestStreak,
        };
      }

      // No teamId — aggregate all-around stats across the entire org
      const memberships = await prisma.teamMember.findMany({
        where: { userId, team: { organizationId } },
        include: { team: { include: { orgSeason: true } } },
      });

      if (memberships.length === 0) return emptyStats;

      // For org-wide stats, we need to aggregate across all current season teams
      // Use the first team's season as reference (they should all be in current season)
      const firstTeam = memberships[0].team;
      const { start: startDate, end: endDate } = firstTeam?.orgSeason && firstTeam?.seasonYear
        ? getSeasonDateRange(firstTeam.orgSeason.startMonth, firstTeam.orgSeason.endMonth, firstTeam.seasonYear)
        : { start: new Date(0), end: new Date() }; // Fallback for legacy teams

      // Cap at today so future events don't inflate hoursRequired
      const now = new Date();
      const cappedEnd = new Date(Math.min(endDate.getTime(), now.getTime()));

      // For each team the user is in, filter events to their active membership windows.
      // This handles multiple join/leave cycles per team.
      const allEventIdsSet = new Set<string>();
      let totalHoursRequired = 0;

      for (const m of memberships) {
        const tid = m.teamId;
        const { start: tStart, end: tEnd } = m.team?.orgSeason && m.team?.seasonYear
          ? getSeasonDateRange(m.team.orgSeason.startMonth, m.team.orgSeason.endMonth, m.team.seasonYear)
          : { start: new Date(0), end: new Date() };
        const tCappedEnd = new Date(Math.min(tEnd.getTime(), now.getTime()));

        const historyRows = await prisma.teamMemberHistory.findMany({
          where: { userId, teamId: tid },
          orderBy: { joinedAt: "asc" },
        });
        const periods: MembershipPeriod[] = historyRows.length > 0
          ? historyRows
          : [{ joinedAt: tStart, leftAt: null }];

        const teamEvents = await prisma.event.findMany({
          where: {
            OR: [{ teamId: tid }, { participatingTeams: { some: { id: tid } } }],
            date: { gte: tStart, lte: tCappedEnd },
            isAdHoc: false,
          },
          select: { id: true, date: true, startTime: true, endTime: true },
        });

        const memberEvents = filterEventsByMembership(teamEvents, periods);
        for (const e of memberEvents) {
          if (!allEventIdsSet.has(e.id)) {
            allEventIdsSet.add(e.id);
            totalHoursRequired += computeEventDuration(e.startTime, e.endTime);
          }
        }
      }

      const allEventIds = [...allEventIdsSet];
      const checkIns = await prisma.checkIn.findMany({
        where: {
          userId,
          eventId: { in: allEventIds },
          approved: true,
        },
      });

      const hoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
      const hoursRequired = totalHoursRequired;
      const attendancePercent = hoursRequired > 0 ? (hoursLogged / hoursRequired) * 100 : 0;

      // Org rank — athletes only
      const orgMembers = await prisma.teamMember.findMany({
        where: { team: { organizationId }, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } },
      });

      // Compute streaks from all org check-ins with event dates
      const allCheckInsWithEvent = await prisma.checkIn.findMany({
        where: { userId, event: { organizationId } },
        include: { event: { select: { date: true } } },
        orderBy: { event: { date: "asc" } },
      });
      const { currentStreak, bestStreak } = computeStreaks(allCheckInsWithEvent);

      return {
        hoursLogged,
        hoursRequired,
        attendancePercent: Math.min(100, attendancePercent),
        teamRank: 0,
        teamSize: 0,
        orgRank: 1,
        orgSize: orgMembers.length,
        currentStreak,
        bestStreak,
      };
    },

    getUserBadges: async (
      _: unknown,
      { userId, organizationId }: { userId: string; organizationId: string }
    ) => {
      // Fetch all check-ins for this user in this org
      const checkInsWithEvent = await prisma.checkIn.findMany({
        where: { userId, event: { organizationId }, approved: true },
        include: { event: { select: { date: true } } },
        orderBy: { event: { date: "asc" } },
      });

      const hoursLogged = checkInsWithEvent.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
      const checkInCount = checkInsWithEvent.filter(
        (c) => c.status === "ON_TIME" || c.status === "LATE"
      ).length;
      const totalEvents = checkInsWithEvent.length;
      const attendancePercent = totalEvents > 0 ? (checkInCount / totalEvents) * 100 : 0;
      const { bestStreak } = computeStreaks(checkInsWithEvent);

      const stats: Record<string, number> = {
        hoursLogged,
        checkInCount,
        attendancePercent,
        bestStreak,
      };

      // Fetch already-persisted earned badges
      const existingEarned = await prisma.earnedBadge.findMany({
        where: { userId, organizationId },
        select: { badgeId: true, earnedAt: true },
      });
      const earnedMap = new Map(existingEarned.map((b) => [b.badgeId, b.earnedAt]));

      // Upsert newly earned badges
      const newlyEarned: string[] = [];
      for (const def of BADGE_DEFINITIONS) {
        const progress = stats[def.field] ?? 0;
        if (progress >= def.threshold && !earnedMap.has(def.id)) {
          await prisma.earnedBadge.upsert({
            where: { userId_organizationId_badgeId: { userId, organizationId, badgeId: def.id } },
            create: { userId, organizationId, badgeId: def.id },
            update: {},
          });
          newlyEarned.push(def.id);
          earnedMap.set(def.id, new Date());
        }
      }

      const badges = BADGE_DEFINITIONS.map((def) => {
        const progress = stats[def.field] ?? 0;
        const earnedAt = earnedMap.get(def.id);
        return {
          id: def.id,
          name: def.name,
          description: def.description,
          category: def.category,
          icon: def.icon,
          earned: progress >= def.threshold,
          earnedAt: earnedAt ? earnedAt.toISOString() : null,
          isNew: newlyEarned.includes(def.id),
          progress,
          threshold: def.threshold,
        };
      });

      return {
        badges,
        totalEarned: badges.filter((b) => b.earned).length,
      };
    },

    teamLeaderboard: async (
      _: unknown,
      { teamId, timeRange, limit }: { teamId: string; timeRange?: string; limit?: number }
    ) => {
      const members = await prisma.teamMember.findMany({
        where: { teamId, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } },
        include: {
          user: true,
          team: { include: { orgSeason: true } },
        },
      });

      // Use season date range instead of timeRange
      const team = members[0]?.team;
      const { start: startDate, end: endDate } = team?.orgSeason && team?.seasonYear
        ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
        : { start: new Date(0), end: new Date() }; // Fallback for legacy teams

      // Cap at today so future events don't inflate hoursRequired
      const now = new Date();
      const cappedEnd = new Date(Math.min(endDate.getTime(), now.getTime()));

      // Fetch all team events in the capped window — each member may have a different
      // active subset depending on their join/leave history
      const allTeamEvents = await prisma.event.findMany({
        where: {
          OR: [{ teamId }, { participatingTeams: { some: { id: teamId } } }],
          date: { gte: startDate, lte: cappedEnd },
          isAdHoc: false,
        },
        select: { id: true, date: true, startTime: true, endTime: true },
      });

      const leaderboard = await Promise.all(
        members.map(async (member) => {
          const historyRows = await prisma.teamMemberHistory.findMany({
            where: { userId: member.userId, teamId },
            orderBy: { joinedAt: "asc" },
          });
          const periods: MembershipPeriod[] = historyRows.length > 0
            ? historyRows
            : [{ joinedAt: startDate, leftAt: null }];

          const memberEvents = filterEventsByMembership(allTeamEvents, periods);
          const memberEventIds = memberEvents.map((e) => e.id);
          const hoursRequired = memberEvents.reduce(
            (sum, e) => sum + computeEventDuration(e.startTime, e.endTime), 0
          );

          const checkIns = await prisma.checkIn.findMany({
            where: {
              userId: member.userId,
              eventId: { in: memberEventIds },
              approved: true,
            },
          });

          const hoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
          const attendancePercent =
            hoursRequired > 0 ? Math.min(100, (hoursLogged / hoursRequired) * 100) : 0;

          return {
            user: member.user,
            hoursLogged,
            hoursRequired,
            attendancePercent,
          };
        })
      );

      // Sort by attendance percent descending
      leaderboard.sort((a, b) => b.attendancePercent - a.attendancePercent);

      return leaderboard.slice(0, limit || 10).map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));
    },

    organizationLeaderboard: async (
      _: unknown,
      { organizationId, timeRange, limit }: { organizationId: string; timeRange?: string; limit?: number }
    ) => {
      await requireTierFeature(organizationId, "advancedAnalytics");
      const members = await prisma.teamMember.findMany({
        where: { team: { organizationId }, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } },
        include: {
          user: true,
          team: { include: { orgSeason: true } },
        },
      });

      // Filter to only members of current-season teams
      const currentSeasonMembers = members.filter(m => isTeamInCurrentSeason(m.team));

      // Deduplicate users (they might be in multiple teams)
      const uniqueUsers = Array.from(new Map(currentSeasonMembers.map((m) => [m.userId, m])).values());

      const now = new Date();

      // For each unique user, compute per-team attendance and average across teams.
      // Users in multiple teams get an averaged rank rather than a pooled one.
      const leaderboard = await Promise.all(
        uniqueUsers.map(async (memberEntry) => {
          const userId = memberEntry.userId;

          // All team memberships this user has in current-season teams
          const userTeamMemberships = currentSeasonMembers.filter((m) => m.userId === userId);

          let totalHoursLogged = 0;
          let totalHoursRequired = 0;
          const teamAttendancePercents: number[] = [];

          for (const m of userTeamMemberships) {
            const tid = m.teamId;
            const { start: tStart, end: tEnd } = m.team?.orgSeason && m.team?.seasonYear
              ? getSeasonDateRange(m.team.orgSeason.startMonth, m.team.orgSeason.endMonth, m.team.seasonYear)
              : { start: new Date(0), end: new Date() };
            const tCappedEnd = new Date(Math.min(tEnd.getTime(), now.getTime()));

            const historyRows = await prisma.teamMemberHistory.findMany({
              where: { userId, teamId: tid },
              orderBy: { joinedAt: "asc" },
            });
            const periods: MembershipPeriod[] = historyRows.length > 0
              ? historyRows
              : [{ joinedAt: tStart, leftAt: null }];

            const teamEvents = await prisma.event.findMany({
              where: {
                OR: [{ teamId: tid }, { participatingTeams: { some: { id: tid } } }],
                date: { gte: tStart, lte: tCappedEnd },
                isAdHoc: false,
              },
              select: { id: true, date: true, startTime: true, endTime: true },
            });

            const memberEvents = filterEventsByMembership(teamEvents, periods);
            const teamHoursRequired = memberEvents.reduce(
              (sum, e) => sum + computeEventDuration(e.startTime, e.endTime), 0
            );

            const checkIns = await prisma.checkIn.findMany({
              where: {
                userId,
                eventId: { in: memberEvents.map((e) => e.id) },
                approved: true,
              },
            });
            const teamHoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);

            totalHoursLogged += teamHoursLogged;
            totalHoursRequired += teamHoursRequired;

            if (teamHoursRequired > 0) {
              teamAttendancePercents.push(
                Math.min(100, (teamHoursLogged / teamHoursRequired) * 100)
              );
            }
          }

          // Average attendance across teams; fall back to 0 if none had events yet
          const attendancePercent =
            teamAttendancePercents.length > 0
              ? teamAttendancePercents.reduce((s, p) => s + p, 0) / teamAttendancePercents.length
              : 0;

          return {
            user: memberEntry.user,
            hoursLogged: totalHoursLogged,
            hoursRequired: totalHoursRequired,
            attendancePercent,
          };
        })
      );

      leaderboard.sort((a, b) => b.attendancePercent - a.attendancePercent);

      return leaderboard.slice(0, limit || 10).map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));
    },

    teamRankings: async (
      _: unknown,
      { organizationId, timeRange }: { organizationId: string; timeRange?: string }
    ) => {
      await requireTierFeature(organizationId, "advancedAnalytics");
      const allTeams = await prisma.team.findMany({
        where: { organizationId, archivedAt: null },
        include: { members: { where: { role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } } }, orgSeason: true },
      });
      const teams = allTeams.filter(isTeamInCurrentSeason);

      const rankings = await Promise.all(
        teams.map(async (team) => {
          // Use season date range instead of timeRange
          const { start: startDate, end: endDate } = team.orgSeason && team.seasonYear
            ? getSeasonDateRange(team.orgSeason.startMonth, team.orgSeason.endMonth, team.seasonYear)
            : { start: new Date(0), end: new Date() }; // Fallback for legacy teams

          const athleteUserIds = team.members.map(m => m.userId);
          const checkIns = await prisma.checkIn.findMany({
            where: {
              event: { teamId: team.id },
              createdAt: { gte: startDate, lte: endDate },
              userId: { in: athleteUserIds },
              approved: true,
            },
          });

          const totalHoursLogged = checkIns.reduce((sum, c) => sum + (c.hoursLogged || 0), 0);
          const totalHoursRequired = team.members.reduce((sum, m) => sum + m.hoursRequired, 0);
          const attendancePercent =
            totalHoursRequired > 0 ? Math.min(100, (totalHoursLogged / totalHoursRequired) * 100) : 0;

          return {
            team,
            attendancePercent,
          };
        })
      );

      rankings.sort((a, b) => b.attendancePercent - a.attendancePercent);

      return rankings.map((entry, index) => ({
        ...entry,
        rank: index + 1,
      }));
    },

    attendanceTrends: async (
      _: unknown,
      { organizationId, teamId }: { organizationId: string; teamId?: string }
    ) => {
      await requireTierFeature(organizationId, "advancedAnalytics");
      // Resolve season date range from the org's active teams
      const teams = await prisma.team.findMany({
        where: { organizationId, archivedAt: null },
        include: { orgSeason: true },
      });
      const currentTeams = teams.filter(isTeamInCurrentSeason);

      const now = new Date();
      let startDate: Date;
      let endDate: Date;

      // Use the first current-season team's date range, or fall back to full year
      const referenceTeam = teamId
        ? currentTeams.find((t) => t.id === teamId) ?? currentTeams[0]
        : currentTeams[0];

      if (referenceTeam?.orgSeason && referenceTeam?.seasonYear) {
        const range = getSeasonDateRange(
          referenceTeam.orgSeason.startMonth,
          referenceTeam.orgSeason.endMonth,
          referenceTeam.seasonYear
        );
        startDate = range.start;
        endDate = range.end;
      } else {
        startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); // Jan 1 current year
        endDate = new Date(Date.UTC(now.getUTCFullYear(), 11, 31)); // Dec 31 current year
      }

      // Cap end at today so future events don't appear
      const cappedEnd = new Date(Math.min(endDate.getTime(), now.getTime()));

      // Fetch all non-adhoc events in range
      const eventWhere = teamId
        ? {
            organizationId,
            isAdHoc: false,
            date: { gte: startDate, lte: cappedEnd },
            OR: [
              { teamId },
              { participatingTeams: { some: { id: teamId } } },
            ],
          }
        : {
            organizationId,
            isAdHoc: false,
            date: { gte: startDate, lte: cappedEnd },
          };

      const events = await prisma.event.findMany({
        where: eventWhere,
        select: { id: true, date: true, startTime: true, endTime: true },
      });

      if (events.length === 0) return [];

      const eventIds = events.map((e) => e.id);

      // Fetch all approved check-ins for these events
      const checkIns = await prisma.checkIn.findMany({
        where: { eventId: { in: eventIds }, approved: true },
        select: { eventId: true, hoursLogged: true },
      });

      // Build a map: eventId → total hoursLogged from check-ins
      const checkInByEvent = new Map<string, number>();
      for (const c of checkIns) {
        checkInByEvent.set(c.eventId, (checkInByEvent.get(c.eventId) ?? 0) + (c.hoursLogged ?? 0));
      }

      // Group events by ISO week (Monday as week start)
      const weekMap = new Map<string, { hoursRequired: number; hoursLogged: number; eventsCount: number }>();
      for (const event of events) {
        const weekStart = toWeekStart(event.date);
        const duration = computeEventDuration(event.startTime, event.endTime);
        const logged = checkInByEvent.get(event.id) ?? 0;
        const existing = weekMap.get(weekStart);
        if (existing) {
          existing.hoursRequired += duration;
          existing.hoursLogged += logged;
          existing.eventsCount += 1;
        } else {
          weekMap.set(weekStart, { hoursRequired: duration, hoursLogged: logged, eventsCount: 1 });
        }
      }

      // Build and sort result
      const result = Array.from(weekMap.entries())
        .filter(([, w]) => w.eventsCount > 0)
        .map(([weekStart, w]) => ({
          weekStart,
          hoursRequired: w.hoursRequired,
          hoursLogged: w.hoursLogged,
          eventsCount: w.eventsCount,
          attendancePercent: w.hoursRequired > 0 ? Math.min(100, (w.hoursLogged / w.hoursRequired) * 100) : 0,
        }));

      result.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      return result;
    },

    recentActivity: async (
      _: unknown,
      { organizationId, teamId, limit }: { organizationId: string; teamId?: string; limit?: number },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: context.userId, team: { organizationId } },
        select: { teamId: true },
      });
      const teamIds = teamMemberships.map((m) => m.teamId);

      const teamFilter = teamId
        ? [
            { teamId },
            { participatingTeams: { some: { id: teamId } } },
          ]
        : [
            { teamId: { in: teamIds } },
            { participatingTeams: { some: { id: { in: teamIds } } } },
            { teamId: null },
          ];

      const checkIns = await prisma.checkIn.findMany({
        where: {
          event: {
            organizationId,
            OR: teamFilter,
          },
          approved: true,
          status: { not: "ABSENT" },
        },
        orderBy: { createdAt: "desc" },
        take: limit || 20,
        include: { user: true, event: true },
      });

      return checkIns.map((checkIn) => {
        let type = "check-in";
        if (checkIn.status === "EXCUSED") {
          type = "excused";
        } else if (checkIn.checkOutTime) {
          type = "check-out";
        }

        return {
          id: checkIn.id,
          user: checkIn.user,
          type,
          time: (checkIn.checkOutTime || checkIn.checkInTime)?.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }) || "",
          date: checkIn.createdAt.toISOString(),
          eventTitle: checkIn.event.title,
          eventType: checkIn.event.type,
        };
      });
    },

    coachMyHours: async (
      _: unknown,
      { organizationId, month, year }: { organizationId?: string; month: number; year: number },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);

      // Fetch check-ins — optionally scoped to one org, otherwise all orgs
      const checkIns = await prisma.checkIn.findMany({
        where: {
          userId: context.userId,
          event: {
            ...(organizationId ? { organizationId } : {}),
            date: { gte: startDate, lt: endDate },
          },
          status: { in: ["ON_TIME", "LATE"] as any[] },
        },
        include: { event: true },
        orderBy: { event: { date: "asc" } },
      });

      // Aggregate pay across all orgs represented in the check-ins
      const orgIds = organizationId
        ? [organizationId]
        : [...new Set(checkIns.map((c: any) => c.event.organizationId as string))];

      let grossPay = 0;
      let totalDeductions = 0;
      const appliedDeductions: { name: string; type: string; value: number; amount: number }[] = [];
      let firstHourlyRate: number | null = null;
      let firstSalaryAmount: number | null = null;

      await Promise.all(
        orgIds.map(async (orgId) => {
          const [membership, org] = await Promise.all([
            prisma.organizationMember.findUnique({
              where: { userId_organizationId: { userId: context.userId!, organizationId: orgId } },
            }),
            prisma.organization.findUnique({ where: { id: orgId } }),
          ]);

          const orgCheckIns = checkIns.filter((c: any) => c.event.organizationId === orgId);
          const orgHours = orgCheckIns.reduce((s: number, c: any) => s + (c.hoursLogged ?? 0), 0);
          const payrollConfig = (org?.payrollConfig as any) ?? {};
          const deductions: any[] = payrollConfig?.deductions ?? [];

          let orgGross = 0;
          if (membership?.salaryAmount != null) {
            orgGross = membership.salaryAmount;
            firstSalaryAmount = firstSalaryAmount ?? membership.salaryAmount;
          } else if (membership?.hourlyRate != null) {
            orgGross = Math.round(orgHours * membership.hourlyRate * 100) / 100;
            firstHourlyRate = firstHourlyRate ?? membership.hourlyRate;
          }

          grossPay += orgGross;

          for (const ded of deductions) {
            const amount =
              ded.type === "FLAT"
                ? ded.value
                : Math.round((orgGross * ded.value) / 100 * 100) / 100;
            totalDeductions += amount;
            appliedDeductions.push({ name: ded.name, type: ded.type, value: ded.value, amount });
          }
        })
      );

      const totalHours = checkIns.reduce((s: number, c: any) => s + (c.hoursLogged ?? 0), 0);
      const roundedGross = Math.round(grossPay * 100) / 100;
      const netPay = roundedGross > 0 ? Math.round((roundedGross - totalDeductions) * 100) / 100 : null;

      return {
        userId: context.userId,
        user: await prisma.user.findUnique({ where: { id: context.userId } }),
        totalHours: Math.round(totalHours * 100) / 100,
        totalPay: netPay,
        grossPay: roundedGross,
        netPay,
        hourlyRate: firstHourlyRate,
        salaryAmount: firstSalaryAmount,
        appliedDeductions,
        entries: checkIns.map((c: any) => ({
          event: c.event,
          checkIn: c,
          hoursLogged: c.hoursLogged ?? 0,
        })),
      };
    },

    orgCoachHours: async (
      _: unknown,
      { organizationId, month, year }: { organizationId: string; month: number; year: number },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const callerMembership = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: context.userId, organizationId } },
      });
      if (!callerMembership || !["OWNER", "ADMIN", "MANAGER"].includes(callerMembership.role)) {
        throw new Error("Not authorized");
      }
      await requireTierFeature(organizationId, "advancedReporting");

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);

      const [orgData, staffMembers] = await Promise.all([
        prisma.organization.findUnique({ where: { id: organizationId }, select: { payrollConfig: true } }),
        prisma.organizationMember.findMany({
          where: { organizationId, role: { in: ["OWNER", "ADMIN", "MANAGER", "COACH"] as OrgRole[] } },
          include: { user: true },
        }),
      ]);

      const payrollDeductions: any[] = (orgData?.payrollConfig as any)?.deductions ?? [];

      const coaches = await Promise.all(
        staffMembers.map(async (member: any) => {
          const checkIns = await prisma.checkIn.findMany({
            where: {
              userId: member.userId,
              event: { organizationId, date: { gte: startDate, lt: endDate } },
              status: { in: ["ON_TIME", "LATE"] },
            },
            include: { event: true },
            orderBy: { event: { date: "asc" } },
          });

          const totalHours = Math.round(checkIns.reduce((s: number, c: any) => s + (c.hoursLogged ?? 0), 0) * 100) / 100;
          const hourlyRate = member.hourlyRate ?? null;
          const salaryAmount = member.salaryAmount ?? null;
          // Salary takes priority over hourly when both are set
          const grossPay = salaryAmount != null
            ? Math.round(salaryAmount * 100) / 100
            : hourlyRate != null
              ? Math.round(totalHours * hourlyRate * 100) / 100
              : null;

          const appliedDeductions: any[] = [];
          let netPay = grossPay;
          if (grossPay != null) {
            for (const d of payrollDeductions) {
              const amount = d.type === "PERCENT"
                ? Math.round(grossPay * d.value / 100 * 100) / 100
                : Math.round(d.value * 100) / 100;
              netPay = Math.round(((netPay ?? 0) - amount) * 100) / 100;
              appliedDeductions.push({ name: d.name, type: d.type, value: d.value, amount });
            }
          }

          return {
            userId: member.userId,
            user: member.user,
            totalHours,
            totalPay: grossPay,
            grossPay,
            netPay,
            hourlyRate,
            salaryAmount,
            appliedDeductions,
            entries: checkIns.map((c: any) => ({
              event: c.event,
              checkIn: c,
              hoursLogged: c.hoursLogged ?? 0,
            })),
          };
        })
      );

      return { coaches, month, year };
    },
  },

  Mutation: {
    updateCoachHourlyRate: async (
      _: unknown,
      { organizationId, userId, hourlyRate }: { organizationId: string; userId: string; hourlyRate?: number | null },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");
      const viewer = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: context.userId, organizationId } },
      });
      if (!viewer || !["OWNER", "ADMIN", "MANAGER"].includes(viewer.role)) {
        throw new Error("Not authorized");
      }
      return prisma.organizationMember.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { hourlyRate: hourlyRate ?? null },
        include: { user: true },
      });
    },

    updateCoachPayRate: async (
      _: unknown,
      { organizationId, userId, hourlyRate, salaryAmount }: {
        organizationId: string; userId: string; hourlyRate?: number | null; salaryAmount?: number | null;
      },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");
      const viewer = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: context.userId, organizationId } },
      });
      if (!viewer || !["OWNER", "ADMIN", "MANAGER"].includes(viewer.role)) {
        throw new Error("Not authorized");
      }
      // Mutually exclusive: setting one clears the other
      const data: any = {};
      if (salaryAmount !== undefined) {
        data.salaryAmount = salaryAmount ?? null;
        data.hourlyRate = null; // clear hourly when salary is set
      } else if (hourlyRate !== undefined) {
        data.hourlyRate = hourlyRate ?? null;
        data.salaryAmount = null; // clear salary when hourly is set
      }
      return prisma.organizationMember.update({
        where: { userId_organizationId: { userId, organizationId } },
        data,
        include: { user: true },
      });
    },

    updatePayrollConfig: async (
      _: unknown,
      {
        organizationId,
        payPeriod,
        defaultHourlyRate,
        deductions,
      }: {
        organizationId: string;
        payPeriod?: string;
        defaultHourlyRate?: number | null;
        deductions?: Array<{ id?: string; name: string; type: string; value: number }>;
      },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");
      const viewer = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: context.userId, organizationId } },
      });
      if (!viewer || !["OWNER", "ADMIN"].includes(viewer.role)) {
        throw new Error("Not authorized");
      }
      // Merge with existing config to allow partial updates
      const existing = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { payrollConfig: true },
      });
      const prev: any = existing?.payrollConfig ?? {};
      const updated: any = { ...prev };
      if (payPeriod !== undefined) updated.payPeriod = payPeriod;
      if (defaultHourlyRate !== undefined) updated.defaultHourlyRate = defaultHourlyRate;
      if (deductions !== undefined) {
        updated.deductions = deductions.map((d, i) => ({
          id: d.id || `ded_${Date.now()}_${i}`,
          name: d.name,
          type: d.type,
          value: d.value,
        }));
      }
      return prisma.organization.update({
        where: { id: organizationId },
        data: { payrollConfig: updated },
      });
    },
  },
};
