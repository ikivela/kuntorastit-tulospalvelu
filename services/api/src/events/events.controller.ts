import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CreateEventDto } from "./create-event.dto.js";
import { EventsService } from "./events.service.js";

@ApiTags("events")
@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}
  @Get() list() { return this.events.list(); }
  @Get(":id") get(@Param("id") id: string) { return this.events.get(id); }
  @Post() create(@Body() input: CreateEventDto) { return this.events.create(input); }
}
