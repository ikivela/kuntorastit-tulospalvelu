/** Recomputes stored EMIT results from the punches each card read kept
 * (CardRead.rawData). Earlier API versions summed the punch times as if they
 * were leg times, although EMIT stores seconds from the start, so result
 * times, start/finish times and split times were wrong; and the clients
 * flagged extra punches (finish/readout unit) as wrong controls, so a
 * completed course could be confirmed as disqualified.
 *
 *   node dist/src/scripts/recompute-reader-times.js                 # dry run: report only
 *   node dist/src/scripts/recompute-reader-times.js --apply         # fix times
 *   node dist/src/scripts/recompute-reader-times.js --apply --fix-status
 *       # also accept results confirmed as disqualified / missing control
 *       # whose card does contain every course control in order
 *   --event <id>  limits to one event
 *
 * Results without time (NO_TIME, DID_NOT_FINISH) keep their nulls. */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { cardTiming, type TimedPunch, withoutReadoutPunch } from "../public/emit-timing.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fixStatus = args.includes("--fix-status");
const eventId = args.includes("--event") ? args[args.indexOf("--event") + 1] : undefined;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error("DATABASE_URL is required"); process.exit(1); }
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function formatMs(ms: bigint | number | null) {
  if (ms == null) return "–";
  const total = Math.round(Number(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const mmss = `${String(Math.floor((total % 3600) / 60)).padStart(hours ? 2 : 1, "0")}:${String(total % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${mmss}` : mmss;
}

async function main() {
  const reads = await prisma.cardRead.findMany({
    where: { performanceId: { not: null }, ...(eventId ? { eventId } : {}) },
    orderBy: { readAt: "asc" },
    include: {
      event: { select: { name: true } },
      performance: {
        include: {
          attendance: { select: { person: { select: { firstName: true, lastName: true } } } },
          course: { select: { name: true, controls: { orderBy: { sequenceNumber: "asc" }, include: { control: true } } } },
        },
      },
    },
  });
  let timeChanges = 0;
  let statusChanges = 0;
  for (const read of reads) {
    const performance = read.performance!;
    const raw = read.rawData as { punches?: TimedPunch[] } | null;
    if (!Array.isArray(raw?.punches) || raw.punches.length === 0) continue;
    const punches = withoutReadoutPunch(raw.punches);
    const timing = cardTiming(punches, performance.course.controls);
    const allFound = timing.matchedIndices.length === performance.course.controls
      .filter((item) => item.type !== "START" && Number.isFinite(Number(item.controlCodes[0] || item.control.code))).length;
    const acceptStatus = fixStatus && allFound && performance.status === "DISQUALIFIED";
    const status = acceptStatus ? "ACCEPTED" as const : performance.status;
    const timed = status !== "NO_TIME" && status !== "DID_NOT_FINISH";
    const durationMs = timed ? BigInt((timing.resultSeconds ?? 0) * 1000) : null;
    const startedAt = new Date(read.readAt.getTime() - (punches.at(-1)?.timeSeconds ?? 0) * 1000);
    const name = `${performance.attendance.person.firstName} ${performance.attendance.person.lastName}`;
    const label = `${read.event.name} · ${performance.course.name} · ${name}`;

    const timeChanged = performance.durationMs !== durationMs;
    if (timeChanged) { timeChanges += 1; console.log(`${label}: aika ${formatMs(performance.durationMs)} -> ${formatMs(durationMs)}`); }
    if (acceptStatus) { statusChanges += 1; console.log(`${label}: hylätty -> hyväksytty (kaikki rastit löytyvät kortilta)`); }
    else if (allFound && performance.status === "DISQUALIFIED") console.log(`${label}: kuitattu hylätyksi, mutta kaikki rastit löytyvät kortilta (korjaa lipulla --fix-status)`);
    if (!apply || (!timeChanged && !acceptStatus)) continue;

    await prisma.$transaction([
      prisma.punch.deleteMany({ where: { performanceId: performance.id } }),
      prisma.performance.update({
        where: { id: performance.id },
        data: {
          status,
          disqualificationReason: acceptStatus ? null : performance.disqualificationReason,
          startedAt: timed ? startedAt : null,
          finishedAt: timed ? new Date(startedAt.getTime() + Number(durationMs)) : null,
          durationMs,
          punches: {
            create: punches.map((punch, index) => ({
              controlCode: String(punch.controlCode),
              punchedAt: status === "NO_TIME" ? null : new Date(startedAt.getTime() + punch.timeSeconds * 1000),
              elapsedMs: BigInt(punch.timeSeconds * 1000),
              sequenceNumber: index + 1,
              status: timing.matchedIndices.includes(index) ? "VALID" as const : "EXTRA" as const,
            })),
          },
        },
      }),
    ]);
  }
  console.log(`\n${reads.length} luentaa, ${timeChanges} ajan muutosta, ${statusChanges} tilan muutosta.${apply ? " Tallennettu." : " Kuivaharjoitus: aja --apply tallentaaksesi."}`);
}

main().finally(() => prisma.$disconnect());
