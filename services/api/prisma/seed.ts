import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL ??
  "postgresql://kuntorastit:kuntorastit@localhost:5432/kuntorastit";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ids = {
  admin: "00000000-0000-4000-8000-000000000000",
  series: "00000000-0000-4000-8000-000000000001",
  season: "00000000-0000-4000-8000-000000000002",
  event: "00000000-0000-4000-8000-000000000003",
};

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  await prisma.adminUser.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      id: ids.admin,
      username: "admin",
      passwordHash: hashPassword("mara2026"),
      role: "ADMIN",
    },
  });

  await prisma.eventSeries.upsert({
    where: { id: ids.series },
    update: { name: "KoS-Kuntorastit" },
    create: { id: ids.series, name: "KoS-Kuntorastit" },
  });

  await prisma.season.upsert({
    where: { id: ids.season },
    update: { name: "Kausi 2026" },
    create: {
      id: ids.season,
      eventSeriesId: ids.series,
      name: "Kausi 2026",
      year: 2026,
      startsAt: new Date("2026-04-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-31T00:00:00.000Z"),
    },
  });

  await prisma.event.upsert({
    where: { id: ids.event },
    update: {},
    create: {
      id: ids.event,
      seasonId: ids.season,
      name: "Karhi, Lohtaja",
      locationName: "Karhi",
      address: "Ojalantie, nuorisoseurantalo",
      startsAt: new Date("2026-08-24T14:00:00.000Z"),
      endsAt: new Date("2026-08-29T16:00:00.000Z"),
      status: "PUBLISHED",
      registrationOpen: true,
    },
  });

  const courses = [
    ["A-rata", 5300], ["B-rata", 4000], ["C-rata", 1900],
    ["D-rata", 1400], ["E-rata", 6600],
  ] as const;
  for (const [index, [name, lengthMeters]] of courses.entries()) {
    await prisma.course.upsert({
      where: { eventId_name: { eventId: ids.event, name } },
      update: { lengthMeters, sortOrder: index + 1 },
      create: { eventId: ids.event, name, lengthMeters, sortOrder: index + 1 },
    });
  }

  await prisma.rewardThreshold.upsert({
    where: { seasonId_requiredAttendances: { seasonId: ids.season, requiredAttendances: 15 } },
    update: { name: "15 kerran tavoitepalkinto" },
    create: {
      seasonId: ids.season,
      name: "15 kerran tavoitepalkinto",
      requiredAttendances: 15,
      sortOrder: 1,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
