import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateRegistrationDto } from "./create-registration.dto.js";
import { CreateReaderResultDto } from "./create-reader-result.dto.js";

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

      const registration = existing
        ? await tx.registration.update({ where: { id: existing.id }, data: { status: "ACTIVE", courseId: input.courseId, punchCardId: card?.id ?? null, registeredAt: new Date() } })
        : await tx.registration.create({ data: { eventId, personId: person.id, courseId: input.courseId, punchCardId: card?.id } });
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

  async readerRegistrations(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: { in: ["OPEN", "FINISHED", "PUBLISHED"] } },
      select: { id: true },
    });
    if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt.");
    const registrations = await this.prisma.registration.findMany({
      where: { eventId, status: "ACTIVE", punchCard: { system: "EMIT" } },
      select: {
        id: true,
        registeredAt: true,
        person: { select: { id: true, firstName: true, lastName: true, club: { select: { name: true } } } },
        course: { select: { id: true, name: true } },
        punchCard: { select: { cardNumber: true } },
      },
      orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
    });
    return registrations.flatMap((registration) => registration.punchCard ? [{
      registrationId: registration.id,
      personId: registration.person.id,
      firstName: registration.person.firstName,
      lastName: registration.person.lastName,
      clubName: registration.person.club?.name ?? null,
      cardNumber: registration.punchCard.cardNumber,
      courseId: registration.course?.id ?? null,
      courseName: registration.course?.name ?? null,
      registeredAt: registration.registeredAt,
    }] : []);
  }
}
