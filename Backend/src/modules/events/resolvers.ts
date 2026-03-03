import { prisma } from "../../db.js";
import { EventType, RecurrenceFrequency, TeamRole } from "@prisma/client";
import { requireCoachOrAbove } from "../../utils/permissions.js";
import { validate, createEventInputSchema, updateEventInputSchema } from "../../utils/validate.js";
import { requireActiveSubscription } from "../../utils/permissions.js";
import { parseDateInput, toISO } from "../../utils/time.js";
import { generateRecurringDates } from "../../utils/recurrence.js";
import { parseTimeString } from "../../utils/time.js";
import type { Loaders } from "../../utils/dataLoaders.js";

interface Context {
  userId?: string;
  loaders: Loaders;
}

export const eventResolvers = {
  Query: {
    // Venue queries
    venue: async (_: unknown, { id }: { id: string }) => {
      return prisma.venue.findUnique({ where: { id } });
    },

    organizationVenues: async (_: unknown, { organizationId }: { organizationId: string }) => {
      return prisma.venue.findMany({
        where: { organizationId },
        orderBy: { name: "asc" },
      });
    },

    // Calendar export
    exportCalendar: async (
      _: unknown,
      { organizationId, teamId, startDate, endDate }: { organizationId: string; teamId?: string; startDate?: string; endDate?: string },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const events = await prisma.event.findMany({
        where: {
          organizationId,
          isAdHoc: false,
          ...(teamId && {
            OR: [
              { teamId },
              { participatingTeams: { some: { id: teamId } } },
            ],
          }),
          ...(startDate && endDate && {
            date: { gte: new Date(startDate), lte: new Date(endDate) },
          }),
        },
        include: { venue: true, team: true },
        orderBy: { date: "asc" },
      });

      // Helper: parse "6:00 PM" → { hours, minutes }
      function parseTime(timeStr: string): { h: number; m: number } {
        const match = timeStr?.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!match) return { h: 12, m: 0 };
        let h = parseInt(match[1]);
        const m = parseInt(match[2]);
        const ampm = match[3].toUpperCase();
        if (ampm === "PM" && h !== 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        return { h, m };
      }

      // Format Date + time to iCal datetime: YYYYMMDDTHHMMSSZ
      function toICalDate(date: Date, timeStr: string): string {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const { h, m } = parseTime(timeStr);
        const dt = new Date(Date.UTC(year, month, day, h, m, 0));
        return dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      }

      // Escape special iCal characters
      function escIcal(str: string): string {
        return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
      }

      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

      const vevents = events.map((e) => {
        const isAllDay = e.startTime === "All Day";
        let dtstart: string;
        let dtend: string;

        if (isAllDay) {
          const d = e.date;
          const y = d.getUTCFullYear();
          const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
          const da = String(d.getUTCDate()).padStart(2, "0");
          dtstart = `DTSTART;VALUE=DATE:${y}${mo}${da}`;
          const endD = e.endDate || e.date;
          const nextDay = new Date(endD);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const ey = nextDay.getUTCFullYear();
          const emo = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
          const eda = String(nextDay.getUTCDate()).padStart(2, "0");
          dtend = `DTEND;VALUE=DATE:${ey}${emo}${eda}`;
        } else {
          dtstart = `DTSTART:${toICalDate(e.date, e.startTime)}`;
          dtend = `DTEND:${toICalDate(e.endDate || e.date, e.endTime)}`;
        }

        const location = e.venue
          ? [e.venue.name, e.venue.address, e.venue.city, e.venue.country].filter(Boolean).join(", ")
          : e.location || "";

        const lines = [
          "BEGIN:VEVENT",
          `UID:event-${e.id}@athletiq.app`,
          `DTSTAMP:${stamp}`,
          dtstart,
          dtend,
          `SUMMARY:${escIcal(e.title)}`,
          ...(location ? [`LOCATION:${escIcal(location)}`] : []),
          ...(e.description ? [`DESCRIPTION:${escIcal(e.description)}`] : []),
          "END:VEVENT",
        ];
        return lines.join("\r\n");
      });

      return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AthletiQ//Events//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        ...vevents,
        "END:VCALENDAR",
      ].join("\r\n");
    },

    // Event queries
    event: async (_: unknown, { id }: { id: string }) => {
      return prisma.event.findUnique({ where: { id } });
    },

    events: async (
      _: unknown,
      { organizationId, type, teamId, startDate, endDate, limit, offset }: {
        organizationId: string;
        type?: string;
        teamId?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
        offset?: number;
      },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: context.userId, team: { organizationId } },
        select: { teamId: true },
      });
      const userTeamIds = teamMemberships.map((m) => m.teamId);

      // If a specific teamId filter is requested, scope to that team only
      const teamFilter = teamId
        ? [
            { teamId },
            { participatingTeams: { some: { id: teamId } } },
          ]
        : [
            { teamId: { in: userTeamIds } },
            { participatingTeams: { some: { id: { in: userTeamIds } } } },
            { teamId: null },
          ];

      return prisma.event.findMany({
        where: {
          organizationId,
          isAdHoc: false,
          ...(type && { type: type as any }),
          OR: teamFilter,
          ...(startDate && endDate && {
            date: { gte: new Date(startDate), lte: new Date(endDate) },
          }),
        },
        orderBy: { date: "desc" },
        ...(limit !== undefined && { take: limit }),
        ...(offset !== undefined && { skip: offset }),
      });
    },

    eventsCount: async (
      _: unknown,
      { organizationId, teamId }: { organizationId: string; teamId?: string },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const teamMemberships = await prisma.teamMember.findMany({
        where: { userId: context.userId, team: { organizationId } },
        select: { teamId: true },
      });
      const userTeamIds = teamMemberships.map((m) => m.teamId);

      const teamFilter = teamId
        ? [
            { teamId },
            { participatingTeams: { some: { id: teamId } } },
          ]
        : [
            { teamId: { in: userTeamIds } },
            { participatingTeams: { some: { id: { in: userTeamIds } } } },
            { teamId: null },
          ];

      const baseWhere = { organizationId, isAdHoc: false, OR: teamFilter };

      const [practice, meeting, event] = await Promise.all([
        prisma.event.count({ where: { ...baseWhere, type: "PRACTICE" } }),
        prisma.event.count({ where: { ...baseWhere, type: "MEETING" } }),
        prisma.event.count({ where: { ...baseWhere, type: "EVENT" } }),
      ]);

      return { PRACTICE: practice, MEETING: meeting, EVENT: event };
    },

    upcomingEvents: async (
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

      return prisma.event.findMany({
        where: {
          organizationId,
          isAdHoc: false,
          date: { gte: new Date() },
          OR: teamFilter,
        },
        orderBy: { date: "asc" },
        take: limit || 10,
      });
    },

    // Recurring event queries
    recurringEvent: async (_: unknown, { id }: { id: string }) => {
      return prisma.recurringEvent.findUnique({ where: { id } });
    },

    recurringEvents: async (_: unknown, { organizationId }: { organizationId: string }) => {
      return prisma.recurringEvent.findMany({
        where: { organizationId },
        orderBy: { startDate: "desc" },
      });
    },
  },

  Mutation: {
    // Venue mutations
    createVenue: async (
      _: unknown,
      { input }: { input: { name: string; address?: string; city?: string; state?: string; country?: string; notes?: string; organizationId: string } }
    ) => {
      return prisma.venue.create({ data: input });
    },

    updateVenue: async (
      _: unknown,
      { id, input }: { id: string; input: { name?: string; address?: string; city?: string; state?: string; country?: string; notes?: string } }
    ) => {
      return prisma.venue.update({ where: { id }, data: input });
    },

    deleteVenue: async (_: unknown, { id }: { id: string }) => {
      // Unlink venue from events first, then delete
      await prisma.event.updateMany({ where: { venueId: id }, data: { venueId: null } });
      await prisma.recurringEvent.updateMany({ where: { venueId: id }, data: { venueId: null } });
      await prisma.venue.delete({ where: { id } });
      return true;
    },

    // Event mutations
    createEvent: async (
      _: unknown,
      {
        input,
      }: {
        input: {
          title: string;
          type: EventType;
          date: string;
          endDate?: string;
          startTime: string;
          endTime: string;
          location?: string;
          description?: string;
          organizationId: string;
          teamId?: string;
          venueId?: string;
          participatingTeamIds?: string[];
        };
      },
      context: { userId?: string }
    ) => {
      await requireCoachOrAbove(context, input.organizationId);
      await requireActiveSubscription(input.organizationId);
      validate(createEventInputSchema, input);
      const { participatingTeamIds, endDate, ...eventData } = input;
      return prisma.event.create({
        data: {
          ...eventData,
          date: parseDateInput(input.date),
          ...(endDate && { endDate: parseDateInput(endDate) }),
          ...(participatingTeamIds && participatingTeamIds.length > 0 && {
            participatingTeams: {
              connect: participatingTeamIds.map((id) => ({ id })),
            },
          }),
        },
      });
    },

    updateEvent: async (
      _: unknown,
      {
        id,
        title,
        type,
        date,
        endDate,
        startTime,
        endTime,
        location,
        description,
        venueId,
      }: {
        id: string;
        title?: string;
        type?: EventType;
        date?: string;
        endDate?: string | null;
        startTime?: string;
        endTime?: string;
        location?: string;
        description?: string;
        venueId?: string | null;
      },
      context: { userId?: string }
    ) => {
      const event = await prisma.event.findUnique({ where: { id }, select: { organizationId: true } });
      if (event) await requireCoachOrAbove(context, event.organizationId);
      validate(updateEventInputSchema, { title, type, date, startTime, endTime, location, description, venueId: venueId ?? undefined });
      return prisma.event.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(type && { type }),
          ...(date && { date: parseDateInput(date) }),
          ...(endDate !== undefined && { endDate: endDate ? parseDateInput(endDate) : null }),
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
          ...(location !== undefined && { location }),
          ...(description !== undefined && { description }),
          ...(venueId !== undefined && { venueId: venueId || null }),
        },
      });
    },

    deleteEvent: async (_: unknown, { id }: { id: string }, context: { userId?: string }) => {
      const event = await prisma.event.findUnique({ where: { id }, select: { organizationId: true } });
      if (event) await requireCoachOrAbove(context, event.organizationId);
      await prisma.$transaction(async (tx) => {
        await tx.checkIn.deleteMany({ where: { eventId: id } });
        await tx.excuseRequest.deleteMany({ where: { eventId: id } });
        await tx.eventRsvp.deleteMany({ where: { eventId: id } });
        await tx.event.delete({ where: { id } });
      });
      return true;
    },

    // Recurring event mutations
    createRecurringEvent: async (
      _: unknown,
      {
        input,
      }: {
        input: {
          title: string;
          type: EventType;
          startTime: string;
          endTime: string;
          location?: string;
          description?: string;
          frequency: RecurrenceFrequency;
          daysOfWeek?: number[];
          startDate: string;
          endDate: string;
          organizationId: string;
          teamId?: string;
          venueId?: string;
          includedUserIds?: string[];
          excludedUserIds?: string[];
        };
      }
    ) => {
      const start = parseDateInput(input.startDate);
      const end = parseDateInput(input.endDate);

      if (end <= start) {
        throw new Error("End date must be after start date");
      }

      if (
        (input.frequency === "WEEKLY" || input.frequency === "BIWEEKLY") &&
        (!input.daysOfWeek || input.daysOfWeek.length === 0)
      ) {
        throw new Error("daysOfWeek is required for WEEKLY and BIWEEKLY frequencies");
      }

      const dates = generateRecurringDates(start, end, input.frequency, input.daysOfWeek || []);

      if (dates.length === 0) {
        throw new Error("No event occurrences generated for the given parameters");
      }
      if (dates.length > 365) {
        throw new Error("Too many occurrences (max 365). Please shorten the date range.");
      }

      const recurringEvent = await prisma.$transaction(async (tx) => {
        const re = await tx.recurringEvent.create({
          data: {
            title: input.title,
            type: input.type,
            startTime: input.startTime,
            endTime: input.endTime,
            location: input.location,
            description: input.description,
            frequency: input.frequency,
            daysOfWeek: input.daysOfWeek || [],
            startDate: start,
            endDate: end,
            organizationId: input.organizationId,
            teamId: input.teamId,
            venueId: input.venueId,
          },
        });

        await tx.event.createMany({
          data: dates.map((date) => ({
            title: input.title,
            type: input.type,
            date,
            startTime: input.startTime,
            endTime: input.endTime,
            location: input.location,
            description: input.description,
            organizationId: input.organizationId,
            teamId: input.teamId,
            venueId: input.venueId,
            recurringEventId: re.id,
          })),
        });

        if (input.includedUserIds?.length) {
          await tx.recurringEventAthleteInclude.createMany({
            data: input.includedUserIds.map((userId: string) => ({ recurringEventId: re.id, userId })),
            skipDuplicates: true,
          });
        }
        if (input.excludedUserIds?.length) {
          await tx.recurringEventAthleteExclude.createMany({
            data: input.excludedUserIds.map((userId: string) => ({ recurringEventId: re.id, userId })),
            skipDuplicates: true,
          });
        }

        return re;
      });

      return recurringEvent;
    },

    deleteRecurringEvent: async (_: unknown, { id, futureOnly }: { id: string; futureOnly?: boolean }) => {
      await prisma.$transaction(async (tx) => {
        const now = new Date();

        if (futureOnly) {
          // Preserve past events by detaching them from the recurring series
          await tx.event.updateMany({
            where: { recurringEventId: id, date: { lt: now } },
            data: { recurringEventId: null },
          });
        }

        const eventIds = (
          await tx.event.findMany({
            where: { recurringEventId: id },
            select: { id: true },
          })
        ).map((e) => e.id);

        await tx.checkIn.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.excuseRequest.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.eventRsvp.deleteMany({ where: { eventId: { in: eventIds } } });
        await tx.event.deleteMany({ where: { recurringEventId: id } });
        await tx.recurringEvent.delete({ where: { id } });
      });
      return true;
    },

    // Athlete include/exclude mutations
    addAthleteToEvent: async (_: unknown, { eventId, userId }: { eventId: string; userId: string }) => {
      await prisma.eventAthleteInclude.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId },
        update: {},
      });
      await prisma.eventAthleteExclude.deleteMany({ where: { eventId, userId } });
      return prisma.event.findUnique({ where: { id: eventId } });
    },

    removeAthleteFromEvent: async (_: unknown, { eventId, userId }: { eventId: string; userId: string }) => {
      await prisma.eventAthleteInclude.deleteMany({ where: { eventId, userId } });
      return prisma.event.findUnique({ where: { id: eventId } });
    },

    excludeAthleteFromEvent: async (_: unknown, { eventId, userId }: { eventId: string; userId: string }) => {
      await prisma.eventAthleteExclude.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId },
        update: {},
      });
      await prisma.eventAthleteInclude.deleteMany({ where: { eventId, userId } });
      return prisma.event.findUnique({ where: { id: eventId } });
    },

    unexcludeAthleteFromEvent: async (_: unknown, { eventId, userId }: { eventId: string; userId: string }) => {
      await prisma.eventAthleteExclude.deleteMany({ where: { eventId, userId } });
      return prisma.event.findUnique({ where: { id: eventId } });
    },

    // Recurring event athlete include/exclude mutations
    addAthleteToRecurringEvent: async (_: unknown, { recurringEventId, userId }: { recurringEventId: string; userId: string }) => {
      await prisma.recurringEventAthleteInclude.upsert({
        where: { recurringEventId_userId: { recurringEventId, userId } },
        create: { recurringEventId, userId },
        update: {},
      });
      await prisma.recurringEventAthleteExclude.deleteMany({ where: { recurringEventId, userId } });
      return prisma.recurringEvent.findUnique({ where: { id: recurringEventId } });
    },

    removeAthleteFromRecurringEvent: async (_: unknown, { recurringEventId, userId }: { recurringEventId: string; userId: string }) => {
      await prisma.recurringEventAthleteInclude.deleteMany({ where: { recurringEventId, userId } });
      return prisma.recurringEvent.findUnique({ where: { id: recurringEventId } });
    },

    excludeAthleteFromRecurringEvent: async (_: unknown, { recurringEventId, userId }: { recurringEventId: string; userId: string }) => {
      await prisma.recurringEventAthleteExclude.upsert({
        where: { recurringEventId_userId: { recurringEventId, userId } },
        create: { recurringEventId, userId },
        update: {},
      });
      await prisma.recurringEventAthleteInclude.deleteMany({ where: { recurringEventId, userId } });
      return prisma.recurringEvent.findUnique({ where: { id: recurringEventId } });
    },

    unexcludeAthleteFromRecurringEvent: async (_: unknown, { recurringEventId, userId }: { recurringEventId: string; userId: string }) => {
      await prisma.recurringEventAthleteExclude.deleteMany({ where: { recurringEventId, userId } });
      return prisma.recurringEvent.findUnique({ where: { id: recurringEventId } });
    },
  },

  Venue: {
    createdAt: (parent: any) => toISO(parent.createdAt),
    updatedAt: (parent: any) => toISO(parent.updatedAt),
  },

  Event: {
    organization: (parent: { organizationId: string }, _: unknown, context: Context) =>
      context.loaders.organization.load(parent.organizationId),
    team: (parent: { teamId: string | null }, _: unknown, context: Context) =>
      parent.teamId ? context.loaders.team.load(parent.teamId) : null,
    venue: (parent: { venueId: string | null }, _: unknown, context: Context) =>
      parent.venueId ? context.loaders.venue.load(parent.venueId) : null,
    checkIns: (parent: { id: string }) => prisma.checkIn.findMany({ where: { eventId: parent.id } }),
    rsvps: (parent: { id: string }) => prisma.eventRsvp.findMany({ where: { eventId: parent.id }, include: { user: true } }),
    recurringEvent: (parent: { recurringEventId: string | null }) =>
      parent.recurringEventId
        ? prisma.recurringEvent.findUnique({ where: { id: parent.recurringEventId } })
        : null,
    participatingTeams: (parent: { id: string }) =>
      prisma.team.findMany({
        where: { participatingEvents: { some: { id: parent.id } } },
      }),
    includedAthletes: async (parent: { id: string; recurringEventId?: string | null }) => {
      const eventRows = await prisma.eventAthleteInclude.findMany({
        where: { eventId: parent.id },
        include: { user: true },
      });
      const eventUserIds = new Set(eventRows.map(r => r.userId));
      let inherited: any[] = [];
      if (parent.recurringEventId) {
        const reRows = await prisma.recurringEventAthleteInclude.findMany({
          where: { recurringEventId: parent.recurringEventId },
          include: { user: true },
        });
        inherited = reRows.filter(r => !eventUserIds.has(r.userId)).map(r => r.user);
      }
      return [...eventRows.map(r => r.user), ...inherited];
    },
    excludedAthletes: async (parent: { id: string; recurringEventId?: string | null }) => {
      const eventRows = await prisma.eventAthleteExclude.findMany({
        where: { eventId: parent.id },
        include: { user: true },
      });
      const eventUserIds = new Set(eventRows.map(r => r.userId));
      let inherited: any[] = [];
      if (parent.recurringEventId) {
        const reRows = await prisma.recurringEventAthleteExclude.findMany({
          where: { recurringEventId: parent.recurringEventId },
          include: { user: true },
        });
        inherited = reRows.filter(r => !eventUserIds.has(r.userId)).map(r => r.user);
      }
      return [...eventRows.map(r => r.user), ...inherited];
    },
    date: (parent: any) => toISO(parent.date),
    endDate: (parent: any) => parent.endDate ? toISO(parent.endDate) : null,
    createdAt: (parent: any) => toISO(parent.createdAt),
    updatedAt: (parent: any) => toISO(parent.updatedAt),
  },

  RecurringEvent: {
    organization: (parent: { organizationId: string }, _: unknown, context: Context) =>
      context.loaders.organization.load(parent.organizationId),
    team: (parent: { teamId: string | null }, _: unknown, context: Context) =>
      parent.teamId ? context.loaders.team.load(parent.teamId) : null,
    venue: (parent: { venueId: string | null }, _: unknown, context: Context) =>
      parent.venueId ? context.loaders.venue.load(parent.venueId) : null,
    events: (parent: { id: string }) =>
      prisma.event.findMany({ where: { recurringEventId: parent.id }, orderBy: { date: "asc" } }),
    includedAthletes: (parent: { id: string }) =>
      prisma.recurringEventAthleteInclude.findMany({
        where: { recurringEventId: parent.id },
        include: { user: true },
      }).then(rows => rows.map(r => r.user)),
    excludedAthletes: (parent: { id: string }) =>
      prisma.recurringEventAthleteExclude.findMany({
        where: { recurringEventId: parent.id },
        include: { user: true },
      }).then(rows => rows.map(r => r.user)),
    startDate: (parent: any) => toISO(parent.startDate),
    endDate: (parent: any) => toISO(parent.endDate),
    createdAt: (parent: any) => toISO(parent.createdAt),
    updatedAt: (parent: any) => toISO(parent.updatedAt),
  },
};
