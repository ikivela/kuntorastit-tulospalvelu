/** Deletes an event's participants and results, keeping the event itself
 * (courses, settings) so it can be read again from scratch.
 *
 *   node dist/src/scripts/delete-event-results.js --event <id>           # dry run: counts only
 *   node dist/src/scripts/delete-event-results.js --event <id> --apply   # delete
 *   --include-registrations  also deletes the event's registrations (the
 *                            online sign-ups and the ones card reads create)
 *
 * Deleted: results (performance) with their punches, card reads with their
 * raw data, and attendances (the season's attendance counts come from these).
 * Persons and EMIT cards are kept: they belong to other events too.
 * Results a pc-client has not sent yet, or edits of sent ones, will still
 * reach the server afterwards. */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeRegistrations = args.includes("--include-registrations");
const eventId = args.includes("--event") ? args[args.indexOf("--event") + 1] : undefined;
if (!eventId || eventId.startsWith("--")) {
  console.error("Anna tapahtuman id: --event <id>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is required"); process.exit(1); }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true, startsAt: true } });
  if (!event) { console.error(`Tapahtumaa ${eventId} ei löytynyt.`); process.exitCode = 1; return; }
  const [performances, punches, cardReads, attendances, registrations] = await Promise.all([
    prisma.performance.count({ where: { attendance: { eventId } } }),
    prisma.punch.count({ where: { performance: { attendance: { eventId } } } }),
    prisma.cardRead.count({ where: { eventId } }),
    prisma.attendance.count({ where: { eventId } }),
    prisma.registration.count({ where: { eventId } }),
  ]);
  console.log(`Tapahtuma: ${event.name} (${event.startsAt.toLocaleDateString("fi-FI")})`);
  console.log(`  tuloksia ${performances} (leimoja ${punches})`);
  console.log(`  korttiluentoja ${cardReads}`);
  console.log(`  osallistumisia ${attendances}`);
  console.log(`  ilmoittautumisia ${registrations}${includeRegistrations ? "" : " (säilytetään; poista lipulla --include-registrations)"}`);
  if (!apply) { console.log("\nKuivaharjoitus: mitään ei poistettu. Aja --apply poistaaksesi."); return; }

  await prisma.$transaction([
    // Punches go with their results (onDelete: Cascade).
    prisma.performance.deleteMany({ where: { attendance: { eventId } } }),
    prisma.cardRead.deleteMany({ where: { eventId } }),
    prisma.attendance.deleteMany({ where: { eventId } }),
    ...(includeRegistrations ? [prisma.registration.deleteMany({ where: { eventId } })] : []),
  ]);
  console.log(`\nPoistettu ${performances} tulosta, ${cardReads} korttiluentaa ja ${attendances} osallistumista${includeRegistrations ? ` sekä ${registrations} ilmoittautumista` : ""}.`);
}

main().finally(() => prisma.$disconnect());
