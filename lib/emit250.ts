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

function decodeFrame(frame: Uint8Array): EmitCard {
  const punches: EmitPunch[] = [];
  for (let index = 0; index < 50; index += 1) {
    const offset = 10 + index * 3;
    const controlCode = frame[offset];
    const timeSeconds = frame[offset + 1] | (frame[offset + 2] << 8);
    if (controlCode !== 0 || timeSeconds !== 0) punches.push({ controlCode, timeSeconds });
  }
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
  expectedCodes: number[];
  invalidIndices: number[];
};

/** Picks the course the punches fit best: exact match, then missing
 * control(s), else the closest course as disqualified. */
export function validateCourse(punches: EmitPunch[], courses: CourseForValidation[]): CourseValidation {
  const candidates = courses
    .filter((course) => course.controls?.length)
    .map((course) => ({
      course,
      // START is never an EMIT punch; a numbered FINISH unit (e.g. "100") is.
      codes: course.controls!
        .filter((item) => item.type !== "START")
        .map((item) => Number(item.controlCodes[0] || item.control.code))
        .filter(Number.isFinite),
    }));
  if (candidates.length === 0) return { status: "UNAVAILABLE", expectedCodes: [], invalidIndices: [] };
  const actual = punches.map((punch) => punch.controlCode);
  const exact = candidates.find(({ codes }) => codes.length === actual.length && codes.every((code, index) => code === actual[index]));
  if (exact) return { status: "ACCEPTED", courseId: exact.course.id, expectedCodes: exact.codes, invalidIndices: [] };
  const missing = candidates.find(({ codes }) => actual.length < codes.length && isSubsequence(actual, codes));
  if (missing) return { status: "MISSING_CONTROL", courseId: missing.course.id, expectedCodes: missing.codes, invalidIndices: [] };
  const closest = candidates.reduce((best, candidate) => {
    const matches = candidate.codes.filter((code, index) => actual[index] === code).length;
    return matches > best.matches ? { candidate, matches } : best;
  }, { candidate: candidates[0], matches: -1 }).candidate;
  return {
    status: "DISQUALIFIED",
    courseId: closest.course.id,
    expectedCodes: closest.codes,
    invalidIndices: actual.flatMap((code, index) => code === closest.codes[index] ? [] : [index]),
  };
}

/** Re-checks the punches against one specific course (when the admin picks
 * the course by hand). */
export function validateAgainstCourse(punches: EmitPunch[], course: CourseForValidation | undefined): CourseValidation {
  return course ? { ...validateCourse(punches, [course]), courseId: course.id } : { status: "UNAVAILABLE", expectedCodes: [], invalidIndices: [] };
}

function isSubsequence(actual: number[], expected: number[]) {
  let actualIndex = 0;
  for (const code of expected) if (actual[actualIndex] === code) actualIndex += 1;
  return actualIndex === actual.length;
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
