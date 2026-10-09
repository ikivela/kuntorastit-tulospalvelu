import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { CreateEventSeriesDto, CreateSeasonDto, UpdateEventSeriesDto, UpdateSeasonDto } from "./seasons.dto.js";
import { SeasonsService } from "./seasons.service.js";

@ApiTags("seasons")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("series")
export class SeriesController {
  constructor(private readonly seasons: SeasonsService) {}
  @Get() list() { return this.seasons.listSeries(); }
  @Post() create(@Body() input: CreateEventSeriesDto) { return this.seasons.createSeries(input); }
  @Patch(":id") update(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateEventSeriesDto) { return this.seasons.updateSeries(id, input); }
  @Delete(":id") remove(@Param("id", ParseUUIDPipe) id: string) { return this.seasons.removeSeries(id); }
}

@ApiTags("seasons")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("seasons")
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}
  @Post() create(@Body() input: CreateSeasonDto) { return this.seasons.createSeason(input); }
  @Patch(":id") update(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateSeasonDto) { return this.seasons.updateSeason(id, input); }
  @Delete(":id") remove(@Param("id", ParseUUIDPipe) id: string) { return this.seasons.removeSeason(id); }
}
