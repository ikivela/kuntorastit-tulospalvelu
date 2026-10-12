/** Timing of an EMIT card read against its course. EMIT punch times are
 * seconds from the start (cumulative), not leg times. Mirrors the clients'
 * card check (pc-client main.tsx, lib/emit250.ts) so the stored result time
 * matches what the operator confirmed. */

export type TimedPunch = { controlCode: number; timeSeconds: number };
export type CourseControlForTiming = { type: string; controlCodes: string[]; control: { code: string } };

/** The readout unit writes its own code (250) as the card's last punch when
 * the card is read; it is not a control. Current clients drop it already;
 * this also covers reads from older clients and stored raw data. */
export function withoutReadoutPunch<T extends TimedPunch>(punches: T[]): T[] {
  return punches.at(-1)?.controlCode === 250 ? punches.slice(0, -1) : punches;
}

export type CardTiming = {
  matchedIndices: number[]; // punch index of each course control found, in course order
  resultSeconds: number | null; // finish punch time, or the last punch without one
};

/** Every course control must be found in order; extra punches (a finish or
 * readout unit, a control visited by mistake) are allowed. The finish punch
 * is the course's numbered FINISH (e.g. "100"), or else the first punch after
 * the last control; a symbolic finish ("M") has no punch of its own. */
export function cardTiming(punches: TimedPunch[], controls: CourseControlForTiming[]): CardTiming {
  const numbered = controls
    .filter((item) => item.type !== "START")
    .map((item) => ({ type: item.type, code: Number(item.controlCodes[0] || item.control.code) }))
    .filter((item) => Number.isFinite(item.code));
  const finishPunched = numbered.at(-1)?.type === "FINISH";
  const matchedIndices: number[] = [];
  let missing = 0;
  let from = 0;
  for (const { code } of numbered) {
    const index = punches.findIndex((punch, punchIndex) => punchIndex >= from && punch.controlCode === code);
    if (index === -1) { missing += 1; continue; }
    matchedIndices.push(index);
    from = index + 1;
  }
  const lastMatched = matchedIndices.at(-1);
  const finishIndex = missing > 0 || lastMatched == null ? null
    : finishPunched ? lastMatched
    : lastMatched + 1 < punches.length ? lastMatched + 1 : null;
  const resultPunch = finishIndex != null ? punches[finishIndex] : punches.at(-1);
  return { matchedIndices, resultSeconds: resultPunch?.timeSeconds ?? null };
}
