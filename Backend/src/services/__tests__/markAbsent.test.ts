import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../db.js";
import { markAbsentForEndedEvents } from "../markAbsent.js";

vi.mock("../../db.js");

const mockPrisma = vi.mocked(prisma);

// Helper: build a fake event whose endTime is `hoursFromNow` hours from now
// (negative = in the past, positive = in the future) relative to UTC.
function makeEvent(endHoursFromNow: number, startTime = "9:00 AM") {
  const now = new Date();

  // Build the endTime string that, when parsed by parseTimeString and applied
  // with setUTCHours, lands at `now + endHoursFromNow` hours.
  const endUtc = new Date(now.getTime() + endHoursFromNow * 3600000);
  const h = endUtc.getUTCHours();
  const m = endUtc.getUTCMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  const endTimeStr = `${displayH}:${m.toString().padStart(2, "0")} ${period}`;

  // Store the event date as noon UTC on the event day (matches parseDateInput behaviour)
  const eventDate = new Date(endUtc);
  eventDate.setUTCHours(12, 0, 0, 0);

  return {
    id: "event-1",
    date: eventDate,
    startTime,
    endTime: endTimeStr,
    isAdHoc: false,
    team: {
      members: [
        { userId: "user-1", joinedAt: new Date(eventDate.getTime() - 86400000) },
        { userId: "user-2", joinedAt: new Date(eventDate.getTime() - 86400000) },
      ],
    },
    participatingTeams: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma.checkIn.createMany as any) = vi.fn().mockResolvedValue({ count: 0 });
});

describe("markAbsentForEndedEvents — timezone-safe end-time check", () => {
  it("does NOT mark absent when event end time + buffer is still in the future", async () => {
    // Event ends 5 hours from now (UTC). With 10h buffer, effective end = 15h from now → skip.
    const event = makeEvent(5);
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);

    const count = await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    expect(count).toBe(0);
    expect(mockPrisma.checkIn.createMany).not.toHaveBeenCalled();
  });

  it("does NOT mark absent when event just ended (within timezone buffer)", async () => {
    // Event ended 2 hours ago (UTC). Buffer is 10h, so effective end = 8h from now → skip.
    const event = makeEvent(-2);
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);

    const count = await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    expect(count).toBe(0);
    expect(mockPrisma.checkIn.createMany).not.toHaveBeenCalled();
  });

  it("does NOT mark absent when event ended exactly at buffer boundary", async () => {
    // Effective end = endTime_UTC + 10h. If endTime was exactly 10h ago, effectiveEnd = now → skip.
    const event = makeEvent(-10);
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);

    const count = await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    expect(count).toBe(0);
  });

  it("DOES mark absent when event ended well past the timezone buffer", async () => {
    // Event ended 12 hours ago (UTC). Effective end = 2 hours ago → process.
    const event = makeEvent(-12);
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);
    (mockPrisma.checkIn.createMany as any) = vi.fn().mockResolvedValue({ count: 2 });

    const count = await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    expect(count).toBe(2);
    expect(mockPrisma.checkIn.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: "user-1", status: "ABSENT", hoursLogged: 0 }),
          expect.objectContaining({ userId: "user-2", status: "ABSENT", hoursLogged: 0 }),
        ]),
        skipDuplicates: true,
      })
    );
  });

  it("skips members who joined after the event date", async () => {
    // Event ended 12h ago; one member joined after the event.
    const event = makeEvent(-12);
    const futureJoin = new Date(event.date.getTime() + 86400000); // joined tomorrow relative to event
    event.team!.members[1].joinedAt = futureJoin;
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);
    (mockPrisma.checkIn.createMany as any) = vi.fn().mockResolvedValue({ count: 1 });

    await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    const callArgs = (mockPrisma.checkIn.createMany as any).mock.calls[0][0];
    expect(callArgs.data).toHaveLength(1);
    expect(callArgs.data[0].userId).toBe("user-1");
  });

  it("skips events with no team members", async () => {
    const event = makeEvent(-12);
    event.team!.members = [];
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);

    const count = await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    expect(count).toBe(0);
    expect(mockPrisma.checkIn.createMany).not.toHaveBeenCalled();
  });

  it("processes members from participatingTeams as well", async () => {
    const event = makeEvent(-12);
    event.team = null as any;
    event.participatingTeams = [
      {
        members: [
          { userId: "user-3", joinedAt: new Date(event.date.getTime() - 86400000) },
        ],
      },
    ] as any;
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([event]);
    (mockPrisma.checkIn.createMany as any) = vi.fn().mockResolvedValue({ count: 1 });

    const count = await markAbsentForEndedEvents({ lookbackMinutes: 30 });
    expect(count).toBe(1);
  });

  it("skips ad-hoc events (handled by query filter)", async () => {
    // The DB query filters isAdHoc: false — simulate the filter returning nothing.
    (mockPrisma.event.findMany as any) = vi.fn().mockResolvedValue([]);

    const count = await markAbsentForEndedEvents();
    expect(count).toBe(0);
  });
});
