import assert from "node:assert/strict";
import test from "node:test";
import { PrismaService } from "../prisma/prisma.service.js";
import { PublicService, replaceEarlierResults } from "./public.service.js";

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
          eventSeries: { name: "Kuntorastit" },
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

  assert.equal(result[0]?.eventSeries, "Kuntorastit");
  assert.equal(result[0]?.events[0]?.attendanceCount, 225);
  assert.equal("_count" in (result[0]?.events[0] ?? {}), false);
  assert.deepEqual((receivedQuery as { where: unknown }).where, { year: 2026 });
});

function resultStore(results: { id: string; readAt: Date | null }[]) {
  const deleted: string[] = [];
  let query: unknown;
  const tx = {
    performance: {
      findMany: async (args: { where: unknown }) => { query = args.where; return results; },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => { deleted.push(...where.id.in); return { count: where.id.in.length }; },
    },
  } as unknown as Parameters<typeof replaceEarlierResults>[0];
  return { tx, deleted, query: () => query };
}

const key = { attendanceId: "attendance-1", courseId: "course-c", punchCardId: "card-545089" };

test("a newer read of the same card on the same course replaces the earlier result", async () => {
  const { tx, deleted, query } = resultStore([{ id: "earlier", readAt: new Date("2026-10-12T15:00:00Z") }]);
  assert.equal(await replaceEarlierResults(tx, key, new Date("2026-10-12T15:05:00Z")), null);
  assert.deepEqual(deleted, ["earlier"]);
  // Only the same person, course and card count: other courses or cards keep their results.
  assert.deepEqual(query(), key);
});

test("an older read sent late does not replace a newer result", async () => {
  const { tx, deleted } = resultStore([{ id: "newer", readAt: new Date("2026-10-12T15:05:00Z") }]);
  assert.equal(await replaceEarlierResults(tx, key, new Date("2026-10-12T15:00:00Z")), "newer");
  assert.deepEqual(deleted, []);
});

test("the first result with a key replaces nothing", async () => {
  const { tx, deleted } = resultStore([]);
  assert.equal(await replaceEarlierResults(tx, { ...key, punchCardId: null }, new Date("2026-10-12T15:00:00Z")), null);
  assert.deepEqual(deleted, []);
});
