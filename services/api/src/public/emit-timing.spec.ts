import assert from "node:assert/strict";
import test from "node:test";
import { cardTiming, withoutReadoutPunch } from "./emit-timing.js";

const control = (type: string, code: string) => ({ type, controlCodes: [code], control: { code } });
const course = (codes: string[], finish = "M") => [control("START", "L"), ...codes.map((code) => control("NORMAL", code)), control("FINISH", finish)];
const punches = (rows: number[][]) => rows.map(([controlCode, timeSeconds]) => ({ controlCode, timeSeconds }));

// A real Halkokari C course card: times are from the start, then the finish
// unit (100) and a readout unit (250).
const card = punches([[32, 180], [165, 500], [164, 1140], [141, 1263], [41, 1463], [43, 1573], [100, 1598], [250, 1603]]);

test("times are from the start and the result is the punch after the last control", () => {
  const timing = cardTiming(card, course(["32", "165", "164", "141", "41", "43"]));
  assert.deepEqual(timing.matchedIndices, [0, 1, 2, 3, 4, 5]);
  assert.equal(timing.resultSeconds, 1598);
});

test("a numbered finish control is the finish punch", () => {
  assert.equal(cardTiming(card, course(["32", "165", "164", "141", "41", "43"], "100")).resultSeconds, 1598);
  assert.equal(cardTiming(card, course(["32", "165"], "250")).resultSeconds, 1603);
});

test("extra punches between controls are allowed", () => {
  const timing = cardTiming(punches([[32, 100], [99, 150], [165, 300], [100, 360]]), course(["32", "165"]));
  assert.deepEqual(timing.matchedIndices, [0, 2]);
  assert.equal(timing.resultSeconds, 360);
});

test("the readout unit punch is dropped only at the end", () => {
  assert.deepEqual(withoutReadoutPunch(card).map((punch) => punch.controlCode), [32, 165, 164, 141, 41, 43, 100]);
  assert.equal(withoutReadoutPunch(punches([[250, 60], [100, 120]])).length, 2);
});

test("a missing control or no finish punch falls back to the last punch", () => {
  assert.equal(cardTiming(punches([[32, 100], [41, 400], [100, 460]]), course(["32", "165", "41"])).resultSeconds, 460);
  assert.equal(cardTiming(punches([[32, 100], [165, 300]]), course(["32", "165"])).resultSeconds, 300);
  assert.equal(cardTiming([], course(["32"])).resultSeconds, null);
});
