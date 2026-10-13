import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { buildResultListXml, type ResultListPerformance } from "./livelox-result-list.js";

const start = new Date("2026-10-12T15:00:00Z");
function performance(overrides: Partial<ResultListPerformance>): ResultListPerformance {
  return { personId: "p1", firstName: "Matti", lastName: "Meikäläinen", clubName: "Rasti & Polku", status: "ACCEPTED", durationMs: 1_800_000n, startedAt: start, finishedAt: new Date(start.getTime() + 1_800_000), punches: [], ...overrides };
}
function parse(xml: string) {
  assert.equal(XMLValidator.validate(xml), true);
  return new XMLParser({ ignoreAttributes: false, isArray: (name) => ["ClassResult", "PersonResult", "SplitTime"].includes(name) }).parse(xml).ResultList;
}

test("ranks accepted results, keeps the latest per person and skips pending", () => {
  const xml = buildResultListXml({
    name: "Iltarastit <1>",
    startsAt: start,
    courses: [{
      name: "A",
      lengthMeters: 3200,
      climbMeters: null,
      finishCodes: ["100"],
      performances: [
        performance({ personId: "p1", durationMs: 2_000_000n }),
        performance({ personId: "p2", firstName: "Liisa", status: "NO_TIME", durationMs: null, finishedAt: null }),
        performance({ personId: "p3", firstName: "Pekka", durationMs: 1_500_500n }),
        performance({ personId: "p1", durationMs: 1_000_000n }), // older, superseded
        performance({ personId: "p4", status: "PENDING" }),
      ],
    }, { name: "B", lengthMeters: 2000, climbMeters: 40, finishCodes: [], performances: [] }],
  }, start);
  const list = parse(xml);
  assert.equal(list.Event.Name, "Iltarastit <1>");
  assert.equal(list.ClassResult.length, 1, "a course without results is left out");
  const results = list.ClassResult[0].PersonResult;
  assert.deepEqual(results.map((item: { Person: { Name: { Given: string } } }) => item.Person.Name.Given), ["Pekka", "Matti", "Liisa"]);
  assert.equal(results[0].Result.Time, 1500.5);
  assert.equal(results[0].Result.Position, 1);
  assert.equal(results[1].Result.Position, 2);
  assert.equal(results[2].Result.Status, "MissingPunch");
  assert.equal(results[2].Result.Position, undefined);
  assert.equal(results[0].Organisation.Name, "Rasti & Polku");
  assert.equal(results[0].Result.StartTime, "2026-10-12T15:00:00.000Z");
});

test("split times leave out the finish punch and mark missing and extra punches", () => {
  const xml = buildResultListXml({
    name: "Rastit",
    startsAt: start,
    courses: [{
      name: "A",
      lengthMeters: 3200,
      climbMeters: 50,
      finishCodes: ["100"],
      performances: [performance({
        punches: [
          { sequenceNumber: 3, controlCode: "100", elapsedMs: 1_800_000n, status: "VALID" },
          { sequenceNumber: 1, controlCode: "31", elapsedMs: 300_000n, status: "VALID" },
          { sequenceNumber: 2, controlCode: "45", elapsedMs: 600_000n, status: "EXTRA" },
          { sequenceNumber: 4, controlCode: "32", elapsedMs: null, status: "MISSING" },
        ],
      })],
    }],
  });
  const splits = parse(xml).ClassResult[0].PersonResult[0].Result.SplitTime;
  assert.deepEqual(splits.map((split: { ControlCode: number }) => split.ControlCode), [31, 45, 32]);
  assert.equal(splits[0].Time, 300);
  assert.equal(splits[1]["@_status"], "Additional");
  assert.equal(splits[2]["@_status"], "Missing");
  assert.equal(splits[2].Time, undefined);
});
