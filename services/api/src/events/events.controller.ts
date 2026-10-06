import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CreateEventDto } from "./create-event.dto.js";
import { EventsService } from "./events.service.js";
import { UpdateEventDto } from "./update-event.dto.js";
import { CreateCourseDto, UpdateCourseDto } from "./course.dto.js";
import { ImportCoursesDto } from "./import-courses.dto.js";
import { ImportEventsDto } from "./import-events.dto.js";

@ApiTags("events")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}
  @Get() list() { return this.events.list(); }
  @Get("seasons") seasons() { return this.events.seasons(); }
  @Get("seasons/:seasonId/attendance-summary") attendanceSummary(@Param("seasonId") seasonId: string) { return this.events.seasonAttendanceSummary(seasonId); }
  @Get("seasons/:seasonId/attendance-export") attendanceExport(@Param("seasonId") seasonId: string) { return this.events.seasonAttendanceExport(seasonId); }
  @Get(":id") get(@Param("id") id: string) { return this.events.get(id); }
  @Get(":id/registrations") registrations(@Param("id") id: string) { return this.events.registrations(id); }
  @Post("import") importEvents(@Body() input: ImportEventsDto) { return this.events.importEvents(input.rows, input.dryRun ?? false); }
  @Post() create(@Body() input: CreateEventDto) { return this.events.create(input); }
  @Patch(":id") update(@Param("id") id: string, @Body() input: UpdateEventDto) { return this.events.update(id, input); }
  @Delete(":id") remove(@Param("id") id: string) { return this.events.remove(id); }
  @Post(":eventId/courses") createCourse(@Param("eventId") eventId: string, @Body() input: CreateCourseDto) { return this.events.createCourse(eventId, input); }
  @Post(":eventId/courses/import-iof-xml") importCourses(@Param("eventId") eventId: string, @Body() input: ImportCoursesDto) { return this.events.importCourses(eventId, input.xml); }
  @Patch(":eventId/courses/:courseId") updateCourse(@Param("eventId") eventId: string, @Param("courseId") courseId: string, @Body() input: UpdateCourseDto) { return this.events.updateCourse(eventId, courseId, input); }
  @Delete(":eventId/courses/:courseId") removeCourse(@Param("eventId") eventId: string, @Param("courseId") courseId: string) { return this.events.removeCourse(eventId, courseId); }
}
