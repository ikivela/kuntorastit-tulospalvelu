import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateEventSeriesDto, CreateSeasonDto, UpdateEventSeriesDto, UpdateSeasonDto } from "./seasons.dto.js";
import { planRewards, planSeason, type ExistingReward, type RewardInput } from "./seasons-validation.js";

const SERIES_NOT_FOUND = "Tapahtumasarjaa ei löytynyt";
const SEASON_NOT_FOUND = "Kautta ei löytynyt";

@Injectable()
export class SeasonsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSeries() {
    const series = await this.prisma.eventSeries.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, description: true,
        seasons: {
          orderBy: { year: "desc" },
          select: { id: true, name: true, year: true, startsAt: true, endsAt: true, rewards: { orderBy: { requiredAttendances: "asc" }, select: { id: true, name: true, requiredAttendances: true } }, _count: { select: { events: true } } },
        },
      },
    });
    return series.map((item) => ({ ...item, seasons: item.seasons.map(({ _count, ...season }) => ({ ...season, eventCount: _count.events })) }));
  }

  createSeries(input: CreateEventSeriesDto) {
    return this.prisma.eventSeries.create({ data: { name: requireName(input.name, "Sarjan nimi puuttuu."), description: input.description?.trim() || null } });
  }

  async updateSeries(id: string, input: UpdateEventSeriesDto) {
    await this.findSeries(id);
    return this.prisma.eventSeries.update({ where: { id }, data: { name: input.name === undefined ? undefined : requireName(input.name, "Sarjan nimi puuttuu."), description: input.description === undefined ? undefined : input.description.trim() || null } });
  }

  async removeSeries(id: string) {
    await this.findSeries(id);
    // Season (and through it Event) rows cascade on delete in the schema, so
    // refuse instead of silently wiping results.
    const seasons = await this.prisma.season.count({ where: { eventSeriesId: id } });
    if (seasons > 0) throw new ConflictException(`Sarjalla on ${seasons} ${seasons === 1 ? "kausi" : "kautta"}. Poista kaudet ennen sarjan poistamista.`);
    await this.prisma.eventSeries.delete({ where: { id } });
    return { id };
  }

  async createSeason(input: CreateSeasonDto) {
    await this.findSeries(input.eventSeriesId);
    const { data, errors } = planSeason(input);
    const rewards = input.rewards ? this.planRewardsOrThrow(input.rewards) : [];
    if (!data) throw new BadRequestException(errors.join(" "));
    await this.assertYearFree(input.eventSeriesId, data.year);
    return this.uniqueYear(data.year, () => this.prisma.season.create({ data: { ...data, eventSeriesId: input.eventSeriesId, rewards: { create: rewards } } }));
  }

  async updateSeason(id: string, input: UpdateSeasonDto) {
    const current = await this.prisma.season.findUnique({ where: { id }, select: { eventSeriesId: true, name: true, year: true, startsAt: true, endsAt: true, rewards: { select: { id: true, rewardDescription: true } } } });
    if (!current) throw new NotFoundException(SEASON_NOT_FOUND);
    const { data, errors } = planSeason(input, current);
    const rewards = input.rewards ? this.planRewardsOrThrow(input.rewards, current.rewards) : undefined;
    if (!data) throw new BadRequestException(errors.join(" "));
    if (data.year !== current.year) await this.assertYearFree(current.eventSeriesId, data.year);
    // Rewards are replaced wholesale: deleting first avoids tripping the
    // (seasonId, requiredAttendances) unique index when thresholds swap values.
    return this.uniqueYear(data.year, () => this.prisma.$transaction(async (tx) => {
      if (rewards) {
        await tx.rewardThreshold.deleteMany({ where: { seasonId: id } });
        await tx.rewardThreshold.createMany({ data: rewards.map((reward) => ({ ...reward, seasonId: id })) });
      }
      return tx.season.update({ where: { id }, data });
    }));
  }

  async removeSeason(id: string) {
    const season = await this.prisma.season.findUnique({ where: { id }, select: { _count: { select: { events: true } } } });
    if (!season) throw new NotFoundException(SEASON_NOT_FOUND);
    // Events cascade on season delete in the schema; never let that happen here.
    const events = season._count.events;
    if (events > 0) throw new ConflictException(`Kaudella on ${events} ${events === 1 ? "tapahtuma" : "tapahtumaa"}. Siirrä tapahtumat toiselle kaudelle tai poista ne ennen kauden poistamista.`);
    await this.prisma.season.delete({ where: { id } });
    return { id };
  }

  private async findSeries(id: string) {
    const series = await this.prisma.eventSeries.findUnique({ where: { id }, select: { id: true } });
    if (!series) throw new NotFoundException(SERIES_NOT_FOUND);
    return series;
  }

  private async assertYearFree(eventSeriesId: string, year: number) {
    const existing = await this.prisma.season.findUnique({ where: { eventSeriesId_year: { eventSeriesId, year } }, select: { id: true } });
    if (existing) throw new ConflictException(yearTakenMessage(year));
  }

  private planRewardsOrThrow(rows: RewardInput[], existing?: ExistingReward[]) {
    const { rewards, errors } = planRewards(rows, existing);
    if (errors.length) throw new BadRequestException(errors.join(" "));
    return rewards;
  }

  // assertYearFree gives the friendly message up front; this catches the
  // race where two saves for the same year interleave.
  private async uniqueYear<T>(year: number, write: () => Promise<T>) {
    try { return await write(); }
    catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new ConflictException(yearTakenMessage(year));
      throw error;
    }
  }
}

function requireName(value: string, message: string) {
  const name = value.trim();
  if (!name) throw new BadRequestException(message);
  return name;
}

function yearTakenMessage(year: number) { return `Sarjalla on jo kausi vuodelle ${year}.`; }
