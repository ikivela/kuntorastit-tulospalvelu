import assert from "node:assert/strict";
import test from "node:test";
import { planEventImport, type ExistingImportEvent } from "./events-import.js";

const seasons = [{ id: "season-2026", year: 2026 }];
const existingId = "11111111-1111-4111-8111-111111111111";
const existing: ExistingImportEvent = {
  id: existingId,
  seasonId: "season-2026",
  name: "Karhi",
  locationName: "Lohtaja",
  address: null,
  locationDescription: null,
  latitude: { toString: () => "63.950000" },
  longitude: null,
  startsAt: new Date("2026-06-15T15:00:00.000Z"),
  endsAt: new Date("2026-06-15T17:00:00.000Z"),
  status: "PUBLISHED",
  registrationOpen: true,
  paymentMethods: ["E-passi", "Smartum"],
  courseCount: 2,
};
const unchangedRow = {
  row: 2, id: existingId, seasonYear: 2026, name: "Karhi", locationName: "Lohtaja", address: "", locationDescription: "",
  latitude: 63.95, longitude: "", startsAt: "2026-06-15T15:00:00.000Z", endsAt: "2026-06-15T17:00:00.000Z",
  status: "Julkaistu", registrationOpen: "Kyllä", paymentMethods: "E-passi\nSmartum",
};

test("row matching the database is unchanged", () => {
  const plan = planEventImport([unchangedRow], seasons, [existing]);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.changes[0].action, "unchanged");
});

test("edited row becomes an update listing changed fields", () => {
  const plan = planEventImport([{ ...unchangedRow, name: "Karhi 2", registrationOpen: "Ei" }], seasons, [existing]);
  const change = plan.changes[0];
  assert.equal(change.action, "update");
  assert.deepEqual(change.action === "update" && change.fields, ["Nimi", "Ilmoittautuminen auki"]);
});

test("row without ID creates an event with defaults", () => {
  const plan = planEventImport([{ row: 3, seasonYear: "2026", name: "Uusi", startsAt: "15.7.2026 18:00", endsAt: "15.7.2026 20:00" }], seasons, []);
  assert.deepEqual(plan.errors, []);
  const change = plan.changes[0];
  assert.equal(change.action, "create");
  assert.equal(change.action === "create" && change.data.status, "DRAFT");
  assert.equal(change.action === "create" && change.data.registrationOpen, false);
});

test("invalid rows are reported with their Excel row number", () => {
  const plan = planEventImport([
    { row: 4, seasonYear: 2030, name: "", startsAt: "huomenna", endsAt: "2026-06-15T17:00:00Z", status: "Peruttu", latitude: "200" },
    { row: 5, id: "22222222-2222-4222-8222-222222222222", seasonYear: 2026, name: "X", startsAt: "2026-06-15T17:00:00Z", endsAt: "2026-06-15T15:00:00Z" },
  ], seasons, []);
  assert.equal(plan.changes.length, 0);
  assert.ok(plan.errors.every((error) => error.row === 4 || error.row === 5));
  const messages = plan.errors.map((error) => error.message).join("\n");
  for (const fragment of ["Nimi puuttuu", "Kautta 2030", "Alkaa", "Tila \"Peruttu\"", "Leveysaste", "ei löydy", "Päättymisajan"]) {
    assert.match(messages, new RegExp(fragment));
  }
});

test("same ID twice is rejected", () => {
  const plan = planEventImport([unchangedRow, { ...unchangedRow, row: 3 }], seasons, [existing]);
  assert.deepEqual(plan.errors, [{ row: 3, message: "Sama ID on myös rivillä 2." }]);
});

test("new events must be drafts and drafts without courses can't be published", () => {
  const newPublished = planEventImport([{ row: 2, seasonYear: 2026, name: "Uusi", startsAt: "2026-07-01T15:00:00Z", endsAt: "2026-07-01T17:00:00Z", status: "Julkaistu" }], seasons, []);
  assert.match(newPublished.errors[0]?.message ?? "", /luonnoksena/);
  const draft = { ...existing, status: "DRAFT" as const, courseCount: 0 };
  const publishDraft = planEventImport([{ ...unchangedRow, status: "Julkaistu" }], seasons, [draft]);
  assert.match(publishDraft.errors[0]?.message ?? "", /radat/);
  const withCourses = planEventImport([{ ...unchangedRow, status: "Julkaistu" }], seasons, [{ ...draft, courseCount: 3 }]);
  assert.deepEqual(withCourses.errors, []);
});

test("a year shared by seasons of two series is ambiguous except for an event's own season", () => {
  const twoSeries = [...seasons, { id: "other-2026", year: 2026 }];
  const created = planEventImport([{ row: 2, seasonYear: 2026, name: "Uusi", startsAt: "2026-07-01T15:00:00Z", endsAt: "2026-07-01T17:00:00Z" }], twoSeries, []);
  assert.match(created.errors[0]?.message ?? "", /useammassa tapahtumasarjassa/);
  const kept = planEventImport([unchangedRow], twoSeries, [existing]);
  assert.deepEqual(kept.errors, []);
  assert.equal(kept.changes[0].action, "unchanged");
});
