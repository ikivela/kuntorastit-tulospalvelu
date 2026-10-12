import type { DISQUALIFICATION_REASONS, RESULT_STATUSES } from "./update-result.dto.js";

type Status = (typeof RESULT_STATUSES)[number];
type Reason = (typeof DISQUALIFICATION_REASONS)[number];

export type CurrentResult = {
  status: Status | "PENDING";
  durationMs: bigint | null;
  startedAt: Date | null;
  readAt: Date | null;
  disqualificationReason: string | null;
};
export type ResultChanges = { status?: Status; durationSeconds?: number | null; disqualificationReason?: Reason };

/** Fields of an admin correction. Results without time (NO_TIME,
 * DID_NOT_FINISH) have none; otherwise the given time, or the current one.
 * The start stays where it was when known (a card read knows it), else it is
 * the read time minus the time; the finish follows from start + time. */
export function planResultUpdate(current: CurrentResult, changes: ResultChanges) {
  const status = changes.status ?? (current.status === "PENDING" ? "ACCEPTED" : current.status);
  const timed = status !== "NO_TIME" && status !== "DID_NOT_FINISH";
  const durationMs = !timed ? null
    : changes.durationSeconds !== undefined ? (changes.durationSeconds == null ? null : changes.durationSeconds * 1000)
    : current.durationMs == null ? null : Number(current.durationMs);
  const anchor = current.readAt ?? new Date();
  const startedAt = durationMs == null ? null : current.startedAt ?? new Date(anchor.getTime() - durationMs);
  return {
    status,
    durationMs: durationMs == null ? null : BigInt(durationMs),
    startedAt,
    finishedAt: startedAt && durationMs != null ? new Date(startedAt.getTime() + durationMs) : null,
    disqualificationReason: status !== "DISQUALIFIED" ? null : changes.disqualificationReason ?? current.disqualificationReason ?? "WRONG_CONTROL",
  };
}
