import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateRegistrationDto } from "./create-registration.dto.js";
import { CreateReaderResultDto } from "./create-reader-result.dto.js";
import { CreateManualResultDto } from "./create-manual-result.dto.js";
import { cardTiming, withoutReadoutPunch } from "./emit-timing.js";

/** A result is identified by person (attendance), course and EMIT card
 * (null for a manual entry): a person may run several courses in an event,
 * with the same card or different ones, but has one result per course and
 * card. */
export type ResultKey = { attendanceId: string; courseId: string; punchCardId: string | null };

/** A new card read or manual entry replaces the earlier result with the same
 * key (the earlier card read keeps its raw data, unlinked). The read time
 * decides, not arrival order, so an older read sent late by an offline client
 * does not replace a newer result: then the newer result's id is returned and
 * nothing is replaced. */
export async function replaceEarlierResults(tx: Prisma.TransactionClient, key: ResultKey, readAt: Date) {
  const results = await tx.performance.findMany({ where: key, select: { id: true, readAt: true } });
  const newer = results.find((result) => result.readAt != null && result.readAt > readAt);
  if (newer) return newer.id;
  if (results.length > 0) await tx.performance.deleteMany({ where: { id: { in: results.map((result) => result.id) } } });
  return null;
}

/** An edit that moves a result to another course replaces the result already
 * there with the same key: the edit is the operator's decision. */
async function removeOtherResults(tx: Prisma.TransactionClient, key: ResultKey, keepId: string) {
  await tx.performance.deleteMany({ where: { ...key, id: { not: keepId } } });
}

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async calendar(year: number) {
    const seasons = await this.prisma.season.findMany({
      where: { year },
      include: {
        eventSeries: true,
        rewards: { orderBy: { requiredAttendances: "asc" } },
        events: {
          where: { status: { in: ["OPEN", "FINISHED", "PUBLISHED"] } },
          orderBy: { startsAt: "asc" },
          include: {
            courses: {
              orderBy: { sortOrder: "asc" },
              include: {
                controls: {
                  orderBy: { sequenceNumber: "asc" },
                  include: { control: true },
                },
              },
            },
            _count: { select: { attendances: true, registrations: { where: { status: "ACTIVE" } } } },
          },
        },
      },
    });

    // A season with nothing published yet (or only drafts) isn't shown.
    return seasons.filter((season) => season.events.length > 0).map((season) => ({
      id: season.id,
      name: season.name,
      year: season.year,
      eventSeries: season.eventSeries.name,
      rewardThresholds: season.rewards,
      events: season.events.map(({ _count, ...event }) => ({
        ...event,
        attendanceCount: _count.attendances,
        registrationCount: _count.registrations,
      })),
    }));
  }

  async register(eventId: string, input: CreateRegistrationDto) {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const clubName = input.clubName?.trim() || undefined;
    const cardNumber = input.cardNumber?.trim() || undefined;
    if (!firstName || !lastName) throw new BadRequestException("Etunimi ja sukunimi ovat pakollisia.");
    if (Boolean(cardNumber) !== Boolean(input.punchingSystem)) {
      throw new BadRequestException("Valitse leimausjärjestelmä ja anna kortin numero.");
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { courses: { select: { id: true } } },
    });
    if (!event || event.status === "DRAFT") throw new NotFoundException("Tapahtumaa ei löytynyt.");
    if (!event.registrationOpen) throw new BadRequestException("Ilmoittautuminen ei ole avoinna.");
    if (!event.courses.some((course) => course.id === input.courseId)) {
      throw new BadRequestException("Valittu rata ei kuulu tapahtumaan.");
    }
    if (!event.paymentMethods.includes(input.paymentMethod)) {
      throw new BadRequestException(`Valittu maksutapa ei ole sallittu tälle tapahtumalle. Sallitut maksutavat: ${event.paymentMethods.join(", ")}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const club = clubName
        ? await tx.club.upsert({ where: { name: clubName }, update: {}, create: { name: clubName } })
        : null;
      let person = await tx.person.findFirst({
        where: { firstName: { equals: firstName, mode: "insensitive" }, lastName: { equals: lastName, mode: "insensitive" } },
        orderBy: { createdAt: "asc" },
      });
      if (!person) person = await tx.person.create({ data: { firstName, lastName, clubId: club?.id } });
      else if (club && person.clubId !== club.id) person = await tx.person.update({ where: { id: person.id }, data: { clubId: club.id } });

      const existing = await tx.registration.findUnique({ where: { eventId_personId: { eventId, personId: person.id } } });
      if (existing?.status === "ACTIVE") throw new ConflictException("Olet jo ilmoittautunut tähän tapahtumaan.");

      const card = cardNumber && input.punchingSystem
        ? await tx.punchCard.upsert({
            where: { system_cardNumber: { system: input.punchingSystem, cardNumber } },
            update: {},
            create: { system: input.punchingSystem, cardNumber },
          })
        : null;
      if (card) {
        const assignment = await tx.personPunchCard.findFirst({ where: { personId: person.id, punchCardId: card.id, validUntil: null } });
        if (!assignment) await tx.personPunchCard.create({ data: { personId: person.id, punchCardId: card.id } });
      }

      const notes = input.notes?.trim() || null;
      const registration = existing
        ? await tx.registration.update({ where: { id: existing.id }, data: { status: "ACTIVE", courseId: input.courseId, punchCardId: card?.id ?? null, paymentMethod: input.paymentMethod, notes, registeredAt: new Date() } })
        : await tx.registration.create({ data: { eventId, personId: person.id, courseId: input.courseId, punchCardId: card?.id, paymentMethod: input.paymentMethod, notes } });
      return { id: registration.id, registeredAt: registration.registeredAt, participant: `${person.firstName} ${person.lastName}` };
    });
  }

  async saveReaderResult(eventId: string, input: CreateReaderResultDto) {
    const existingRead = await this.prisma.cardRead.findUnique({
      where: { clientReference: input.clientReference },
      select: { id: true, performanceId: true, performance: { select: { attendanceId: true, punchCardId: true } } },
    });
    const course = await this.prisma.course.findFirst({
      where: { id: input.courseId, eventId },
      include: { controls: { orderBy: { sequenceNumber: "asc" }, include: { control: true } } },
    });
    if (!course) throw new BadRequestException("Valittu rata ei kuulu tapahtumaan.");
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true } });
    if (!event || event.status === "DRAFT") throw new NotFoundException("Tapahtumaa ei löytynyt.");
    const readAt = new Date(input.readAt);
    // EMIT punch times are seconds from the start; the result is the finish punch.
    const cardPunches = withoutReadoutPunch(input.punches);
    const timing = cardTiming(cardPunches, course.controls);
    const durationMs = (timing.resultSeconds ?? 0) * 1000;
    // The card is read right after its last punch, so the start is that long before the read.
    const startedAt = new Date(readAt.getTime() - (cardPunches.at(-1)?.timeSeconds ?? 0) * 1000);
    const finishedAt = new Date(startedAt.getTime() + durationMs);
    const status = input.resultStatus === "OK" ? "ACCEPTED"
      : input.resultStatus === "NO_TIME" ? "NO_TIME"
      : input.resultStatus === "DID_NOT_FINISH" ? "DID_NOT_FINISH"
      : "DISQUALIFIED";
    // No time is published for a result without time or a retirement; the
    // punches of a retirement still keep their times.
    const timed = input.resultStatus !== "NO_TIME" && input.resultStatus !== "DID_NOT_FINISH";
    const punches = cardPunches.map((punch, index) => {
      const elapsedMs = punch.timeSeconds * 1000;
      return {
        controlCode: String(punch.controlCode),
        punchedAt: input.resultStatus === "NO_TIME" ? null : new Date(startedAt.getTime() + elapsedMs),
        elapsedMs: BigInt(elapsedMs),
        sequenceNumber: index + 1,
        status: timing.matchedIndices.includes(index) ? "VALID" as const : "EXTRA" as const,
      };
    });
    const rawData = {
      resultStatus: input.resultStatus,
      punches: input.punches.map((punch) => ({ controlCode: punch.controlCode, timeSeconds: punch.timeSeconds })),
    };

    return this.prisma.$transaction(async (tx) => {
      if (existingRead?.performanceId && existingRead.performance) {
        await removeOtherResults(tx, { attendanceId: existingRead.performance.attendanceId, courseId: course.id, punchCardId: existingRead.performance.punchCardId }, existingRead.performanceId);
        await tx.performance.update({
          where: { id: existingRead.performanceId },
          data: {
            courseId: course.id,
            status,
            startedAt: timed ? startedAt : null,
            finishedAt: timed ? finishedAt : null,
            durationMs: timed ? BigInt(durationMs) : null,
            readAt,
            disqualificationReason: input.resultStatus === "MISSING_CONTROL" ? "MISSING_CONTROL" : input.resultStatus === "DISQUALIFIED" ? "WRONG_CONTROL" : null,
            punches: { deleteMany: {}, create: punches },
          },
        });
        await tx.cardRead.update({ where: { id: existingRead.id }, data: { readAt, rawData, processingStatus: "PROCESSED" } });
        return { cardReadId: existingRead.id, performanceId: existingRead.performanceId, duplicate: true };
      }
      if (existingRead) {
        // This read's result was replaced by a newer read of the same card on
        // the same course: an edit of it is kept as raw data only.
        await tx.cardRead.update({ where: { id: existingRead.id }, data: { readAt, rawData } });
        return { cardReadId: existingRead.id, performanceId: null, duplicate: true, superseded: true };
      }
      const card = await tx.punchCard.upsert({
        where: { system_cardNumber: { system: "EMIT", cardNumber: input.cardNumber } },
        update: {},
        create: { system: "EMIT", cardNumber: input.cardNumber },
      });
      const registration = await tx.registration.findFirst({
        where: { eventId, punchCardId: card.id, status: "ACTIVE" },
        include: { person: true },
      });
      const clubName = input.clubName?.trim() || undefined;
      const club = clubName ? await tx.club.upsert({ where: { name: clubName }, update: {}, create: { name: clubName } }) : null;
      let person = registration?.person ?? await tx.person.findFirst({
        where: { firstName: { equals: input.firstName.trim(), mode: "insensitive" }, lastName: { equals: input.lastName.trim(), mode: "insensitive" } },
        orderBy: { createdAt: "asc" },
      });
      if (!person) person = await tx.person.create({ data: { firstName: input.firstName.trim(), lastName: input.lastName.trim(), clubId: club?.id } });
      else if (club && person.clubId !== club.id) person = await tx.person.update({ where: { id: person.id }, data: { clubId: club.id } });
      const assignment = await tx.personPunchCard.findFirst({ where: { personId: person.id, punchCardId: card.id, validUntil: null } });
      if (!assignment) await tx.personPunchCard.create({ data: { personId: person.id, punchCardId: card.id } });
      await tx.registration.upsert({
        where: { eventId_personId: { eventId, personId: person.id } },
        update: { status: "ACTIVE", courseId: course.id, punchCardId: card.id },
        create: { eventId, personId: person.id, courseId: course.id, punchCardId: card.id },
      });
      const attendance = await tx.attendance.upsert({
        where: { eventId_personId: { eventId, personId: person.id } },
        update: {},
        create: { eventId, personId: person.id },
      });
      const newerResultId = await replaceEarlierResults(tx, { attendanceId: attendance.id, courseId: course.id, punchCardId: card.id }, readAt);
      const performance = newerResultId ? null : await tx.performance.create({
        data: {
          attendanceId: attendance.id,
          courseId: course.id,
          punchCardId: card.id,
          source: "ONSITE",
          status,
          startedAt: timed ? startedAt : null,
          finishedAt: timed ? finishedAt : null,
          durationMs: timed ? BigInt(durationMs) : null,
          readAt,
          disqualificationReason: input.resultStatus === "MISSING_CONTROL" ? "MISSING_CONTROL" : input.resultStatus === "DISQUALIFIED" ? "WRONG_CONTROL" : null,
          punches: { create: punches },
        },
      });
      const cardRead = await tx.cardRead.create({
        data: {
          clientReference: input.clientReference,
          eventId,
          punchCardId: card.id,
          readerType: "EMIT_250_TAURI",
          readerSerial: input.readerSerial,
          readAt,
          processingStatus: "PROCESSED",
          performanceId: performance?.id ?? null,
          rawData,
        },
      });
      return { cardReadId: cardRead.id, performanceId: performance?.id ?? newerResultId, duplicate: false, superseded: newerResultId != null };
    });
  }

  async addManualResult(eventId: string, input: CreateManualResultDto) {
    const course = await this.prisma.course.findFirst({ where: { id: input.courseId, eventId } });
    if (!course) throw new BadRequestException("Valittu rata ei kuulu tapahtumaan.");
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true } });
    if (!event || event.status === "DRAFT") throw new NotFoundException("Tapahtumaa ei löytynyt.");
    const existing = await this.prisma.performance.findUnique({
      where: { clientReference: input.clientReference },
      select: { id: true, attendanceId: true, attendance: { select: { person: { select: { firstName: true, lastName: true } } } } },
    });

    // Entered offline, a result can reach the API long after it was typed in;
    // the client's own timestamp keeps finishedAt/readAt at the real moment.
    const readAt = input.readAt ? new Date(input.readAt) : new Date();

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await removeOtherResults(tx, { attendanceId: existing.attendanceId, courseId: course.id, punchCardId: null }, existing.id);
        const durationMs = input.durationSeconds != null ? input.durationSeconds * 1000 : null;
        const performance = await tx.performance.update({
          where: { id: existing.id },
          data: {
            courseId: course.id,
            status: durationMs != null ? "ACCEPTED" : "NO_TIME",
            startedAt: durationMs != null ? new Date(readAt.getTime() - durationMs) : null,
            finishedAt: durationMs != null ? readAt : null,
            durationMs: durationMs != null ? BigInt(durationMs) : null,
            readAt,
          },
        });
        const { firstName, lastName } = existing.attendance.person;
        return { performanceId: performance.id, participant: `${firstName} ${lastName}` };
      }

      let person = input.personId ? await tx.person.findUnique({ where: { id: input.personId } }) : null;
      if (input.personId && !person) throw new NotFoundException("Henkilöä ei löytynyt.");
      if (!person) {
        const clubName = input.clubName?.trim() || undefined;
        const club = clubName ? await tx.club.upsert({ where: { name: clubName }, update: {}, create: { name: clubName } }) : null;
        person = await tx.person.findFirst({
          where: { firstName: { equals: input.firstName.trim(), mode: "insensitive" }, lastName: { equals: input.lastName.trim(), mode: "insensitive" } },
          orderBy: { createdAt: "asc" },
        });
        if (!person) person = await tx.person.create({ data: { firstName: input.firstName.trim(), lastName: input.lastName.trim(), clubId: club?.id } });
        else if (club && person.clubId !== club.id) person = await tx.person.update({ where: { id: person.id }, data: { clubId: club.id } });
      }

      const attendance = await tx.attendance.upsert({
        where: { eventId_personId: { eventId, personId: person.id } },
        update: {},
        create: { eventId, personId: person.id },
      });
      const newerResultId = await replaceEarlierResults(tx, { attendanceId: attendance.id, courseId: course.id, punchCardId: null }, readAt);
      if (newerResultId) return { performanceId: newerResultId, participant: `${person.firstName} ${person.lastName}`, superseded: true };
      const durationMs = input.durationSeconds != null ? input.durationSeconds * 1000 : null;
      const performance = await tx.performance.create({
        data: {
          attendanceId: attendance.id,
          courseId: course.id,
          source: "ONSITE",
          status: durationMs != null ? "ACCEPTED" : "NO_TIME",
          startedAt: durationMs != null ? new Date(readAt.getTime() - durationMs) : null,
          finishedAt: durationMs != null ? readAt : null,
          durationMs: durationMs != null ? BigInt(durationMs) : null,
          readAt,
          clientReference: input.clientReference,
        },
      });
      return { performanceId: performance.id, participant: `${person.firstName} ${person.lastName}` };
    });
  }

  /** Person currently holding an EMIT card: the active card assignment, or
   * else whoever last registered with it. null when the card is unknown. */
  async personByCard(cardNumber: string) {
    const card = await this.prisma.punchCard.findUnique({
      where: { system_cardNumber: { system: "EMIT", cardNumber: cardNumber.trim() } },
      select: {
        assignments: { where: { validUntil: null }, orderBy: { validFrom: "desc" }, take: 1, select: { person: { include: { club: { select: { name: true } } } } } },
        registrations: { orderBy: { registeredAt: "desc" }, take: 1, select: { person: { include: { club: { select: { name: true } } } } } },
      },
    });
    const person = card?.assignments[0]?.person ?? card?.registrations[0]?.person;
    return person ? { id: person.id, firstName: person.firstName, lastName: person.lastName, clubName: person.club?.name ?? null } : null;
  }
  async searchPersons(query: string) {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const words = trimmed.split(/\s+/).filter(Boolean);
    const nameConditions = words.length > 1
      ? [
          { firstName: { contains: words[0], mode: "insensitive" as const }, lastName: { contains: words.slice(1).join(" "), mode: "insensitive" as const } },
          { lastName: { contains: words[0], mode: "insensitive" as const }, firstName: { contains: words.slice(1).join(" "), mode: "insensitive" as const } },
        ]
      : [
          { firstName: { contains: trimmed, mode: "insensitive" as const } },
          { lastName: { contains: trimmed, mode: "insensitive" as const } },
        ];
    const persons = await this.prisma.person.findMany({
      where: { OR: nameConditions },
      include: { club: { select: { name: true } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 10,
    });
    return persons.map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      clubName: person.club?.name ?? null,
    }));
  }

  async results(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: { in: ["OPEN", "FINISHED", "PUBLISHED"] } },
      include: {
        courses: {
          orderBy: { sortOrder: "asc" },
          include: {
            controls: { orderBy: { sequenceNumber: "asc" }, select: { type: true, controlCodes: true, legLengthMeters: true, control: { select: { code: true } } } },
            performances: {
              orderBy: { updatedAt: "desc" },
              include: {
                attendance: { include: { person: { include: { club: true } } } },
                punches: { orderBy: { sequenceNumber: "asc" } },
              },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt.");

    // A registration counts as taking part "omatoimi" (on one's own time, as
    // in OLFresults): it is listed on its course until the person has a real
    // result in the event, which then replaces it.
    const registrations = await this.prisma.registration.findMany({
      where: { eventId, status: "ACTIVE", courseId: { not: null } },
      orderBy: { registeredAt: "asc" },
      include: { person: { include: { club: true } } },
    });
    const performers = new Set<string>();
    for (const course of event.courses) for (const performance of course.performances) performers.add(performance.attendance.personId);
    const personIds = new Set<string>([...performers, ...registrations.map((registration) => registration.personId)]);
    const seasonEvents = await this.prisma.event.findMany({ where: { seasonId: event.seasonId }, select: { id: true } });
    const seasonEventIds = seasonEvents.map((seasonEvent) => seasonEvent.id);
    // Counts both attended (has a result) and registered (may have taken
    // part "omatoimi", on their own time, with no recorded result) events —
    // a person can show up here with a result for this event while their
    // count also reflects a registration-only event elsewhere.
    const [attendanceRows, registrationRows, acceptedRows] = personIds.size === 0 ? [[], [], []] : await Promise.all([
      this.prisma.attendance.findMany({ where: { personId: { in: [...personIds] }, eventId: { in: seasonEventIds } }, select: { personId: true, eventId: true } }),
      this.prisma.registration.findMany({ where: { personId: { in: [...personIds] }, eventId: { in: seasonEventIds }, status: "ACTIVE" }, select: { personId: true, eventId: true } }),
      // Season events with an accepted (timed) result, for the runner card.
      this.prisma.attendance.findMany({ where: { personId: { in: [...personIds] }, eventId: { in: seasonEventIds }, performances: { some: { status: "ACCEPTED" } } }, select: { personId: true } }),
    ]);
    const acceptedCounts = new Map<string, number>();
    for (const row of acceptedRows) acceptedCounts.set(row.personId, (acceptedCounts.get(row.personId) ?? 0) + 1);
    const eventsByPerson = new Map<string, Set<string>>();
    for (const record of [...attendanceRows, ...registrationRows]) {
      const eventSet = eventsByPerson.get(record.personId) ?? new Set<string>();
      eventSet.add(record.eventId);
      eventsByPerson.set(record.personId, eventSet);
    }
    const attendanceCounts = new Map([...eventsByPerson.entries()].map(([personId, eventSet]) => [personId, eventSet.size]));

    return {
      id: event.id,
      name: event.name,
      locationName: event.locationName,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      updatedAt: new Date(),
      courses: event.courses.map((course) => {
        const latestByParticipant = new Map<string, (typeof course.performances)[number]>();
        for (const performance of course.performances) {
          if (!latestByParticipant.has(performance.attendance.personId)) {
            latestByParticipant.set(performance.attendance.personId, performance);
          }
        }
        const fromPerformances = [...latestByParticipant.values()].map((performance) => ({
          id: performance.id,
          person: performance.attendance.person,
          source: performance.source,
          status: performance.status,
          durationMs: performance.durationMs == null ? null : Number(performance.durationMs),
          readAt: performance.readAt,
          startedAt: performance.startedAt,
          punches: performance.punches.map((punch) => ({
            sequenceNumber: punch.sequenceNumber,
            controlCode: punch.controlCode,
            elapsedMs: punch.elapsedMs == null ? null : Number(punch.elapsedMs),
            status: punch.status,
          })),
        }));
        const fromRegistrations = registrations
          .filter((registration) => registration.courseId === course.id && !performers.has(registration.personId))
          .map((registration) => ({
            id: `registration-${registration.id}`,
            person: registration.person,
            source: "SELF_SERVICE" as const,
            status: "NO_TIME" as const,
            durationMs: null,
            readAt: registration.registeredAt,
            startedAt: null,
            punches: [],
          }));
        // Timed results first, then no time, "omatoimi" (self-service, no
        // time) and the rest, as in OLFresults.
        const group = (result: { status: string; source: string }) =>
          result.status === "ACCEPTED" ? 0
          : result.status === "NO_TIME" ? (result.source === "SELF_SERVICE" ? 2 : 1)
          : ({ DISQUALIFIED: 3, DID_NOT_FINISH: 4 } as Record<string, number>)[result.status] ?? 5;
        const results = [...fromPerformances, ...fromRegistrations].sort((left, right) =>
          group(left) - group(right)
          || (left.durationMs ?? 0) - (right.durationMs ?? 0)
          || left.person.lastName.localeCompare(right.person.lastName, "fi"));
        let acceptedRank = 0;
        return {
          id: course.id,
          name: course.name,
          lengthMeters: course.lengthMeters,
          // Controls in course order (no start) with the length of the leg
          // to each, for the runner card's leg distances and paces.
          legs: course.controls.filter((item) => item.type !== "START").map((item) => ({
            code: item.type === "FINISH" ? null : item.controlCodes[0] ?? item.control.code,
            lengthMeters: item.legLengthMeters,
          })),
          results: results.map(({ person, ...result }) => {
            if (result.status === "ACCEPTED") acceptedRank += 1;
            return {
              ...result,
              rank: result.status === "ACCEPTED" ? acceptedRank : null,
              firstName: person.firstName,
              lastName: person.lastName,
              clubName: person.club?.name ?? null,
              attendanceCount: attendanceCounts.get(person.id) ?? 0,
              acceptedCount: acceptedCounts.get(person.id) ?? 0,
            };
          }),
        };
      }),
    };
  }

}
