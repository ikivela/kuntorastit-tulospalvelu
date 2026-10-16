/** WinSplits-style split analysis for one course: leg and cumulative times
 * with ranks, plus an estimate of time lost on each leg ("pummi"). */

export type SplitPunch = { sequenceNumber: number; controlCode: number; elapsedMs: number | null; status: "VALID" | "EXTRA" | "MISSING" };
export type SplitResult = { id: string; durationMs: number | null; punches: SplitPunch[] };

export type SplitLeg = {
  splitMs: number;
  splitRank: number;
  cumulativeMs: number;
  cumulativeRank: number;
  /** Estimated time lost on the leg; > 0 only when the leg counts as a mistake. */
  lostMs: number;
};
export type SplitRow<T extends SplitResult> = {
  result: T;
  legs: SplitLeg[];
  /** The runner's own pace relative to the reference times (1.1 = usually
   * 10% slower than the leaders); 100 / level is OLFresults' "perustaso". */
  level: number;
};
export type SplitAnalysis<T extends SplitResult> = {
  /** Control codes in course order; the finish ("M") leg follows the last one. */
  controlCodes: number[];
  rows: SplitRow<T>[];
  /** Per leg: reference time (average of the fastest), best leg time and
   * best cumulative time at that control. */
  referenceMs: number[];
  bestSplitMs: number[];
  bestCumulativeMs: number[];
  /** Results whose punches don't line up with the course (left out). */
  excluded: T[];
};

// A leg is a mistake when it is this much slower than the runner's own pace
// on the course predicts (both conditions must hold).
const MISTAKE_RATIO = 1.2;
const MISTAKE_MIN_MS = 20_000;
// The leg's reference time is the average of this many fastest leg times.
const REFERENCE_RUNNERS = 3;

/** Control times of an accepted result: its VALID punches (the matched
 * course controls) in order. A punched finish is the last VALID punch at the
 * result time, and is the finish rather than a control. */
function controlTimes(result: SplitResult) {
  const valid = [...result.punches].filter((punch) => punch.status === "VALID" && punch.elapsedMs != null).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  if (valid.length && valid.at(-1)!.elapsedMs === result.durationMs) valid.pop();
  return valid.map((punch) => ({ code: punch.controlCode, elapsedMs: punch.elapsedMs! }));
}

/** Results must be accepted ones with a time, in result order. */
export function analyseSplits<T extends SplitResult>(results: T[]): SplitAnalysis<T> {
  const timed = results.filter((result) => result.durationMs != null).map((result) => ({ result, controls: controlTimes(result) }));
  // The course's control order is the one most results share.
  const sequences = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const { controls } of timed) {
    const key = controls.map((control) => control.code).join(",");
    sequences.set(key, controls.map((control) => control.code));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const reference = sequences.get([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "") ?? [];
  const aligned = timed.filter(({ controls }) => controls.length === reference.length && controls.every((control, index) => control.code === reference[index]));
  const alignedIds = new Set(aligned.map(({ result }) => result.id));

  const raw = aligned.map(({ result, controls }) => {
    const cumulative = [...controls.map((control) => control.elapsedMs), result.durationMs!];
    return { result, cumulative, splits: cumulative.map((value, index) => value - (index === 0 ? 0 : cumulative[index - 1])) };
  });
  const legCount = reference.length + 1;
  const splitRanks = Array.from({ length: legCount }, (_, leg) => ranks(raw.map((row) => row.splits[leg])));
  const cumulativeRanks = Array.from({ length: legCount }, (_, leg) => ranks(raw.map((row) => row.cumulative[leg])));
  const referenceMs = Array.from({ length: legCount }, (_, leg) => {
    const fastest = raw.map((row) => row.splits[leg]).sort((a, b) => a - b).slice(0, REFERENCE_RUNNERS);
    return fastest.reduce((sum, value) => sum + value, 0) / fastest.length;
  });

  const rows = raw.map((row, runner) => {
    // The runner's own pace: the median of their legs relative to the
    // reference, so a few mistakes don't make every other leg look slow.
    const index = median(row.splits.map((split, leg) => referenceMs[leg] > 0 ? split / referenceMs[leg] : 1));
    return {
      result: row.result,
      level: index,
      legs: row.splits.map((splitMs, leg) => {
        const expected = referenceMs[leg] * index;
        const lost = splitMs - expected;
        const mistake = splitMs > expected * MISTAKE_RATIO && lost >= MISTAKE_MIN_MS;
        return { splitMs, splitRank: splitRanks[leg][runner], cumulativeMs: row.cumulative[leg], cumulativeRank: cumulativeRanks[leg][runner], lostMs: mistake ? Math.round(lost) : 0 };
      }),
    };
  });
  const best = (values: number[]) => values.length ? Math.min(...values) : 0;
  return {
    controlCodes: reference,
    rows,
    referenceMs,
    bestSplitMs: Array.from({ length: legCount }, (_, leg) => best(raw.map((row) => row.splits[leg]))),
    bestCumulativeMs: Array.from({ length: legCount }, (_, leg) => best(raw.map((row) => row.cumulative[leg]))),
    excluded: results.filter((result) => !alignedIds.has(result.id)),
  };
}

/** Competition ranking: equal times share a rank, the next rank skips. */
function ranks(values: number[]) {
  return values.map((value) => values.filter((other) => other < value).length + 1);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
