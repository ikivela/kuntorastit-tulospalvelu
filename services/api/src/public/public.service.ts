import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateRegistrationDto } from "./create-registration.dto.js";

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
            courses: { orderBy: { sortOrder: "asc" } },
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
}
