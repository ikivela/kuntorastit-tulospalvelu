import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type DuplicateCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  clubName: string | null;
  registrationCount: number;
  attendanceCount: number;
};

@Injectable()
export class PersonsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Groups persons that are likely the same real competitor stored under
   * slightly different spellings, so an admin can review and merge them
   * once per season before counting attendances. Club is a tiebreaker, not a
   * requirement: it's often left blank on one submission and filled in on
   * another, so a blank club is treated as compatible with anything — only
   * two DIFFERENT non-blank clubs rule a pair out. "exact" groups match after
   * stripping case/diacritics/whitespace and ignoring first/last name order;
   * "similar" pairs share an exact last name with a first name that's off by
   * a small edit distance (typos), or vice versa.
   */
  async findDuplicates() {
    const persons = await this.prisma.person.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        club: { select: { name: true } },
        _count: { select: { registrations: true, attendances: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    const candidates: DuplicateCandidate[] = persons.map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      clubName: person.club?.name ?? null,
      registrationCount: person._count.registrations,
      attendanceCount: person._count.attendances,
    }));

    const nameGroups = new Map<string, DuplicateCandidate[]>();
    for (const candidate of candidates) {
      const key = [normalize(candidate.firstName), normalize(candidate.lastName)].sort().join("|");
      (nameGroups.get(key) ?? nameGroups.set(key, []).get(key)!).push(candidate);
    }
    const exact = [...nameGroups.values()].filter((group) => group.length > 1).flatMap((group) => clusterByCompatibleClub(group));
    const grouped = new Set(exact.flatMap((group) => group.map((person) => person.id)));

    // Typos can land in either name, so bucket by whichever field stays exact
    // and allow the other to be off by a small edit distance.
    const similarPairs = new Map<string, DuplicateCandidate[]>();
    const collectSimilar = (bucketBy: (person: DuplicateCandidate) => string, fuzzyField: (person: DuplicateCandidate) => string) => {
      const buckets = new Map<string, DuplicateCandidate[]>();
      for (const candidate of candidates) {
        const key = bucketBy(candidate);
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(candidate);
      }
      for (const bucket of buckets.values()) {
        for (let i = 0; i < bucket.length; i += 1) {
          for (let j = i + 1; j < bucket.length; j += 1) {
            const [a, b] = [bucket[i], bucket[j]];
            if (grouped.has(a.id) && grouped.has(b.id)) continue;
            if (!clubsCompatible(a.clubName, b.clubName)) continue;
            const distance = levenshtein(normalize(fuzzyField(a)), normalize(fuzzyField(b)));
            if (distance > 0 && distance <= 2) similarPairs.set([a.id, b.id].sort().join("|"), [a, b]);
          }
        }
      }
    };
    collectSimilar((person) => normalize(person.lastName), (person) => person.firstName);
    collectSimilar((person) => normalize(person.firstName), (person) => person.lastName);
    const similar = [...similarPairs.values()];

    return {
      exact: exact.map((group) => ({ confidence: "exact" as const, persons: group })),
      similar: similar.map((group) => ({ confidence: "similar" as const, persons: group })),
    };
  }

  async merge(keepPersonId: string, mergePersonIds: string[]) {
    const sourceIds = [...new Set(mergePersonIds)].filter((id) => id !== keepPersonId);
    if (sourceIds.length === 0) throw new BadRequestException("Yhdistettäviä henkilöitä ei annettu.");

    const found = await this.prisma.person.findMany({ where: { id: { in: [keepPersonId, ...sourceIds] } }, select: { id: true } });
    if (found.length !== sourceIds.length + 1) throw new NotFoundException("Jotain henkilöistä ei löytynyt.");

    await this.prisma.$transaction(async (tx) => {
      for (const sourceId of sourceIds) {
        for (const registration of await tx.registration.findMany({ where: { personId: sourceId } })) {
          const conflict = await tx.registration.findUnique({ where: { eventId_personId: { eventId: registration.eventId, personId: keepPersonId } } });
          if (conflict) await tx.registration.delete({ where: { id: registration.id } });
          else await tx.registration.update({ where: { id: registration.id }, data: { personId: keepPersonId } });
        }

        for (const attendance of await tx.attendance.findMany({ where: { personId: sourceId } })) {
          const target = await tx.attendance.findUnique({ where: { eventId_personId: { eventId: attendance.eventId, personId: keepPersonId } } });
          if (target) {
            await tx.performance.updateMany({ where: { attendanceId: attendance.id }, data: { attendanceId: target.id } });
            await tx.attendance.delete({ where: { id: attendance.id } });
          } else {
            await tx.attendance.update({ where: { id: attendance.id }, data: { personId: keepPersonId } });
          }
        }

        await tx.personPunchCard.updateMany({ where: { personId: sourceId }, data: { personId: keepPersonId } });
        await tx.person.delete({ where: { id: sourceId } });
      }
    });

    return { keptPersonId: keepPersonId, mergedCount: sourceIds.length };
  }

  /** A person's own participation history: one row per event they either
   * have an attendance for, or are actively registered for without ever
   * getting a recorded result (an "omatoimi" — self-guided, on their own
   * time — participation leaves no card read or manual entry). Attended
   * rows carry their latest performance's course, status, duration and rank
   * within that course (same ranking rule as the public results view —
   * latest performance per person, ACCEPTED sorted by time). */
  async performances(personId: string) {
    const person = await this.prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
    if (!person) throw new NotFoundException("Henkilöä ei löytynyt.");

    const attendances = await this.prisma.attendance.findMany({
      where: { personId },
      select: {
        event: { select: { id: true, name: true, startsAt: true } },
        performances: {
          orderBy: { updatedAt: "desc" },
          select: { id: true, courseId: true, status: true, durationMs: true, course: { select: { name: true } } },
        },
      },
      orderBy: { event: { startsAt: "desc" } },
    });
    const attendedEventIds = attendances.map((attendance) => attendance.event.id);

    const registrations = await this.prisma.registration.findMany({
      where: { personId, status: "ACTIVE", eventId: { notIn: attendedEventIds } },
      select: { event: { select: { id: true, name: true, startsAt: true } }, course: { select: { name: true } } },
      orderBy: { event: { startsAt: "desc" } },
    });

    const rankCache = new Map<string, Map<string, number | null>>();
    const rows = [];
    for (const attendance of attendances) {
      const latest = attendance.performances[0];
      if (!latest) {
        rows.push({ eventId: attendance.event.id, eventName: attendance.event.name, eventStartsAt: attendance.event.startsAt, courseName: null, status: null, durationMs: null, rank: null, participationType: "ATTENDED" as const });
        continue;
      }
      if (!rankCache.has(latest.courseId)) rankCache.set(latest.courseId, await this.rankByPersonInCourse(latest.courseId));
      rows.push({
        eventId: attendance.event.id,
        eventName: attendance.event.name,
        eventStartsAt: attendance.event.startsAt,
        courseName: latest.course.name,
        status: latest.status,
        durationMs: latest.durationMs == null ? null : Number(latest.durationMs),
        rank: rankCache.get(latest.courseId)!.get(personId) ?? null,
        participationType: "ATTENDED" as const,
      });
    }
    for (const registration of registrations) {
      rows.push({
        eventId: registration.event.id,
        eventName: registration.event.name,
        eventStartsAt: registration.event.startsAt,
        courseName: registration.course?.name ?? null,
        status: null,
        durationMs: null,
        rank: null,
        participationType: "REGISTERED_ONLY" as const,
      });
    }
    rows.sort((left, right) => new Date(right.eventStartsAt).getTime() - new Date(left.eventStartsAt).getTime());
    return rows;
  }

  private async rankByPersonInCourse(courseId: string) {
    const performances = await this.prisma.performance.findMany({
      where: { courseId },
      orderBy: { updatedAt: "desc" },
      select: { status: true, durationMs: true, attendance: { select: { personId: true } } },
    });
    const latestByPerson = new Map<string, (typeof performances)[number]>();
    for (const performance of performances) {
      if (!latestByPerson.has(performance.attendance.personId)) latestByPerson.set(performance.attendance.personId, performance);
    }
    const statusOrder = { ACCEPTED: 0, NO_TIME: 1, DISQUALIFIED: 2, DID_NOT_FINISH: 3, PENDING: 4 };
    const sorted = [...latestByPerson.entries()].sort(([, left], [, right]) => {
      const statusDifference = statusOrder[left.status] - statusOrder[right.status];
      if (statusDifference !== 0) return statusDifference;
      return Number(left.durationMs ?? 0n) - Number(right.durationMs ?? 0n);
    });
    const rankByPersonId = new Map<string, number | null>();
    let acceptedRank = 0;
    for (const [personId, performance] of sorted) {
      if (performance.status === "ACCEPTED") acceptedRank += 1;
      rankByPersonId.set(personId, performance.status === "ACCEPTED" ? acceptedRank : null);
    }
    return rankByPersonId;
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clubsCompatible(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return true;
  return normalize(a) === normalize(b);
}

/** Splits a name-matched group into clusters of mutually club-compatible
 * people (union-find over the compatible-pair relation), since a blank club
 * can bridge two records that don't themselves share a club. */
function clusterByCompatibleClub(group: DuplicateCandidate[]): DuplicateCandidate[][] {
  const parent = new Map(group.map((person) => [person.id, person.id]));
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; return root; };
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      if (!clubsCompatible(group[i].clubName, group[j].clubName)) continue;
      const [rootA, rootB] = [find(group[i].id), find(group[j].id)];
      if (rootA !== rootB) parent.set(rootA, rootB);
    }
  }
  const clusters = new Map<string, DuplicateCandidate[]>();
  for (const person of group) {
    const root = find(person.id);
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(person);
  }
  return [...clusters.values()].filter((cluster) => cluster.length > 1);
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}
