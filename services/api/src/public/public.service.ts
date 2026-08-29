import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

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
            _count: { select: { attendances: true } },
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
      })),
    }));
  }
}
