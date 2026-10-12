// EMIT 250 card reading in the browser via Web Serial. Mirrors the pc-client
// (clients/pc-client/src-tauri/src/lib.rs and validateCourse in
// clients/pc-client/src/main.tsx) so both readers produce identical results.

export const EMIT_250_BAUD_RATE = 9600;
const FRAME_LENGTH = 217;
const EMIT_OD = 255 - 32; // every byte on the wire is XORed with 0xDF

export type EmitPunch = { controlCode: number; timeSeconds: number };
export type EmitCard = { cardNumber: number; punches: EmitPunch[]; productionWeek: number; productionYear: number; signature: string };

/** Finds and decodes the first complete, checksum-valid card frame in raw
 * serial bytes. Returns the frame and how many raw bytes it consumed. */
export function findEmit250Frame(raw: Uint8Array): { card: EmitCard; end: number } | null {
  for (let start = 0; start + FRAME_LENGTH <= raw.length; start += 1) {
    if ((raw[start] ^ EMIT_OD) !== 0xff || (raw[start + 1] ^ EMIT_OD) !== 0xff) continue;
    const frame = raw.slice(start, start + FRAME_LENGTH).map((byte) => byte ^ EMIT_OD);
    if (frame.reduce((sum, byte) => sum + byte, 0) % 256 !== 0) continue;
    return { card: decodeFrame(frame), end: start + FRAME_LENGTH };
  }
  return null;
}

const READOUT_UNIT_CODE = 250;

function decodeFrame(frame: Uint8Array): EmitCard {
  const punches: EmitPunch[] = [];
  for (let index = 0; index < 50; index += 1) {
    const offset = 10 + index * 3;
    const controlCode = frame[offset];
    const timeSeconds = frame[offset + 1] | (frame[offset + 2] << 8);
    if (controlCode !== 0 || timeSeconds !== 0) punches.push({ controlCode, timeSeconds });
  }
  // The readout unit writes its own code as the last punch when the card is
  // read; it is not a control.
  if (punches.at(-1)?.controlCode === READOUT_UNIT_CODE) punches.pop();
  return {
    cardNumber: frame[2] | (frame[3] << 8) | (frame[4] << 16),
    punches,
    productionWeek: frame[6],
    productionYear: frame[7],
    // Same card read twice gives the same bytes; used to skip repeats.
    signature: Array.from(frame, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

export type CourseForValidation = { id: string; name: string; controls?: { type: string; controlCodes: string[]; control: { code: string } }[] };
export type CourseValidation = {
  status: "ACCEPTED" | "MISSING_CONTROL" | "DISQUALIFIED" | "UNAVAILABLE";
  courseId?: string;
  matchedIndices: number[]; // punch index of each course control found, in course order
  missingCodes: number[];
  finishIndex: number | null; // punch whose time is the result
  resultSeconds: number | null;
};

// EMIT punch times are seconds from the start (cumulative), not leg times.
export function splitSeconds(punches: EmitPunch[], index: number) {
  return punches[index].timeSeconds - (index > 0 ? punches[index - 1].timeSeconds : 0);
}

/** Codes a card must contain in order: the course's controls, plus its
 * FINISH when that is a numbered punch unit (e.g. "100"). START is never
 * punched, and a symbolic finish ("M") has no punch of its own. */
function courseCodes(course: CourseForValidation) {
  const numbered = (course.controls ?? [])
    .filter((item) => item.type !== "START")
    .map((item) => ({ type: item.type, code: Number(item.controlCodes[0] || item.control.code) }))
    .filter((item) => Number.isFinite(item.code));
  return { codes: numbered.map((item) => item.code), finishPunched: numbered.at(-1)?.type === "FINISH" };
}

/** Checks a card against one course the way orienteering rules do: every
 * course control must be found in order, extra punches (a finish or readout
 * unit, a control visited by mistake) are allowed. The result time is the
 * finish punch: the course's numbered finish, or else the first punch after
 * the last control; without one, the last punch. */
function checkCard(punches: EmitPunch[], codes: number[], finishPunched: boolean): Omit<CourseValidation, "courseId"> {
  const matchedIndices: number[] = [];
  const missingCodes: number[] = [];
  let from = 0;
  for (const code of codes) {
    const index = punches.findIndex((punch, punchIndex) => punchIndex >= from && punch.controlCode === code);
    if (index === -1) { missingCodes.push(code); continue; }
    matchedIndices.push(index);
    from = index + 1;
  }
  const status = missingCodes.length === 0 ? "ACCEPTED" : matchedIndices.length * 2 >= codes.length ? "MISSING_CONTROL" : "DISQUALIFIED";
  const lastMatched = matchedIndices.at(-1);
  const finishIndex = status !== "ACCEPTED" || lastMatched == null ? null
    : finishPunched ? lastMatched
    : lastMatched + 1 < punches.length ? lastMatched + 1 : null;
  const resultPunch = finishIndex != null ? punches[finishIndex] : punches.at(-1);
  return { status, matchedIndices, missingCodes, finishIndex, resultSeconds: resultPunch?.timeSeconds ?? null };
}

function unavailable(punches: EmitPunch[]): CourseValidation {
  return { status: "UNAVAILABLE", matchedIndices: [], missingCodes: [], finishIndex: null, resultSeconds: punches.at(-1)?.timeSeconds ?? null };
}

/** Picks the course the card fits best: an accepted course with the most
 * controls (a card that completes C also contains the shorter D), else the
 * one with the largest share of its controls found. */
export function validateCourse(punches: EmitPunch[], courses: CourseForValidation[]): CourseValidation {
  const candidates = courses
    .map((course) => ({ course, ...courseCodes(course) }))
    .filter((candidate) => candidate.codes.length > 0)
    .map((candidate) => ({ ...candidate, check: checkCard(punches, candidate.codes, candidate.finishPunched) }));
  if (candidates.length === 0) return unavailable(punches);
  const score = (candidate: (typeof candidates)[number]) => candidate.check.status === "ACCEPTED"
    ? 2 + candidate.codes.length / 1000
    : candidate.check.matchedIndices.length / candidate.codes.length;
  const best = candidates.reduce((winner, candidate) => score(candidate) > score(winner) ? candidate : winner);
  return { ...best.check, courseId: best.course.id };
}

/** Re-checks the punches against one specific course (when the admin picks
 * the course by hand). */
export function validateAgainstCourse(punches: EmitPunch[], course: CourseForValidation | undefined): CourseValidation {
  return course ? { ...validateCourse(punches, [course]), courseId: course.id } : unavailable(punches);
}

// --- Web Serial (Chrome/Edge, secure context only) ---

type SerialPortLike = {
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: "none" | "even" | "odd" }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
};
type SerialLike = { requestPort(): Promise<SerialPortLike> };

export function webSerialSupport(): "ok" | "insecure" | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return "serial" in navigator ? "ok" : "unsupported";
}

/** Opens a user-chosen serial port and calls onCard for every new card.
 * Returns a stop function that releases the port. */
export async function startEmitReader(onCard: (card: EmitCard) => void, onError: (message: string) => void): Promise<() => Promise<void>> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  const port = await serial.requestPort();
  await port.open({ baudRate: EMIT_250_BAUD_RATE, dataBits: 8, stopBits: 2, parity: "none" });
  let stopped = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let lastSignature = "";
  const loop = (async () => {
    if (!port.readable) { onError("Sarjaportista ei voi lukea."); return; }
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer); merged.set(value, buffer.length);
        buffer = merged;
        let found;
        while ((found = findEmit250Frame(buffer))) {
          buffer = buffer.slice(found.end);
          // The reader repeats a frame while the card stays on it.
          if (found.card.signature !== lastSignature) { lastSignature = found.card.signature; onCard(found.card); }
        }
        if (buffer.length > FRAME_LENGTH * 4) buffer = buffer.slice(buffer.length - FRAME_LENGTH * 2);
      }
    } catch (error) {
      if (!stopped) onError(`Lukijan yhteys katkesi: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reader.releaseLock();
    }
  })();
  return async () => {
    stopped = true;
    await reader?.cancel().catch(() => undefined);
    await loop.catch(() => undefined);
    await port.close().catch(() => undefined);
  };
}
