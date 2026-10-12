/** Parses a hand-entered time: mm:ss (minutes may exceed 59, e.g. 75:30) or
 * h:mm:ss, the trailing parts as two-digit 00–59, 1 s – 24 h (the range the
 * API accepts). Same rules as the pc-client's parseDurationInput. */
export function parseDuration(value: string) {
  const parts = value.trim().split(":");
  // The first part is minutes (mm:ss, may exceed 59, e.g. 75:30) or hours
  // (h:mm:ss); the rest are two-digit minutes/seconds 00–59, so a typo like
  // 38:75 or the ambiguous 38:5 is rejected instead of silently shifted.
  if (parts.length < 2 || parts.length > 3 || !/^\d{1,4}$/.test(parts[0]) || parts.slice(1).some((part) => !/^[0-5]\d$/.test(part))) return null;
  const numbers = parts.map(Number);
  const seconds = numbers.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1];
  // Same range the API accepts (1 s – 24 h).
  return seconds >= 1 && seconds <= 24 * 60 * 60 ? seconds : null;
}

export const DURATION_FORMAT_HINT = "Anna aika muodossa mm:ss tai h:mm:ss (sekunnit kahdella numerolla, 00–59), esim. 38:42 tai 1:05:09. Enintään 24 tuntia.";

/** 38:42 or 1:05:09. */
export function formatSeconds(total: number) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${hours}:${mmss}` : mmss;
}
