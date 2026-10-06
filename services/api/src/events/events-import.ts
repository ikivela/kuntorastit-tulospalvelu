// Validates and diffs event rows imported from Excel (one row = one event).
// Pure function so it can be tested without a database; EventsService applies
// the resulting plan in a single transaction.

export const EVENT_STATUSES = ["DRAFT", "OPEN", "FINISHED", "PUBLISHED"] as const;
export type ImportEventStatus = (typeof EVENT_STATUSES)[number];

export type ImportEventData = {
  seasonId: string;
  name: string;
  locationName: string | null;
  address: string | null;
  locationDescription: string | null;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date;
  endsAt: Date;
  status: ImportEventStatus;
  registrationOpen: boolean;
  paymentMethods: string[];
};

export type ExistingImportEvent = Omit<ImportEventData, "latitude" | "longitude"> & {
  id: string;
  latitude: { toString(): string } | number | null;
  longitude: { toString(): string } | number | null;
};

export type ImportChange =
  | { row: number; action: "create"; name: string; data: ImportEventData }
  | { row: number; action: "update"; name: string; id: string; data: ImportEventData; fields: string[] }
  | { row: number; action: "unchanged"; name: string; id: string };

export type ImportPlan = { changes: ImportChange[]; errors: { row: number; message: string }[] };

const STATUS_LABELS: Record<string, ImportEventStatus> = {
  luonnos: "DRAFT",
  avoinna: "OPEN",
  päättynyt: "FINISHED",
  julkaistu: "PUBLISHED",
};

const FIELD_LABELS: Record<keyof ImportEventData, string> = {
  seasonId: "Kausi",
  name: "Nimi",
  locationName: "Paikka",
  address: "Osoite",
  locationDescription: "Sijainnin kuvaus",
  latitude: "Leveysaste",
  longitude: "Pituusaste",
  startsAt: "Alkaa",
  endsAt: "Päättyy",
  status: "Tila",
  registrationOpen: "Ilmoittautuminen auki",
  paymentMethods: "Maksutavat",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function planEventImport(
  rows: Record<string, unknown>[],
  seasons: { id: string; year: number }[],
  existing: ExistingImportEvent[],
): ImportPlan {
  const plan: ImportPlan = { changes: [], errors: [] };
  const existingById = new Map(existing.map((event) => [event.id.toLowerCase(), event]));
  const seasonByYear = new Map(seasons.map((season) => [season.year, season.id]));
  const seenIds = new Map<string, number>();

  rows.forEach((raw, index) => {
    const row = Number.isInteger(raw.row) ? Number(raw.row) : index + 2;
    const problems: string[] = [];
    const fail = (message: string) => { problems.push(message); return undefined; };

    const id = text(raw.id)?.toLowerCase() ?? null;
    let current: ExistingImportEvent | undefined;
    if (id) {
      if (!UUID.test(id)) fail(`ID "${id}" ei ole kelvollinen tunniste. Jätä ID tyhjäksi, jos haluat luoda uuden tapahtuman.`);
      else if (seenIds.has(id)) fail(`Sama ID on myös rivillä ${seenIds.get(id)}.`);
      else if (!(current = existingById.get(id))) fail("Tapahtumaa tällä ID:llä ei löydy (onko se poistettu?). Jätä ID tyhjäksi, jos haluat luoda uuden tapahtuman.");
      seenIds.set(id, row);
    }

    const name = text(raw.name) ?? fail("Nimi puuttuu.");

    const seasonYear = raw.seasonYear === undefined || raw.seasonYear === null || raw.seasonYear === "" ? undefined : Number(raw.seasonYear);
    let seasonId: string | undefined;
    if (seasonYear === undefined) seasonId = current?.seasonId ?? fail("Kausi (vuosi) puuttuu.");
    else if (!Number.isInteger(seasonYear)) fail(`Kausi "${String(raw.seasonYear)}" ei ole vuosiluku.`);
    else seasonId = seasonByYear.get(seasonYear) ?? fail(`Kautta ${seasonYear} ei ole olemassa.`);

    const startsAt = date(raw.startsAt) ?? fail(`Alkaa: "${String(raw.startsAt ?? "")}" ei ole kelvollinen aika (esim. 15.6.2026 18:00).`);
    const endsAt = date(raw.endsAt) ?? fail(`Päättyy: "${String(raw.endsAt ?? "")}" ei ole kelvollinen aika (esim. 15.6.2026 20:00).`);
    if (startsAt && endsAt && endsAt <= startsAt) fail("Päättymisajan pitää olla alkamisajan jälkeen.");

    const latitude = coordinate(raw.latitude, -90, 90, "Leveysaste", fail);
    const longitude = coordinate(raw.longitude, -180, 180, "Pituusaste", fail);

    let status: ImportEventStatus | undefined = current?.status ?? "DRAFT";
    const statusText = text(raw.status);
    if (statusText) {
      const upper = statusText.toUpperCase();
      status = (EVENT_STATUSES as readonly string[]).includes(upper) ? upper as ImportEventStatus : STATUS_LABELS[statusText.toLowerCase()];
      if (!status) fail(`Tila "${statusText}" ei kelpaa (Luonnos, Avoinna, Päättynyt tai Julkaistu).`);
    }

    let registrationOpen: boolean | undefined = current?.registrationOpen ?? false;
    if (raw.registrationOpen !== undefined && raw.registrationOpen !== null && raw.registrationOpen !== "") {
      registrationOpen = bool(raw.registrationOpen);
      if (registrationOpen === undefined) fail(`Ilmoittautuminen auki: "${String(raw.registrationOpen)}" ei kelpaa (Kyllä tai Ei).`);
    }

    const paymentMethods = Array.isArray(raw.paymentMethods)
      ? raw.paymentMethods.map((value) => String(value).trim()).filter(Boolean)
      : (text(raw.paymentMethods) ?? "").split(/\r?\n|;/).map((value) => value.trim()).filter(Boolean);

    if (problems.length) { plan.errors.push(...problems.map((message) => ({ row, message }))); return; }

    const data: ImportEventData = {
      seasonId: seasonId!,
      name: name!,
      locationName: text(raw.locationName),
      address: text(raw.address),
      locationDescription: text(raw.locationDescription),
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      startsAt: startsAt!,
      endsAt: endsAt!,
      status: status!,
      registrationOpen: registrationOpen!,
      paymentMethods,
    };
    if (!current) { plan.changes.push({ row, action: "create", name: data.name, data }); return; }
    const fields = changedFields(current, data);
    plan.changes.push(fields.length
      ? { row, action: "update", name: data.name, id: current.id, data, fields }
      : { row, action: "unchanged", name: data.name, id: current.id });
  });
  return plan;
}

function changedFields(current: ExistingImportEvent, next: ImportEventData): string[] {
  const numberOrNull = (value: ExistingImportEvent["latitude"]) => value === null ? null : Number(value.toString());
  const same: Record<keyof ImportEventData, boolean> = {
    seasonId: current.seasonId === next.seasonId,
    name: current.name === next.name,
    locationName: (current.locationName ?? null) === next.locationName,
    address: (current.address ?? null) === next.address,
    locationDescription: (current.locationDescription ?? null) === next.locationDescription,
    latitude: numberOrNull(current.latitude) === next.latitude,
    longitude: numberOrNull(current.longitude) === next.longitude,
    // Excel stores minutes; ignore sub-minute differences.
    startsAt: Math.floor(current.startsAt.getTime() / 60000) === Math.floor(next.startsAt.getTime() / 60000),
    endsAt: Math.floor(current.endsAt.getTime() / 60000) === Math.floor(next.endsAt.getTime() / 60000),
    status: current.status === next.status,
    registrationOpen: current.registrationOpen === next.registrationOpen,
    paymentMethods: current.paymentMethods.join("\n") === next.paymentMethods.join("\n"),
  };
  return (Object.keys(same) as (keyof ImportEventData)[]).filter((key) => !same[key]).map((key) => FIELD_LABELS[key]);
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function date(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  // Finnish "15.6.2026 18:00" (local wall time is not knowable server-side,
  // so the web client converts Excel cells to ISO; this is a fallback).
  const finnish = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2})[:.](\d{2}))?$/);
  const parsed = finnish
    ? new Date(Number(finnish[3]), Number(finnish[2]) - 1, Number(finnish[1]), Number(finnish[4] ?? 0), Number(finnish[5] ?? 0))
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function coordinate(value: unknown, min: number, max: number, label: string, fail: (message: string) => undefined): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fail(`${label} "${raw}" ei ole luku väliltä ${min}…${max}.`);
  return parsed;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["kyllä", "k", "x", "true", "1", "yes"].includes(raw)) return true;
  if (["ei", "e", "false", "0", "no"].includes(raw)) return false;
  return undefined;
}
