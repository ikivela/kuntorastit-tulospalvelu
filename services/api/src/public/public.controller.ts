import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { CreateRegistrationDto } from "./create-registration.dto.js";
import { CreateReaderResultDto } from "./create-reader-result.dto.js";
import { PublicService } from "./public.service.js";

@ApiTags("public")
@Controller("public")
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get("calendar")
  @ApiQuery({ name: "year", required: false, example: 2026 })
  calendar(@Query("year", new ParseIntPipe({ optional: true })) year?: number) {
    return this.publicService.calendar(year ?? new Date().getUTCFullYear());
  }

  @Post("events/:eventId/registrations")
  register(
    @Param("eventId", new ParseUUIDPipe()) eventId: string,
    @Body() input: CreateRegistrationDto,
  ) {
    return this.publicService.register(eventId, input);
  }

  @Post("events/:eventId/reader-results")
  saveReaderResult(
    @Param("eventId", new ParseUUIDPipe()) eventId: string,
    @Body() input: CreateReaderResultDto,
  ) {
    return this.publicService.saveReaderResult(eventId, input);
  }

  @Get("events/:eventId/results")
  results(@Param("eventId", new ParseUUIDPipe()) eventId: string) {
    return this.publicService.results(eventId);
  }

  @Get("events/:eventId/reader-registrations")
  readerRegistrations(@Param("eventId", new ParseUUIDPipe()) eventId: string) {
    return this.publicService.readerRegistrations(eventId);
  }
}
