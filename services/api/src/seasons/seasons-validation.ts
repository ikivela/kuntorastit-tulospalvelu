export const MIN_SEASON_YEAR = 2000;
export const MAX_SEASON_YEAR = 2100;

export type SeasonFields = { name: string; year: number; startsAt: Date; endsAt: Date };
export type SeasonInput = { name?: string; year?: number; startsAt?: string; endsAt?: string };
export type RewardInput = { id?: string; name?: string; requiredAttendances?: number };
export type ExistingReward = { id: string; rewardDescription: string | null };
export type PlannedReward = { name: string; requiredAttendances: number; rewardDescription: string | null; sortOrder: number };

// Season dates are calendar days (@db.Date); "YYYY-MM-DD" is stored as UTC
// midnight. The round trip rejects impossible days such as 2027-02-30.
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** Merges a create/update payload onto the current season (if any) and validates the result. */
export function planSeason(input: SeasonInput, current?: SeasonFields): { data: SeasonFields | null; errors: string[] } {
  const errors: string[] = [];
  const name = input.name !== undefined ? input.name.trim() : current?.name;
  if (!name) errors.push("Kauden nimi puuttuu.");
  const year = input.year ?? current?.year;
  if (year === undefined || !Number.isInteger(year) || year < MIN_SEASON_YEAR || year > MAX_SEASON_YEAR) errors.push(`Vuoden pitää olla kokonaisluku väliltä ${MIN_SEASON_YEAR}–${MAX_SEASON_YEAR}.`);
  const startsAt = input.startsAt !== undefined ? parseDateOnly(input.startsAt) : current?.startsAt ?? null;
  const endsAt = input.endsAt !== undefined ? parseDateOnly(input.endsAt) : current?.endsAt ?? null;
  if (!startsAt) errors.push("Alkamispäivä puuttuu tai ei ole kelvollinen päivämäärä.");
  if (!endsAt) errors.push("Päättymispäivä puuttuu tai ei ole kelvollinen päivämäärä.");
  if (startsAt && endsAt && endsAt <= startsAt) errors.push("Päättymispäivän pitää olla alkamispäivän jälkeen.");
  return errors.length ? { data: null, errors } : { data: { name: name!, year: year!, startsAt: startsAt!, endsAt: endsAt! }, errors };
}

/**
 * Validates the full replacement list of a season's reward thresholds. Rows
 * carrying the id of an existing threshold keep its reward description,
 * which the admin UI doesn't edit.
 */
export function planRewards(rows: RewardInput[], existing: ExistingReward[] = []): { rewards: PlannedReward[]; errors: string[] } {
  const errors: string[] = [];
  const descriptions = new Map(existing.map((reward) => [reward.id, reward.rewardDescription]));
  const seen = new Set<number>();
  const rewards = rows.map((row, index) => {
    const label = `Palkintoraja ${index + 1}`;
    const name = row.name?.trim() ?? "";
    const required = row.requiredAttendances;
    if (!name) errors.push(`${label}: nimi puuttuu.`);
    if (required === undefined || !Number.isInteger(required) || required < 1) errors.push(`${label}: osallistumiskertojen määrän pitää olla positiivinen kokonaisluku.`);
    else if (seen.has(required)) errors.push(`${label}: kahdella palkintorajalla ei voi olla samaa osallistumismäärää (${required}).`);
    else seen.add(required);
    return { name, requiredAttendances: required ?? 0, rewardDescription: (row.id && descriptions.get(row.id)) || null, sortOrder: index };
  });
  return errors.length ? { rewards: [], errors } : { rewards, errors };
}
