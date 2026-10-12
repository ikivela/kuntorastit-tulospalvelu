import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { ResultsService } from "./results.service.js";
import { UpdateResultDto } from "./update-result.dto.js";

@ApiTags("results")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("events/:eventId/results")
export class ResultsController {
  constructor(private readonly results: ResultsService) {}
  @Get() list(@Param("eventId", ParseUUIDPipe) eventId: string) { return this.results.list(eventId); }
  @Patch(":performanceId") update(@Param("eventId", ParseUUIDPipe) eventId: string, @Param("performanceId", ParseUUIDPipe) performanceId: string, @Body() input: UpdateResultDto) { return this.results.update(eventId, performanceId, input); }
  @Delete(":performanceId") remove(@Param("eventId", ParseUUIDPipe) eventId: string, @Param("performanceId", ParseUUIDPipe) performanceId: string) { return this.results.remove(eventId, performanceId); }
}
