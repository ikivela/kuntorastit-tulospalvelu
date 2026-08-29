import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateEventDto } from "./create-event.dto.js";

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.event.findMany({ include: { courses: true }, orderBy: { startsAt: "asc" } }); }
  async get(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id }, include: { courses: { include: { controls: { include: { control: true } } } } } });
    if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt");
    return event;
  }
  create(input: CreateEventDto) {
    return this.prisma.event.create({ data: { ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), registrationOpen: input.registrationOpen ?? false } });
  }
}
