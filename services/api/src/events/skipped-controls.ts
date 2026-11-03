import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service.js";
import { cardTiming } from "../public/emit-timing.js";

/** Control codes as stored: digits only, unique, in numeric order. */
export function normalizeSkippedCodes(codes: string[]) {
  return [...new Set(codes.map((code) => code.trim()).filter((code) => /^\d+$/.test(code)).map((code) => String(Number(code))))]
    .sort((a, b) => Number(a) - Number(b));
}

/** Sets the controls left out of the event's card check (a punch unit that
 * died) and re-checks the card results already stored: punch statuses and
 * times follow the new check, a result missing only skipped controls is
 * accepted, and an accepted one that relied on a control no longer skipped
 * gets "rasti puuttuu". Other operator decisions (no time, retired, a
 * wrong-control disqualification, an accepted result with other controls
 * missing) are kept. */
export async function setSkippedControls(prisma: PrismaService, eventId: string, codes: string[]) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { skippedControlCodes: true } });
  if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt.");
  const previous = event.skippedControlCodes;
  const next = normalizeSkippedCodes(codes);
  const performances = await prisma.performance.findMany({
    where: { attendance: { eventId }, punches: { some: {} } },
    include: {
      punches: { orderBy: { sequenceNumber: "asc" }, select: { id: true, controlCode: true, elapsedMs: true, status: true } },
      course: { select: { controls: { orderBy: { sequenceNumber: "asc" }, include: { control: true } } } },
    },
  });
  let changedResults = 0;
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { skippedControlCodes: next, version: { increment: 1 } } });
    for (const performance of performances) {
      const punches = performance.punches.map((punch) => ({ controlCode: Number(punch.controlCode), timeSeconds: Number(punch.elapsedMs ?? 0n) / 1000 }));
      const before = cardTiming(punches, performance.course.controls, previous);
      const after = cardTiming(punches, performance.course.controls, next);
      const missingControl = performance.status === "DISQUALIFIED" && performance.disqualificationReason === "MISSING_CONTROL";
      const accept = missingControl && after.missingCodes.length === 0;
      const reject = performance.status === "ACCEPTED" && before.missingCodes.length === 0 && after.missingCodes.length > 0;
      const status = accept ? "ACCEPTED" as const : reject ? "DISQUALIFIED" as const : performance.status;
      const timed = status === "ACCEPTED" || status === "DISQUALIFIED";
      const durationMs = timed && after.resultSeconds != null ? BigInt(after.resultSeconds * 1000) : performance.durationMs;
      const punchStatus = (index: number) => after.matchedIndices.includes(index) ? "VALID" as const : "EXTRA" as const;
      const punchesChanged = performance.punches.filter((punch, index) => punch.status !== punchStatus(index));
      if (!accept && !reject && durationMs === performance.durationMs && punchesChanged.length === 0) continue;
      changedResults += 1;
      await tx.performance.update({
        where: { id: performance.id },
        data: {
          status,
          disqualificationReason: accept ? null : reject ? "MISSING_CONTROL" : performance.disqualificationReason,
          durationMs,
          finishedAt: performance.startedAt && durationMs != null ? new Date(performance.startedAt.getTime() + Number(durationMs)) : performance.finishedAt,
          version: { increment: 1 },
        },
      });
      for (const punch of punchesChanged) {
        await tx.punch.update({ where: { id: punch.id }, data: { status: punchStatus(performance.punches.indexOf(punch)) } });
      }
    }
  });
  return { skippedControlCodes: next, changedResults };
}
