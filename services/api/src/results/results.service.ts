import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { cardTiming } from "../public/emit-timing.js";
import { planResultUpdate } from "./result-update.js";
import { UpdateResultDto } from "./update-result.dto.js";

/** Admin view and corrections of an event's results (/admin/tulokset). */
@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventId: string) {
    await this.ensureEvent(eventId);
    const performances = await this.prisma.performance.findMany({
      where: { attendance: { eventId } },
      orderBy: [{ course: { sortOrder: "asc" } }, { attendance: { person: { lastName: "asc" } } }, { attendance: { person: { firstName: "asc" } } }],
      include: {
        attendance: { select: { person: { select: { id: true, firstName: true, lastName: true, club: { select: { name: true } } } } } },
        course: { select: { id: true, name: true } },
        punchCard: { select: { cardNumber: true } },
        punches: { orderBy: { sequenceNumber: "asc" }, select: { controlCode: true, elapsedMs: true, status: true } },
      },
    });
    return performances.map((performance) => ({
      id: performance.id,
      personId: performance.attendance.person.id,
      firstName: performance.attendance.person.firstName,
      lastName: performance.attendance.person.lastName,
      clubName: performance.attendance.person.club?.name ?? null,
      courseId: performance.course.id,
      courseName: performance.course.name,
      status: performance.status,
      disqualificationReason: performance.disqualificationReason,
      durationMs: performance.durationMs == null ? null : Number(performance.durationMs),
      cardNumber: performance.punchCard?.cardNumber ?? null,
      readAt: performance.readAt,
      updatedAt: performance.updatedAt,
      punches: performance.punches.map((punch) => ({
        controlCode: punch.controlCode,
        elapsedMs: punch.elapsedMs == null ? null : Number(punch.elapsedMs),
        status: punch.status,
      })),
    }));
  }

  async update(eventId: string, performanceId: string, input: UpdateResultDto) {
    const performance = await this.findPerformance(eventId, performanceId);
    const courseId = input.courseId ?? performance.courseId;
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, eventId },
      include: { controls: { orderBy: { sequenceNumber: "asc" }, include: { control: true } } },
    });
    if (!course) throw new BadRequestException("Valittu rata ei kuulu tapahtumaan.");
    if (courseId !== performance.courseId) {
      // Same rule as the readers: one result per person, course and card.
      const other = await this.prisma.performance.findFirst({
        where: { attendanceId: performance.attendanceId, courseId, punchCardId: performance.punchCardId, id: { not: performance.id } },
        select: { id: true },
      });
      if (other) throw new ConflictException(`Osallistujalla on jo tulos radalla ${course.name}${performance.punchCardId ? " samalla kortilla" : ""}. Poista se ensin.`);
    }
    const plan = planResultUpdate(performance, input);
    // A card read's punches are re-marked against the (new) course.
    const timing = courseId !== performance.courseId && performance.punches.length > 0
      ? cardTiming(performance.punches.map((punch) => ({ controlCode: Number(punch.controlCode), timeSeconds: Number(punch.elapsedMs ?? 0n) / 1000 })), course.controls)
      : null;
    await this.prisma.$transaction([
      this.prisma.performance.update({ where: { id: performance.id }, data: { courseId, ...plan } }),
      ...(timing ? performance.punches.map((punch, index) => this.prisma.punch.update({
        where: { id: punch.id },
        data: { status: timing.matchedIndices.includes(index) ? "VALID" : "EXTRA" },
      })) : []),
    ]);
    return { updated: true };
  }

  /** Deletes a result (its card read keeps the raw data). The participation
   * goes too when the person has no other result in the event. */
  async remove(eventId: string, performanceId: string) {
    const performance = await this.findPerformance(eventId, performanceId);
    await this.prisma.$transaction(async (tx) => {
      await tx.performance.delete({ where: { id: performance.id } });
      const remaining = await tx.performance.count({ where: { attendanceId: performance.attendanceId } });
      if (remaining === 0) await tx.attendance.delete({ where: { id: performance.attendanceId } });
    });
    return { deleted: true };
  }

  private async ensureEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt");
  }

  private async findPerformance(eventId: string, performanceId: string) {
    const performance = await this.prisma.performance.findFirst({
      where: { id: performanceId, attendance: { eventId } },
      include: { punches: { orderBy: { sequenceNumber: "asc" }, select: { id: true, controlCode: true, elapsedMs: true } } },
    });
    if (!performance) throw new NotFoundException("Tulosta ei löytynyt");
    return performance;
  }
}
