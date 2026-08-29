import { Controller, Get, ParseIntPipe, Query } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
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
}
