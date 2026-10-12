import assert from "node:assert/strict";
import test from "node:test";
import { planResultUpdate } from "./result-update.js";

const read = { status: "DISQUALIFIED" as const, durationMs: 9_320_000n, startedAt: new Date("2026-10-12T14:00:00Z"), readAt: new Date("2026-10-12T14:27:00Z"), disqualificationReason: "WRONG_CONTROL" };

test("accepting a result keeps the start and sets the given time", () => {
  const plan = planResultUpdate(read, { status: "ACCEPTED", durationSeconds: 1598 });
  assert.equal(plan.status, "ACCEPTED");
  assert.equal(plan.durationMs, 1_598_000n);
  assert.equal(plan.startedAt?.toISOString(), "2026-10-12T14:00:00.000Z");
  assert.equal(plan.finishedAt?.toISOString(), "2026-10-12T14:26:38.000Z");
  assert.equal(plan.disqualificationReason, null);
});

test("no time and retirement clear the time", () => {
  for (const status of ["NO_TIME", "DID_NOT_FINISH"] as const) {
    const plan = planResultUpdate(read, { status, durationSeconds: 1598 });
    assert.equal(plan.durationMs, null);
    assert.equal(plan.startedAt, null);
    assert.equal(plan.finishedAt, null);
  }
});

test("a disqualification keeps or takes its reason", () => {
  assert.equal(planResultUpdate(read, {}).disqualificationReason, "WRONG_CONTROL");
  assert.equal(planResultUpdate(read, { disqualificationReason: "MISSING_CONTROL" }).disqualificationReason, "MISSING_CONTROL");
});

test("a manual result without a start gets one from its read time", () => {
  const manual = { status: "NO_TIME" as const, durationMs: null, startedAt: null, readAt: new Date("2026-10-12T15:00:00Z"), disqualificationReason: null };
  const plan = planResultUpdate(manual, { status: "ACCEPTED", durationSeconds: 600 });
  assert.equal(plan.startedAt?.toISOString(), "2026-10-12T14:50:00.000Z");
  assert.equal(plan.finishedAt?.toISOString(), "2026-10-12T15:00:00.000Z");
});
