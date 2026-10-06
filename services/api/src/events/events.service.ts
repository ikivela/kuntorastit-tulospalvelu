import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateEventDto } from "./create-event.dto.js";
import { UpdateEventDto } from "./update-event.dto.js";
import { CreateCourseDto, UpdateCourseDto } from "./course.dto.js";
import { NO_COURSES_MESSAGE, planEventImport } from "./events-import.js";

// The club's finish punch unit is always coded 100; IOF CourseData exports
// usually don't assign the finish control an Id at all, since course-planning
// tools don't treat it as a numbered EMIT unit.
const DEFAULT_FINISH_CONTROL_CODE = "100";

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.event.findMany({ include: { courses: { orderBy: { sortOrder: "asc" } }, season: { select: { name: true, year: true } }, _count: { select: { registrations: { where: { status: "ACTIVE" } }, attendances: true } } }, orderBy: { startsAt: "asc" } }).then((events) => events.map(({ _count, ...event }) => ({ ...event, registrationCount: _count.registrations, attendanceCount: _count.attendances }))); }
  seasons() { return this.prisma.season.findMany({ select: { id: true, name: true, year: true }, orderBy: { year: "desc" } }); }
  async seasonAttendanceSummary(seasonId: string) {
    const season = await this.prisma.season.findUnique({
      where: { id: seasonId },
      select: {
        id: true,
        name: true,
        year: true,
        rewards: { orderBy: { requiredAttendances: "asc" }, select: { id: true, name: true, requiredAttendances: true } },
        events: { select: { id: true } },
      },
    });
    if (!season) throw new NotFoundException("Kautta ei löytynyt");
    const eventIds = season.events.map((event) => event.id);
    // Attended (has a recorded result) and registered (may have taken part
    // "omatoimi", on their own time, with no card read or manual entry) both
    // count as a participation — a registration-only event just won't show a
    // name in that event's own results list.
    const personSelect = { select: { id: true, firstName: true, lastName: true, club: { select: { name: true } } } } as const;
    const [attendances, registrations] = eventIds.length === 0 ? [[], []] : await Promise.all([
      this.prisma.attendance.findMany({ where: { eventId: { in: eventIds } }, select: { eventId: true, person: personSelect } }),
      this.prisma.registration.findMany({ where: { eventId: { in: eventIds }, status: "ACTIVE" }, select: { eventId: true, person: personSelect } }),
    ]);
    const byPerson = new Map<string, { firstName: string; lastName: string; clubName: string | null; eventIds: Set<string> }>();
    for (const record of [...attendances, ...registrations]) {
      const entry = byPerson.get(record.person.id) ?? { firstName: record.person.firstName, lastName: record.person.lastName, clubName: record.person.club?.name ?? null, eventIds: new Set<string>() };
      entry.eventIds.add(record.eventId);
      byPerson.set(record.person.id, entry);
    }
    const rows = [...byPerson.entries()]
      .map(([personId, entry]) => ({ personId, firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName, attendanceCount: entry.eventIds.size }))
      .sort((a, b) => b.attendanceCount - a.attendanceCount || a.lastName.localeCompare(b.lastName, "fi") || a.firstName.localeCompare(b.firstName, "fi"));
    return { seasonId: season.id, seasonName: season.name, year: season.year, eventCount: eventIds.length, rewardThresholds: season.rewards, rows };
  }

  /** One row per person-per-event participation in a season (for the
   * "lataa Excel" export) — attended and registration-only ("omatoimi")
   * rows both included, matching seasonAttendanceSummary's counting rule. */
  async seasonAttendanceExport(seasonId: string) {
    const season = await this.prisma.season.findUnique({ where: { id: seasonId }, select: { events: { select: { id: true } } } });
    if (!season) throw new NotFoundException("Kautta ei löytynyt");
    const eventIds = season.events.map((event) => event.id);
    if (eventIds.length === 0) return [];

    const personSelect = { select: { firstName: true, lastName: true, club: { select: { name: true } } } } as const;
    const [attendances, registrations] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { eventId: { in: eventIds } },
        select: {
          eventId: true,
          personId: true,
          event: { select: { name: true, startsAt: true } },
          person: personSelect,
          performances: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, durationMs: true, readAt: true, course: { select: { name: true } } } },
        },
      }),
      this.prisma.registration.findMany({
        where: { eventId: { in: eventIds }, status: "ACTIVE" },
        select: {
          eventId: true,
          personId: true,
          paymentMethod: true,
          registeredAt: true,
          event: { select: { name: true, startsAt: true } },
          person: personSelect,
          course: { select: { name: true } },
        },
      }),
    ]);
    const registrationByKey = new Map(registrations.map((registration) => [`${registration.eventId}:${registration.personId}`, registration]));

    type ExportRow = {
      eventName: string;
      eventStartsAt: Date;
      participatedAt: Date | null;
      firstName: string;
      lastName: string;
      clubName: string | null;
      paymentMethod: string | null;
      courseName: string | null;
      durationMs: number | null;
    };
    const rows: ExportRow[] = attendances.map((attendance) => {
      const registration = registrationByKey.get(`${attendance.eventId}:${attendance.personId}`);
      const latest = attendance.performances[0];
      const courseName: string | null = latest?.course.name ?? registration?.course?.name ?? null;
      return {
        eventName: attendance.event.name,
        eventStartsAt: attendance.event.startsAt,
        participatedAt: registration?.registeredAt ?? latest?.readAt ?? null,
        firstName: attendance.person.firstName,
        lastName: attendance.person.lastName,
        clubName: attendance.person.club?.name ?? null,
        paymentMethod: registration?.paymentMethod ?? null,
        courseName,
        durationMs: latest && latest.status === "ACCEPTED" ? Number(latest.durationMs) : null,
      };
    });
    const attendedKeys = new Set(attendances.map((attendance) => `${attendance.eventId}:${attendance.personId}`));
    for (const registration of registrations) {
      if (attendedKeys.has(`${registration.eventId}:${registration.personId}`)) continue;
      rows.push({
        eventName: registration.event.name,
        eventStartsAt: registration.event.startsAt,
        participatedAt: registration.registeredAt,
        firstName: registration.person.firstName,
        lastName: registration.person.lastName,
        clubName: registration.person.club?.name ?? null,
        paymentMethod: registration.paymentMethod,
        courseName: registration.course?.name ?? null,
        durationMs: null,
      });
    }
    return rows.sort((left, right) => left.eventStartsAt.getTime() - right.eventStartsAt.getTime() || left.lastName.localeCompare(right.lastName, "fi") || left.firstName.localeCompare(right.firstName, "fi"));
  }
  async get(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id }, include: { courses: { orderBy: { sortOrder: "asc" }, include: { controls: { orderBy: { sequenceNumber: "asc" }, include: { control: true } } } } } });
    if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt");
    return event;
  }
  async registrations(id: string) {
    await this.ensureExists(id);
    return this.prisma.registration.findMany({
      where: { eventId: id, status: "ACTIVE" },
      select: {
        id: true,
        registeredAt: true,
        paymentMethod: true,
        notes: true,
        person: { select: { firstName: true, lastName: true, club: { select: { name: true } } } },
        course: { select: { id: true, name: true } },
        punchCard: { select: { system: true, cardNumber: true } },
      },
      orderBy: [{ course: { sortOrder: "asc" } }, { person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
    });
  }
  create(input: CreateEventDto) {
    // A new event has no courses yet, so it always starts as a draft.
    if (input.status && input.status !== "DRAFT") throw new BadRequestException(NO_COURSES_MESSAGE);
    return this.prisma.event.create({ data: { ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), registrationOpen: input.registrationOpen ?? false } });
  }
  async update(id: string, input: UpdateEventDto) {
    const current = await this.prisma.event.findUnique({ where: { id }, select: { status: true, _count: { select: { courses: true } } } });
    if (!current) throw new NotFoundException("Tapahtumaa ei löytynyt");
    if (current.status === "DRAFT" && input.status && input.status !== "DRAFT" && current._count.courses === 0) {
      throw new BadRequestException(NO_COURSES_MESSAGE);
    }
    return this.prisma.event.update({
      where: { id },
      data: {
        ...input,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        version: { increment: 1 },
      },
    });
  }
  async importEvents(rows: Record<string, unknown>[], dryRun: boolean) {
    const ids = rows.map((row) => String(row.id ?? "").trim().toLowerCase()).filter((id) => /^[0-9a-f-]{36}$/.test(id));
    const [seasons, existing] = await Promise.all([
      this.prisma.season.findMany({ select: { id: true, year: true } }),
      this.prisma.event.findMany({ where: { id: { in: ids } }, include: { _count: { select: { courses: true } } } }),
    ]);
    const { changes, errors } = planEventImport(rows, seasons, existing.map(({ _count, ...event }) => ({ ...event, courseCount: _count.courses })));
    const summary = {
      created: changes.filter((change) => change.action === "create").length,
      updated: changes.filter((change) => change.action === "update").length,
      unchanged: changes.filter((change) => change.action === "unchanged").length,
      changes: changes.map(({ row, action, name, ...rest }) => ({ row, action, name, fields: "fields" in rest ? rest.fields : undefined })),
      errors,
    };
    // All-or-nothing: any invalid row blocks the whole import.
    if (errors.length || dryRun) return { ...summary, applied: false };
    await this.prisma.$transaction(changes.flatMap((change) => {
      if (change.action === "create") return [this.prisma.event.create({ data: change.data })];
      if (change.action === "update") return [this.prisma.event.update({ where: { id: change.id }, data: { ...change.data, version: { increment: 1 } } })];
      return [];
    }));
    return { ...summary, applied: true };
  }
  async remove(id: string) {
    await this.ensureExists(id);
    // Performance.course and CourseControl.control are onDelete: Restrict
    // (protects a single course/control from being deleted out from under
    // recorded results via updateCourse/removeCourse). That leaves Postgres's
    // own cascade unable to satisfy them in one statement when the whole
    // event is torn down, so those two tables are cleared explicitly first.
    await this.prisma.$transaction([
      this.prisma.performance.deleteMany({ where: { attendance: { eventId: id } } }),
      this.prisma.courseControl.deleteMany({ where: { course: { eventId: id } } }),
      this.prisma.event.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }
  async createCourse(eventId: string, input: CreateCourseDto) {
    await this.ensureExists(eventId);
    const sortOrder = input.sortOrder ?? (await this.prisma.course.count({ where: { eventId } })) + 1;
    return this.prisma.course.create({ data: { eventId, ...input, sortOrder } });
  }
  async updateCourse(eventId: string, courseId: string, input: UpdateCourseDto) {
    await this.ensureCourse(eventId, courseId);
    return this.prisma.course.update({ where: { id: courseId }, data: input });
  }
  async removeCourse(eventId: string, courseId: string) {
    await this.ensureCourse(eventId, courseId);
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { status: true, _count: { select: { courses: true } } } });
    if (event && event.status !== "DRAFT" && event._count.courses <= 1) {
      throw new BadRequestException("Julkaistulta tapahtumalta ei voi poistaa viimeistä rataa. Palauta tapahtuma luonnokseksi ensin.");
    }
    await this.prisma.course.delete({ where: { id: courseId } });
    return { deleted: true };
  }
  async importCourses(eventId: string, xml: string) {
    await this.ensureExists(eventId);
    const validation = XMLValidator.validate(xml);
    if (validation !== true) throw new BadRequestException(`Virheellinen XML: ${validation.err.msg}`);

    const document = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: true, trimValues: true }).parse(xml) as Record<string, unknown>;
    const root = document.CourseData as Record<string, unknown> | undefined;
    if (!root) throw new BadRequestException("Tiedoston juurielementin pitää olla IOF CourseData.");
    if (String(root["@_iofVersion"] ?? "") !== "3.0") throw new BadRequestException("Vain IOF XML 3.0 CourseData -tiedostoja tuetaan.");

    const raceData = asArray(root.RaceCourseData);
    const controls = new Map<string, ParsedControl>();
    const courses = new Map<string, ParsedCourse>();
    let assignmentCount = 0;
    for (const race of raceData) {
      const raceRecord = race as Record<string, unknown>;
      assignmentCount += asArray(raceRecord.ClassCourseAssignment).length + asArray(raceRecord.PersonCourseAssignment).length + asArray(raceRecord.TeamCourseAssignment).length;
      for (const rawControl of asArray(raceRecord.Control)) {
        const control = rawControl as Record<string, unknown>;
        const code = textValue(control.Id);
        if (!code) throw new BadRequestException("Jokaisella XML-rastilla pitää olla Id.");
        if (controls.has(code)) throw new BadRequestException(`XML sisältää rastin “${code}” useammin kuin kerran.`);
        const position = objectValue(control.Position);
        const mapPosition = objectValue(control.MapPosition);
        controls.set(code, {
          code,
          type: controlType(control["@_type"]),
          name: languageText(control.Name),
          punchingUnitIds: asArray(control.PunchingUnitId).map(textValue).filter(Boolean),
          latitude: optionalNumber(position?.["@_lat"], `Rastin “${code}” latitude`),
          longitude: optionalNumber(position?.["@_lng"], `Rastin “${code}” longitude`),
          altitudeMeters: optionalNumber(position?.["@_alt"], `Rastin “${code}” altitude`),
          mapX: optionalNumber(mapPosition?.["@_x"], `Rastin “${code}” map x`),
          mapY: optionalNumber(mapPosition?.["@_y"], `Rastin “${code}” map y`),
          mapUnit: mapPosition ? String(mapPosition["@_unit"] ?? "mm") : undefined,
        });
      }
      for (const rawCourse of asArray(raceRecord.Course)) {
        const course = rawCourse as Record<string, unknown>;
        const name = String(course.Name ?? "").trim();
        const lengthMeters = Number(course.Length);
        const climbMeters = course.Climb == null || course.Climb === "" ? undefined : Number(course.Climb);
        if (!name) throw new BadRequestException("Jokaisella XML-radalla pitää olla Name.");
        if (!Number.isInteger(lengthMeters) || lengthMeters <= 0) throw new BadRequestException(`Radan “${name}” Length puuttuu tai ei ole positiivinen kokonaisluku.`);
        if (climbMeters !== undefined && (!Number.isInteger(climbMeters) || climbMeters < 0)) throw new BadRequestException(`Radan “${name}” Climb ei ole kelvollinen.`);
        if (courses.has(name)) throw new BadRequestException(`XML sisältää radan “${name}” useammin kuin kerran.`);
        const courseControls = asArray(course.CourseControl).map((rawCourseControl, index) => {
          const item = rawCourseControl as Record<string, unknown>;
          const type = controlType(item["@_type"]);
          let codes = asArray(item.Control).map(textValue).filter(Boolean);
          // IOF CourseData exports commonly omit a Control id for the finish
          // (course-planning tools don't treat it as a numbered EMIT unit).
          // Default it to our club's standard finish punch code instead of
          // rejecting the whole import; other control types still require Id.
          if (codes.length === 0 && type === "FINISH") codes = [DEFAULT_FINISH_CONTROL_CODE];
          if (codes.length === 0) throw new BadRequestException(`Radan “${name}” ratapisteeltä ${index + 1} puuttuu Control.`);
          const mapTextPosition = objectValue(item.MapTextPosition);
          for (const code of codes) {
            const existing = controls.get(code);
            if (!existing) controls.set(code, { code, type, punchingUnitIds: [] });
            else if (existing.type === "NORMAL" && type !== "NORMAL") existing.type = type;
          }
          return {
            sequenceNumber: index + 1,
            type,
            controlCodes: codes,
            mapText: item.MapText == null ? undefined : String(item.MapText),
            mapTextX: optionalNumber(mapTextPosition?.["@_x"], `Radan “${name}” karttatekstin x`),
            mapTextY: optionalNumber(mapTextPosition?.["@_y"], `Radan “${name}” karttatekstin y`),
            mapTextUnit: mapTextPosition ? String(mapTextPosition["@_unit"] ?? "mm") : undefined,
            legLengthMeters: optionalNumber(item.LegLength, `Radan “${name}” välipituus`),
            score: optionalNumber(item.Score, `Radan “${name}” pistemäärä`),
            randomOrder: booleanValue(item["@_randomOrder"]),
            specialInstruction: item["@_specialInstruction"] == null ? undefined : String(item["@_specialInstruction"]),
            tapedRouteLengthMeters: optionalNumber(item["@_tapedRouteLength"], `Radan “${name}” viitoituspituus`),
          };
        });
        courses.set(name, {
          name,
          iofId: textValue(course.Id) || undefined,
          courseFamily: course.CourseFamily == null ? undefined : String(course.CourseFamily),
          lengthMeters,
          climbMeters,
          mapId: optionalInteger(course.MapId, `Radan “${name}” MapId`),
          assignedCompetitors: optionalInteger(course["@_numberOfCompetitors"], `Radan “${name}” kilpailijamäärä`),
          sortOrder: courses.size + 1,
          controls: courseControls,
        });
      }
    }
    if (courses.size === 0) throw new BadRequestException("CourseData-tiedostosta ei löytynyt yhtään Course-elementtiä.");

    const existing = await this.prisma.course.findMany({ where: { eventId, name: { in: [...courses.keys()] } }, select: { name: true } });
    const existingNames = new Set(existing.map((course) => course.name));
    await this.prisma.$transaction(async (transaction) => {
      const controlIds = new Map<string, string>();
      for (const control of controls.values()) {
        const saved = await transaction.control.upsert({
          where: { eventId_code: { eventId, code: control.code } },
          update: { ...control, name: control.name ?? null, latitude: control.latitude ?? null, longitude: control.longitude ?? null, altitudeMeters: control.altitudeMeters ?? null, mapX: control.mapX ?? null, mapY: control.mapY ?? null, mapUnit: control.mapUnit ?? null },
          create: { eventId, ...control },
        });
        controlIds.set(control.code, saved.id);
      }
      for (const course of courses.values()) {
        const { controls: courseControls, ...courseData } = course;
        const saved = await transaction.course.upsert({
          where: { eventId_name: { eventId, name: course.name } },
          update: { ...courseData, iofId: course.iofId ?? null, courseFamily: course.courseFamily ?? null, climbMeters: course.climbMeters ?? null, mapId: course.mapId ?? null, assignedCompetitors: course.assignedCompetitors ?? null },
          create: { eventId, ...courseData },
        });
        await transaction.courseControl.deleteMany({ where: { courseId: saved.id } });
        for (const courseControl of courseControls) {
          const controlId = controlIds.get(courseControl.controlCodes[0]);
          if (!controlId) throw new BadRequestException(`Rataa “${course.name}” vastaavaa rastia ei löytynyt.`);
          await transaction.courseControl.create({ data: { courseId: saved.id, controlId, ...courseControl } });
        }
      }
    });
    return {
      imported: courses.size,
      created: courses.size - existingNames.size,
      updated: existingNames.size,
      controls: controls.size,
      courseControls: [...courses.values()].reduce((sum, course) => sum + course.controls.length, 0),
      assignmentsIgnored: assignmentCount,
    };
  }
  private async ensureExists(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) throw new NotFoundException("Tapahtumaa ei löytynyt");
  }
  private async ensureCourse(eventId: string, courseId: string) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, eventId }, select: { id: true } });
    if (!course) throw new NotFoundException("Rataa ei löytynyt");
  }
}

function asArray(value: unknown): unknown[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function objectValue(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function textValue(value: unknown): string { const object = objectValue(value); return String(object?.["#text"] ?? value ?? "").trim(); }
function languageText(value: unknown): string | undefined { const first = asArray(value)[0]; const text = textValue(first); return text || undefined; }
function optionalNumber(value: unknown, field: string): number | undefined { if (value == null || value === "") return undefined; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new BadRequestException(`${field} ei ole kelvollinen numero.`); return parsed; }
function optionalInteger(value: unknown, field: string): number | undefined { const parsed = optionalNumber(value, field); if (parsed !== undefined && !Number.isInteger(parsed)) throw new BadRequestException(`${field} ei ole kokonaisluku.`); return parsed; }
function booleanValue(value: unknown): boolean { return value === true || String(value).toLowerCase() === "true" || String(value) === "1"; }
function controlType(value: unknown): "START" | "NORMAL" | "FINISH" | "CROSSING_POINT" | "END_OF_MARKED_ROUTE" {
  return ({ Start: "START", Control: "NORMAL", Finish: "FINISH", CrossingPoint: "CROSSING_POINT", EndOfMarkedRoute: "END_OF_MARKED_ROUTE" } as Record<string, "START" | "NORMAL" | "FINISH" | "CROSSING_POINT" | "END_OF_MARKED_ROUTE">)[String(value ?? "Control")] ?? "NORMAL";
}
type ParsedControl = { code: string; type: ReturnType<typeof controlType>; name?: string; punchingUnitIds: string[]; latitude?: number; longitude?: number; altitudeMeters?: number; mapX?: number; mapY?: number; mapUnit?: string };
type ParsedCourseControl = { sequenceNumber: number; type: ReturnType<typeof controlType>; controlCodes: string[]; mapText?: string; mapTextX?: number; mapTextY?: number; mapTextUnit?: string; legLengthMeters?: number; score?: number; randomOrder: boolean; specialInstruction?: string; tapedRouteLengthMeters?: number };
type ParsedCourse = { name: string; iofId?: string; courseFamily?: string; lengthMeters: number; climbMeters?: number; mapId?: number; assignedCompetitors?: number; sortOrder: number; controls: ParsedCourseControl[] };
