import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiQuery, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ReaderDeviceAuthGuard } from "../reader-devices/reader-device-auth.guard.js";
import { ReaderDevicesService } from "../reader-devices/reader-devices.service.js";
import { RegisterReaderDeviceDto } from "../reader-devices/register-reader-device.dto.js";
import { CreateRegistrationDto } from "./create-registration.dto.js";
import { CreateReaderResultDto } from "./create-reader-result.dto.js";
import { CreateManualResultDto } from "./create-manual-result.dto.js";
import { PublicService } from "./public.service.js";

@ApiTags("public")
@Controller("public")
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly readerDevices: ReaderDevicesService,
  ) {}

  @Post("reader-devices/register")
  registerReaderDevice(@Body() input: RegisterReaderDeviceDto) {
    return this.readerDevices.register(input);
  }

  @Get("reader-devices/:installationId/status")
  readerDeviceStatus(@Param("installationId", new ParseUUIDPipe()) installationId: string) {
    return this.readerDevices.status(installationId);
  }

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
  @UseGuards(ReaderDeviceAuthGuard)
  @ApiSecurity("bearer")
  saveReaderResult(
    @Param("eventId", new ParseUUIDPipe()) eventId: string,
    @Body() input: CreateReaderResultDto,
  ) {
    return this.publicService.saveReaderResult(eventId, input);
  }

  @Get("persons/search")
  @UseGuards(ReaderDeviceAuthGuard)
  @ApiSecurity("bearer")
  @ApiQuery({ name: "query", required: true, example: "Meikäläinen" })
  searchPersons(@Query("query") query?: string) {
    return this.publicService.searchPersons(query ?? "");
  }

  @Post("events/:eventId/manual-results")
  @UseGuards(ReaderDeviceAuthGuard)
  @ApiSecurity("bearer")
  addManualResult(
    @Param("eventId", new ParseUUIDPipe()) eventId: string,
    @Body() input: CreateManualResultDto,
  ) {
    return this.publicService.addManualResult(eventId, input);
  }

  @Get("events/:eventId/results")
  results(@Param("eventId", new ParseUUIDPipe()) eventId: string) {
    return this.publicService.results(eventId);
  }

  @Get("events/:eventId/reader-registrations")
  @UseGuards(ReaderDeviceAuthGuard)
  @ApiSecurity("bearer")
  readerRegistrations(@Param("eventId", new ParseUUIDPipe()) eventId: string) {
    return this.publicService.readerRegistrations(eventId);
  }
}
