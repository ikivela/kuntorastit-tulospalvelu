import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateRegistrationDto } from "./create-registration.dto.js";
import { CreateReaderResultDto } from "./create-reader-result.dto.js";
import { CreateManualResultDto } from "./create-manual-result.dto.js";

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

    return seasons.map((season) => ({
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
      select: { id: true, performanceId: true },
    });
    const course = await this.prisma.course.findFirst({
      where: { id: input.courseId, eventId },
      include: { controls: { orderBy: { sequenceNumber: "asc" }, include: { control: true } } },
    });
    if (!course) throw new BadRequestException("Valittu rata ei kuulu tapahtumaan.");
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true } });
    if (!event || event.status === "DRAFT") throw new NotFoundException("Tapahtumaa ei löytynyt.");
    const readAt = new Date(input.readAt);
    const durationMs = input.punches.reduce((sum, punch) => sum + punch.timeSeconds * 1000, 0);
    const startedAt = new Date(readAt.getTime() - durationMs);
    const expectedCodes = course.controls
      .filter((item) => item.type !== "START" && item.type !== "FINISH")
      .map((item) => item.controlCodes[0] || item.control.code);
    const status = input.resultStatus === "OK" ? "ACCEPTED" : input.resultStatus === "NO_TIME" ? "NO_TIME" : "DISQUALIFIED";
    const punches = input.punches.map((punch, index) => {
      const elapsedMs = input.punches.slice(0, index + 1).reduce((sum, item) => sum + item.timeSeconds * 1000, 0);
      return {
        controlCode: String(punch.controlCode),
        punchedAt: input.resultStatus === "NO_TIME" ? null : new Date(startedAt.getTime() + elapsedMs),
        elapsedMs: BigInt(elapsedMs),
        sequenceNumber: index + 1,
        status: expectedCodes[index] === String(punch.controlCode) ? "VALID" as const : "EXTRA" as const,
      };
    });
    const rawData = {
      resultStatus: input.resultStatus,
      punches: input.punches.map((punch) => ({ controlCode: punch.controlCode, timeSeconds: punch.timeSeconds })),
    };

    return this.prisma.$transaction(async (tx) => {
      if (existingRead?.performanceId) {
        await tx.performance.update({
          where: { id: existingRead.performanceId },
          data: {
            courseId: course.id,
            status,
            startedAt: input.resultStatus === "NO_TIME" ? null : startedAt,
            finishedAt: input.resultStatus === "NO_TIME" ? null : readAt,
            durationMs: input.resultStatus === "NO_TIME" ? null : BigInt(durationMs),
            readAt,
            disqualificationReason: input.resultStatus === "MISSING_CONTROL" ? "MISSING_CONTROL" : input.resultStatus === "DISQUALIFIED" ? "WRONG_CONTROL" : null,
            punches: { deleteMany: {}, create: punches },
          },
        });
        await tx.cardRead.update({ where: { id: existingRead.id }, data: { readAt, rawData, processingStatus: "PROCESSED" } });
        return { cardReadId: existingRead.id, performanceId: existingRead.performanceId, duplicate: true };
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
      const performance = await tx.performance.create({
        data: {
          attendanceId: attendance.id,
          courseId: course.id,
          punchCardId: card.id,
          source: "ONSITE",
          status,
          startedAt: input.resultStatus === "NO_TIME" ? null : startedAt,
          finishedAt: input.resultStatus === "NO_TIME" ? null : readAt,
          durationMs: input.resultStatus === "NO_TIME" ? null : BigInt(durationMs),
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
          performanceId: performance.id,
          rawData,
        },
      });
      return { cardReadId: cardRead.id, performanceId: performance.id, duplicate: false };
    });
  }

  async addManualResult(eventId: string, input: CreateManualResultDto) {
    const course = await this.prisma.course.findFirst({ where: { id: input.courseId, eventId } });
    if (!course) throw new BadRequestException("Valittu rata ei kuulu tapahtumaan.");
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, status: true } });
    if (!event || event.status === "DRAFT") throw new NotFoundException("Tapahtumaa ei löytynyt.");
    const existing = await this.prisma.performance.findUnique({
      where: { clientReference: input.clientReference },
      select: { id: true, attendance: { select: { person: { select: { firstName: true, lastName: true } } } } },
    });

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        const readAt = new Date();
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
      const readAt = new Date();
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

    const personIds = new Set<string>();
    for (const course of event.courses) for (const performance of course.performances) personIds.add(performance.attendance.personId);
    const seasonEvents = await this.prisma.event.findMany({ where: { seasonId: event.seasonId }, select: { id: true } });
    const seasonEventIds = seasonEvents.map((seasonEvent) => seasonEvent.id);
    // Counts both attended (has a result) and registered (may have taken
    // part "omatoimi", on their own time, with no recorded result) events —
    // a person can show up here with a result for this event while their
    // count also reflects a registration-only event elsewhere.
    const [attendanceRows, registrationRows] = personIds.size === 0 ? [[], []] : await Promise.all([
      this.prisma.attendance.findMany({ where: { personId: { in: [...personIds] }, eventId: { in: seasonEventIds } }, select: { personId: true, eventId: true } }),
      this.prisma.registration.findMany({ where: { personId: { in: [...personIds] }, eventId: { in: seasonEventIds }, status: "ACTIVE" }, select: { personId: true, eventId: true } }),
    ]);
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
      updatedAt: new Date(),
      courses: event.courses.map((course) => {
        const latestByParticipant = new Map<string, (typeof course.performances)[number]>();
        for (const performance of course.performances) {
          if (!latestByParticipant.has(performance.attendance.personId)) {
            latestByParticipant.set(performance.attendance.personId, performance);
          }
        }
        const performances = [...latestByParticipant.values()].sort((left, right) => {
          const statusOrder = { ACCEPTED: 0, NO_TIME: 1, DISQUALIFIED: 2, DID_NOT_FINISH: 3, PENDING: 4 };
          const statusDifference = statusOrder[left.status] - statusOrder[right.status];
          if (statusDifference !== 0) return statusDifference;
          return Number(left.durationMs ?? 0n) - Number(right.durationMs ?? 0n);
        });
        let acceptedRank = 0;
        return {
          id: course.id,
          name: course.name,
          lengthMeters: course.lengthMeters,
          results: performances.map((performance) => {
            if (performance.status === "ACCEPTED") acceptedRank += 1;
            return {
              id: performance.id,
              rank: performance.status === "ACCEPTED" ? acceptedRank : null,
              firstName: performance.attendance.person.firstName,
              lastName: performance.attendance.person.lastName,
              clubName: performance.attendance.person.club?.name ?? null,
              attendanceCount: attendanceCounts.get(performance.attendance.personId) ?? 0,
              status: performance.status,
              durationMs: performance.durationMs == null ? null : Number(performance.durationMs),
              readAt: performance.readAt,
              punches: performance.punches.map((punch) => ({
                sequenceNumber: punch.sequenceNumber,
                controlCode: punch.controlCode,
                elapsedMs: punch.elapsedMs == null ? null : Number(punch.elapsedMs),
                status: punch.status,
              })),
            };
          }),
        };
      }),
    };
  }

}
