import assert from "node:assert/strict";
import test from "node:test";
import { PrismaService } from "../prisma/prisma.service.js";
import { PublicService } from "./public.service.js";

test("calendar returns public events with attendance counts", async () => {
  let receivedQuery: unknown;
  const prisma = {
    season: {
      findMany: async (query: unknown) => {
        receivedQuery = query;
        return [{
          id: "season-1",
          name: "Kausi 2026",
          year: 2026,
          eventSeries: { name: "Kokkolan Maanantairastit" },
          rewards: [],
          events: [{
            id: "event-1",
            name: "Karhi, Lohtaja",
            startsAt: new Date("2026-08-24T14:00:00.000Z"),
            endsAt: new Date("2026-08-29T16:00:00.000Z"),
            courses: [],
            _count: { attendances: 225 },
          }],
        }];
      },
    },
  } as unknown as PrismaService;

  const result = await new PublicService(prisma).calendar(2026);

  assert.equal(result[0]?.eventSeries, "Kokkolan Maanantairastit");
  assert.equal(result[0]?.events[0]?.attendanceCount, 225);
  assert.equal("_count" in (result[0]?.events[0] ?? {}), false);
  assert.deepEqual((receivedQuery as { where: unknown }).where, { year: 2026 });
});
