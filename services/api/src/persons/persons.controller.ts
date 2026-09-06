import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { MergePersonsDto } from "./merge-persons.dto.js";
import { PersonsService } from "./persons.service.js";

@ApiTags("persons")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("persons")
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}
  @Get("duplicates") duplicates() { return this.persons.findDuplicates(); }
  @Post("merge") merge(@Body() input: MergePersonsDto) { return this.persons.merge(input.keepPersonId, input.mergePersonIds); }
  @Get(":id/performances") performances(@Param("id") id: string) { return this.persons.performances(id); }
}
