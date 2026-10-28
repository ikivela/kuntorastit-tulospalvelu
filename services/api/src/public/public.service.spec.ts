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

/** In-memory Prisma for registrations: one event, people by name, cards. */
function registrationStore({ registrationOpen }: { registrationOpen: boolean }) {
  const people: { id: string; firstName: string; lastName: string; clubId: string | null }[] = [];
  const registrations: { id: string; eventId: string; personId: string; status: string; courseId: string; paymentMethod: string; punchCardId: string | null; source?: string }[] = [];
  const cardLinks: { personId: string; punchCardId: string }[] = [];
  const tx = {
    club: { upsert: async ({ create }: { create: { name: string } }) => ({ id: `club-${create.name}` }) },
    person: {
      findFirst: async ({ where }: { where: { firstName: { equals: string }; lastName: { equals: string } } }) =>
        people.find((person) => person.firstName.toLowerCase() === where.firstName.equals.toLowerCase() && person.lastName.toLowerCase() === where.lastName.equals.toLowerCase()) ?? null,
      create: async ({ data }: { data: { firstName: string; lastName: string; clubId?: string } }) => { const person = { id: `person-${people.length + 1}`, clubId: data.clubId ?? null, ...data }; people.push(person); return person; },
      update: async ({ where, data }: { where: { id: string }; data: { clubId: string } }) => Object.assign(people.find((person) => person.id === where.id)!, data),
    },
    registration: {
      findUnique: async ({ where }: { where: { eventId_personId: { eventId: string; personId: string } } }) => registrations.find((item) => item.eventId === where.eventId_personId.eventId && item.personId === where.eventId_personId.personId) ?? null,
      create: async ({ data }: { data: { eventId: string; personId: string; courseId: string; paymentMethod: string; punchCardId?: string } }) => { const registration = { id: `registration-${registrations.length + 1}`, status: "ACTIVE", punchCardId: data.punchCardId ?? null, registeredAt: new Date(), ...data }; registrations.push(registration); return registration; },
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(registrations.find((item) => item.id === where.id)!, data),
    },
    punchCard: { upsert: async ({ create }: { create: { cardNumber: string } }) => ({ id: `card-${create.cardNumber}` }) },
    personPunchCard: {
      findFirst: async ({ where }: { where: { personId: string; punchCardId: string } }) => cardLinks.find((link) => link.personId === where.personId && link.punchCardId === where.punchCardId) ?? null,
      create: async ({ data }: { data: { personId: string; punchCardId: string } }) => { cardLinks.push(data); return data; },
    },
  };
  const prisma = {
    event: { findUnique: async () => ({ id: "event-1", status: "PUBLISHED", registrationOpen, paymentMethods: ["Käteinen", "MobilePay"], courses: [{ id: "course-a" }, { id: "course-b" }] }) },
    $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
  } as unknown as PrismaService;
  return { service: new PublicService(prisma), registrations, cardLinks };
}

const registration = { firstName: "Maija", lastName: "Meikäläinen", clubName: "KoS", courseId: "course-a", paymentMethod: "Käteinen" };

test("the web form needs registration open and refuses a second registration", async () => {
  await assert.rejects(registrationStore({ registrationOpen: false }).service.register("event-1", registration), /ei ole avoinna/);
  const { service, registrations } = registrationStore({ registrationOpen: true });
  await service.register("event-1", registration);
  assert.equal(registrations[0].source, "WEB");
  await assert.rejects(service.register("event-1", registration), /jo ilmoittautunut/);
});

test("the client's registration mode works without web registration and updates on resend", async () => {
  const { service, registrations, cardLinks } = registrationStore({ registrationOpen: false });
  await service.registerFromReader("event-1", { ...registration, punchingSystem: "EMIT", cardNumber: "512345" });
  const again = await service.registerFromReader("event-1", { ...registration, firstName: "maija", courseId: "course-b", paymentMethod: "MobilePay", punchingSystem: "EMIT", cardNumber: "512345" });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].courseId, "course-b");
  assert.equal(registrations[0].paymentMethod, "MobilePay");
  assert.equal(registrations[0].source, "EVENT");
  assert.equal(again.participant, "Maija Meikäläinen");
  assert.deepEqual(cardLinks, [{ personId: "person-1", punchCardId: "card-512345" }]);
});
