import { prisma } from "../db.js";
import { TeamRole } from "@prisma/client";
import { parseTimeString } from "../utils/time.js";

// Event times (startTime / endTime) are stored as user-local timezone strings
// (e.g. "4:00 PM" meaning 4 PM EST), but the server runs in UTC.  Without
// persisting a timezone per event we cannot compute the exact UTC end instant.
// Adding TIMEZONE_BUFFER_HOURS ensures we never fire before the event has ended
// in the user's timezone.  10 h covers UTC-10 (Hawaii) through UTC+0 and gives
// a 2 h cushion for the most common North American timezones (ET–PT).
const TIMEZONE_BUFFER_HOURS = 10;

interface MarkAbsentOptions {
  /** Scope to a single organization (for manual mutation). Omit for all orgs (cron). */
  organizationId?: string;
  /**
   * How far back (in minutes) to look for event dates.
   * The query window is automatically widened by TIMEZONE_BUFFER_HOURS so that
   * events whose stored date falls within the window are not missed.
   * Defaults to 30.
   */
  lookbackMinutes?: number;
}

/**
 * Find recently-ended events and create ABSENT check-in records for athletes
 * and coaches who have no existing check-in. Uses skipDuplicates so
 * re-processing is safe.
 *
 * Timezone safety: the effective end-time threshold is
 *   eventDate (at stored endTime hours, treated as UTC) + TIMEZONE_BUFFER_HOURS
 * so a "4:00 PM" event is not processed until at least 02:00 UTC the next day,
 * guaranteeing the class has ended even for UTC-8 (Pacific) users.
 */
export async function markAbsentForEndedEvents(options?: MarkAbsentOptions): Promise<number> {
  const lookbackMinutes = options?.lookbackMinutes ?? 30;
  const now = new Date();

  // Widen the query window by the timezone buffer so events that need processing
  // tonight are not excluded because their noon-UTC date falls outside the
  // bare lookback window.
  const totalLookbackMs = (lookbackMinutes + TIMEZONE_BUFFER_HOURS * 60) * 60 * 1000;
  const lookbackDate = new Date(now.getTime() - totalLookbackMs);

  const events = await prisma.event.findMany({
    where: {
      isAdHoc: false,
      date: { gte: lookbackDate, lte: now },
      ...(options?.organizationId && { organizationId: options.organizationId }),
    },
    include: {
      participatingTeams: {
        include: {
          members: {
            where: { role: { in: ["MEMBER", "CAPTAIN", "COACH"] as TeamRole[] } },
            select: { userId: true, joinedAt: true },
          },
        },
      },
      team: {
        include: {
          members: {
            where: { role: { in: ["MEMBER", "CAPTAIN", "COACH"] as TeamRole[] } },
            select: { userId: true, joinedAt: true },
          },
        },
      },
    },
  });

  let totalCreated = 0;

  for (const event of events) {
    // Reconstruct the end instant: take the event's stored date, set the hours
    // and minutes from endTime (treated as UTC since server is UTC), then add
    // the timezone buffer so we don't fire before the class has ended in the
    // user's local timezone.
    const eventDate = new Date(event.date);
    const { hours, minutes } = parseTimeString(event.endTime);
    eventDate.setUTCHours(hours, minutes, 0, 0);
    const effectiveEndMs = eventDate.getTime() + TIMEZONE_BUFFER_HOURS * 60 * 60 * 1000;

    if (effectiveEndMs > now.getTime()) continue; // Class has not yet ended (timezone-safe)

    // Collect user IDs for athletes and coaches, excluding members who joined
    // after the event date (they weren't part of the team at event time).
    const userIds = new Set<string>();
    if (event.team) {
      for (const member of event.team.members) {
        if (member.joinedAt <= event.date) {
          userIds.add(member.userId);
        }
      }
    }
    for (const team of event.participatingTeams) {
      for (const member of team.members) {
        if (member.joinedAt <= event.date) {
          userIds.add(member.userId);
        }
      }
    }

    if (userIds.size === 0) continue;

    // Bulk create ABSENT records, skipping duplicates (unique constraint on userId_eventId)
    const result = await prisma.checkIn.createMany({
      data: Array.from(userIds).map((userId) => ({
        userId,
        eventId: event.id,
        status: "ABSENT" as const,
        hoursLogged: 0,
      })),
      skipDuplicates: true,
    });

    totalCreated += result.count;
  }

  return totalCreated;
}
