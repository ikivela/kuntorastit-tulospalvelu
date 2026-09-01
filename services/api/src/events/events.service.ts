import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateEventDto } from "./create-event.dto.js";
import { UpdateEventDto } from "./update-event.dto.js";
import { CreateCourseDto, UpdateCourseDto } from "./course.dto.js";

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}
  list() { return this.prisma.event.findMany({ include: { courses: { orderBy: { sortOrder: "asc" } }, season: { select: { name: true, year: true } }, _count: { select: { registrations: { where: { status: "ACTIVE" } } } } }, orderBy: { startsAt: "asc" } }).then((events) => events.map(({ _count, ...event }) => ({ ...event, registrationCount: _count.registrations }))); }
  seasons() { return this.prisma.season.findMany({ select: { id: true, name: true, year: true }, orderBy: { year: "desc" } }); }
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
        person: { select: { firstName: true, lastName: true, club: { select: { name: true } } } },
        course: { select: { id: true, name: true } },
        punchCard: { select: { system: true, cardNumber: true } },
      },
      orderBy: [{ course: { sortOrder: "asc" } }, { person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
    });
  }
  create(input: CreateEventDto) {
    return this.prisma.event.create({ data: { ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), registrationOpen: input.registrationOpen ?? false } });
  }
  async update(id: string, input: UpdateEventDto) {
    await this.ensureExists(id);
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
  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.event.delete({ where: { id } });
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
          const codes = asArray(item.Control).map(textValue).filter(Boolean);
          if (codes.length === 0) throw new BadRequestException(`Radan “${name}” ratapisteeltä ${index + 1} puuttuu Control.`);
          const type = controlType(item["@_type"]);
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
