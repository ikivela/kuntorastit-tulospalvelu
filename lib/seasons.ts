// Season pickers: with several event series the same year can exist twice,
// so seasons are grouped under their series (only when there is more than
// one series; a single series keeps a flat list).
export type SeasonOption = { id: string; name: string; year: number; seriesName?: string };

export function groupSeasonsBySeries<T extends SeasonOption>(seasons: T[]): { seriesName: string | null; seasons: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const season of seasons) {
    const key = season.seriesName ?? "";
    groups.set(key, [...(groups.get(key) ?? []), season]);
  }
  if (groups.size <= 1) return [{ seriesName: null, seasons }];
  return [...groups].map(([seriesName, items]) => ({ seriesName, seasons: items }));
}
