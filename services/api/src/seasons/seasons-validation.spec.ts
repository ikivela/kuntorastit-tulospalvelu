import assert from "node:assert/strict";
import test from "node:test";
import { parseDateOnly, planRewards, planSeason } from "./seasons-validation.js";

const current = { name: "Kausi 2026", year: 2026, startsAt: new Date("2026-04-01T00:00:00.000Z"), endsAt: new Date("2026-10-31T00:00:00.000Z") };

test("date-only values parse to UTC midnight and impossible days are rejected", () => {
  assert.equal(parseDateOnly("2027-04-01")?.toISOString(), "2027-04-01T00:00:00.000Z");
  for (const value of ["2027-02-30", "1.4.2027", "2027-04-01T10:00:00Z", ""]) assert.equal(parseDateOnly(value), null, value);
});

test("a complete new season is accepted with a trimmed name", () => {
  const { data, errors } = planSeason({ name: " Kausi 2027 ", year: 2027, startsAt: "2027-04-01", endsAt: "2027-10-31" });
  assert.deepEqual(errors, []);
  assert.equal(data?.name, "Kausi 2027");
  assert.equal(data?.endsAt.toISOString(), "2027-10-31T00:00:00.000Z");
});

test("invalid seasons list every problem in Finnish", () => {
  const { data, errors } = planSeason({ name: " ", year: 1999, startsAt: "2027-13-01", endsAt: "2027-10-31" });
  assert.equal(data, null);
  const messages = errors.join("\n");
  for (const fragment of ["nimi puuttuu", "2000–2100", "Alkamispäivä"]) assert.match(messages, new RegExp(fragment));
});

test("end must be after start, also when only one date is updated", () => {
  assert.match(planSeason({ startsAt: "2027-05-01", endsAt: "2027-05-01" }, current).errors.join(), /Päättymispäivän pitää olla alkamispäivän jälkeen/);
  assert.match(planSeason({ startsAt: "2026-11-01" }, current).errors.join(), /Päättymispäivän/);
  const partial = planSeason({ name: "Syyskausi" }, current);
  assert.deepEqual(partial.errors, []);
  assert.equal(partial.data?.year, 2026);
});

test("rewards keep descriptions of existing rows and get their list order", () => {
  const existingId = "11111111-1111-4111-8111-111111111111";
  const { rewards, errors } = planRewards([{ name: "Pronssi", requiredAttendances: 5 }, { id: existingId, name: " Kulta ", requiredAttendances: 10 }], [{ id: existingId, rewardDescription: "Kuksa" }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(rewards, [
    { name: "Pronssi", requiredAttendances: 5, rewardDescription: null, sortOrder: 0 },
    { name: "Kulta", requiredAttendances: 10, rewardDescription: "Kuksa", sortOrder: 1 },
  ]);
});

test("rewards need a name, a positive count and distinct counts", () => {
  const { rewards, errors } = planRewards([{ name: "A", requiredAttendances: 5 }, { name: "", requiredAttendances: 0 }, { name: "C", requiredAttendances: 5 }]);
  assert.deepEqual(rewards, []);
  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /Palkintoraja 2: nimi puuttuu[\s\S]*Palkintoraja 2: osallistumiskertojen[\s\S]*Palkintoraja 3: kahdella/);
});
