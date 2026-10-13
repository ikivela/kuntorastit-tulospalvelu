/** IOF XML 3.0 ResultList for Livelox's result import
 * (POST /events/external/{id}/resultLists). Each course is its own class,
 * as in the public results page. Livelox uses each runner's start and finish
 * time to sync the GPS route, so those are sent whenever the result has them. */

type PerformanceStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type PunchStatus = "VALID" | "EXTRA" | "MISSING";

export type ResultListPerformance = {
  personId: string;
  firstName: string;
  lastName: string;
  clubName: string | null;
  status: PerformanceStatus;
  durationMs: bigint | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  punches: { sequenceNumber: number; controlCode: string; elapsedMs: bigint | null; status: PunchStatus }[];
};

export type ResultListCourse = {
  name: string;
  lengthMeters: number;
  climbMeters: number | null;
  /** Finish punch codes (e.g. "100"); the finish is FinishTime, not a split. */
  finishCodes: string[];
  /** Newest first, as the public results query orders them. */
  performances: ResultListPerformance[];
};

export type ResultListEvent = { name: string; startsAt: Date; courses: ResultListCourse[] };

// NO_TIME is a card that doesn't match the course; PENDING (not yet checked)
// results are left out.
const iofStatus: Record<Exclude<PerformanceStatus, "PENDING">, string> = {
  ACCEPTED: "OK",
  NO_TIME: "MissingPunch",
  DISQUALIFIED: "Disqualified",
  DID_NOT_FINISH: "DidNotFinish",
};
const statusOrder: Record<PerformanceStatus, number> = { ACCEPTED: 0, NO_TIME: 1, DISQUALIFIED: 2, DID_NOT_FINISH: 3, PENDING: 4 };

export function buildResultListXml(event: ResultListEvent, createdAt = new Date()): string {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${createdAt.toISOString()}" creator="Kuntorastit tulospalvelu" status="Complete">`,
    `  <Event>`,
    `    <Name>${escapeXml(event.name)}</Name>`,
    `    <StartTime><Date>${event.startsAt.toISOString().slice(0, 10)}</Date><Time>${event.startsAt.toISOString().slice(11, 19)}Z</Time></StartTime>`,
    `  </Event>`,
  ];
  for (const course of event.courses) {
    const results = rankedResults(course.performances);
    if (results.length === 0) continue;
    lines.push(
      `  <ClassResult>`,
      `    <Class><Name>${escapeXml(course.name)}</Name></Class>`,
      `    <Course><Name>${escapeXml(course.name)}</Name><Length>${course.lengthMeters}</Length>${course.climbMeters == null ? "" : `<Climb>${course.climbMeters}</Climb>`}</Course>`,
    );
    let position = 0;
    for (const performance of results) {
      const accepted = performance.status === "ACCEPTED";
      if (accepted) position += 1;
      lines.push(
        `    <PersonResult>`,
        `      <Person><Name><Family>${escapeXml(performance.lastName)}</Family><Given>${escapeXml(performance.firstName)}</Given></Name></Person>`,
      );
      if (performance.clubName) lines.push(`      <Organisation><Name>${escapeXml(performance.clubName)}</Name></Organisation>`);
      lines.push(`      <Result>`);
      if (performance.startedAt) lines.push(`        <StartTime>${performance.startedAt.toISOString()}</StartTime>`);
      if (performance.finishedAt) lines.push(`        <FinishTime>${performance.finishedAt.toISOString()}</FinishTime>`);
      if (performance.durationMs != null) lines.push(`        <Time>${seconds(performance.durationMs)}</Time>`);
      if (accepted) lines.push(`        <Position>${position}</Position>`);
      lines.push(`        <Status>${iofStatus[performance.status as keyof typeof iofStatus]}</Status>`);
      for (const punch of [...performance.punches].sort((left, right) => left.sequenceNumber - right.sequenceNumber)) {
        if (course.finishCodes.includes(punch.controlCode)) continue;
        const status = punch.status === "MISSING" ? ` status="Missing"` : punch.status === "EXTRA" ? ` status="Additional"` : "";
        const time = punch.status !== "MISSING" && punch.elapsedMs != null ? `<Time>${seconds(punch.elapsedMs)}</Time>` : "";
        lines.push(`        <SplitTime${status}><ControlCode>${escapeXml(punch.controlCode)}</ControlCode>${time}</SplitTime>`);
      }
      lines.push(`      </Result>`, `    </PersonResult>`);
    }
    lines.push(`  </ClassResult>`);
  }
  lines.push(`</ResultList>`, ``);
  return lines.join("\n");
}

/** Latest performance per person, ranked like the public results page. */
function rankedResults(performances: ResultListPerformance[]) {
  const latest = new Map<string, ResultListPerformance>();
  for (const performance of performances) if (!latest.has(performance.personId)) latest.set(performance.personId, performance);
  return [...latest.values()]
    .filter((performance) => performance.status !== "PENDING")
    .sort((left, right) => statusOrder[left.status] - statusOrder[right.status] || Number(left.durationMs ?? 0n) - Number(right.durationMs ?? 0n));
}

function seconds(ms: bigint): string { return String(Number(ms) / 1000); }

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
