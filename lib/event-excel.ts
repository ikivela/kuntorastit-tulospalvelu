// Excel round-trip for the admin event list: one row = one event. The
// exported file can be edited and uploaded back; rows with an ID update that
// event, rows without one create new events (validated by POST /events/import).
import * as XLSX from "xlsx";

export type ExcelEvent = {
  id: string;
  name: string;
  locationName: string | null;
  address: string | null;
  locationDescription: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  startsAt: string;
  endsAt: string;
  status: string;
  registrationOpen: boolean;
  paymentMethods: string[];
  season: { year: number };
};

export type ImportRow = Record<string, unknown> & { row: number };

const COLUMNS = [
  { key: "id", header: "ID", width: 38 },
  { key: "seasonYear", header: "Kausi", width: 8 },
  { key: "name", header: "Nimi", width: 28 },
  { key: "locationName", header: "Paikka", width: 22 },
  { key: "address", header: "Osoite", width: 28 },
  { key: "locationDescription", header: "Sijainnin kuvaus", width: 36 },
  { key: "latitude", header: "Leveysaste", width: 11 },
  { key: "longitude", header: "Pituusaste", width: 11 },
  { key: "startsAt", header: "Alkaa", width: 17 },
  { key: "endsAt", header: "Päättyy", width: 17 },
  { key: "status", header: "Tila", width: 11 },
  { key: "registrationOpen", header: "Ilmoittautuminen auki", width: 12 },
  { key: "paymentMethods", header: "Maksutavat", width: 50 },
] as const;

const DATE_FORMAT = "d.m.yyyy hh:mm";
const STATUS_LABELS: Record<string, string> = { DRAFT: "Luonnos", OPEN: "Avoinna", FINISHED: "Päättynyt", PUBLISHED: "Julkaistu" };

export function downloadEventsExcel(events: ExcelEvent[], fileName = "tapahtumat.xlsx") {
  const rows = events.map((event) => [
    event.id,
    event.season.year,
    event.name,
    event.locationName ?? "",
    event.address ?? "",
    event.locationDescription ?? "",
    event.latitude == null ? "" : Number(event.latitude),
    event.longitude == null ? "" : Number(event.longitude),
    toExcelSerial(new Date(event.startsAt)),
    toExcelSerial(new Date(event.endsAt)),
    STATUS_LABELS[event.status] ?? event.status,
    event.registrationOpen ? "Kyllä" : "Ei",
    // One payment method per line inside the cell (Alt+Enter in Excel).
    event.paymentMethods.join("\n"),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([COLUMNS.map((column) => column.header), ...rows]);
  for (let index = 0; index < rows.length; index += 1) {
    for (const column of [8, 9]) {
      const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
      if (cell) cell.z = DATE_FORMAT;
    }
  }
  sheet["!cols"] = COLUMNS.map((column) => ({ wch: column.width }));
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Ohje"],
    ["Yksi rivi = yksi tapahtuma. Muokkaa rivejä ja tuo tiedosto takaisin ylläpidon \"Tuo Excel\" -napilla."],
    ["ID: älä muuta. Rivi, jolla on ID, päivittää sen tapahtuman. Uutta tapahtumaa varten jätä ID tyhjäksi."],
    ["Excelistä poistettuja tapahtumia ei poisteta järjestelmästä."],
    ["Kausi: vuosi, esim. 2026 (kauden pitää olla olemassa)."],
    ["Alkaa / Päättyy: päivämäärä ja kellonaika, esim. 15.6.2026 18:00."],
    ["Tila: Luonnos, Julkaistu, Päättynyt tai Avoinna."],
    ["Ilmoittautuminen auki: Kyllä tai Ei."],
    ["Maksutavat: yksi per rivi solun sisällä (Alt+Enter) tai puolipisteellä eroteltuna."],
  ]);
  instructions["!cols"] = [{ wch: 100 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Tapahtumat");
  XLSX.utils.book_append_sheet(workbook, instructions, "Ohje");
  XLSX.writeFile(workbook, fileName);
}

// Reads the first sheet into API rows. Excel-specific types are
// converted here (date serials → ISO in the browser's time zone); anything
// unrecognised is passed through as text for the API to report per row.
export async function readEventsExcel(file: File): Promise<ImportRow[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Tiedostossa ei ole yhtään taulukkoa.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  const headerRow = (matrix[0] ?? []).map((value) => normalizeHeader(String(value)));
  const columnIndex = new Map<string, number>();
  for (const column of COLUMNS) {
    const index = headerRow.indexOf(normalizeHeader(column.header));
    if (index >= 0) columnIndex.set(column.key, index);
  }
  const missing = ["name", "startsAt", "endsAt"].filter((key) => !columnIndex.has(key));
  if (missing.length) {
    const headers = missing.map((key) => COLUMNS.find((column) => column.key === key)!.header).join(", ");
    throw new Error(`Ensimmäiseltä riviltä puuttuu sarakkeet: ${headers}. Lataa pohja "Lataa Excel" -napilla.`);
  }
  const rows: ImportRow[] = [];
  matrix.slice(1).forEach((cells, index) => {
    if (cells.every((value) => String(value ?? "").trim() === "")) return;
    const row: ImportRow = { row: index + 2 };
    for (const [key, columnIndexValue] of columnIndex) {
      const value = cells[columnIndexValue];
      row[key] = key === "startsAt" || key === "endsAt" ? toIso(value) : typeof value === "string" ? value.trim() : value;
    }
    rows.push(row);
  });
  return rows;
}

function normalizeHeader(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

// Excel serials are wall-clock time without a zone; map them to/from the
// browser's local time so 18:00 in Excel is 18:00 in the admin UI.
function toExcelSerial(date: Date): number {
  const wallClockUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes());
  return wallClockUtc / 86_400_000 + 25_569;
}

function toIso(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Inverse of toExcelSerial, rounded to the minute.
    const wallClock = new Date(Math.round((value - 25_569) * 1440) * 60_000);
    return new Date(wallClock.getUTCFullYear(), wallClock.getUTCMonth(), wallClock.getUTCDate(), wallClock.getUTCHours(), wallClock.getUTCMinutes()).toISOString();
  }
  const text = String(value ?? "").trim();
  const finnish = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(?:klo\s+)?(\d{1,2})[:.](\d{2}))?$/i);
  if (finnish) return new Date(Number(finnish[3]), Number(finnish[2]) - 1, Number(finnish[1]), Number(finnish[4] ?? 0), Number(finnish[5] ?? 0)).toISOString();
  return text;
}
