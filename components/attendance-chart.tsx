"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { groupSeasonsBySeries, type SeasonOption } from "@/lib/seasons";

export type ChartEvent = { id: string; seasonId: string; name: string; startsAt: string; attendanceCount: number; registrationCount: number };

// Participants (people with a recorded result) per event over one season, as
// a column chart in date order. Single series: no legend, the title names it.
const BAR = "var(--chart-2)";
const BAR_ACTIVE = "var(--primary)";
const HEIGHT = 240;
const MARGIN = { top: 24, right: 8, bottom: 28, left: 40 };

export function AttendanceChart({ events, seasons }: { events: ChartEvent[]; seasons: SeasonOption[] }) {
  const seasonsWithEvents = useMemo(() => seasons.filter((season) => events.some((event) => event.seasonId === season.id)), [seasons, events]);
  const [seasonId, setSeasonId] = useState(() => defaultSeason(events, seasonsWithEvents));
  const items = useMemo(() => events.filter((event) => event.seasonId === seasonId).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [events, seasonId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (seasonsWithEvents.length === 0) return null;

  const held = items.filter((item) => item.attendanceCount > 0);
  const total = held.reduce((sum, item) => sum + item.attendanceCount, 0);
  const peak = held.reduce<ChartEvent | null>((best, item) => !best || item.attendanceCount > best.attendanceCount ? item : best, null);
  const { ticks, top } = niceScale(peak?.attendanceCount ?? 0);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = items.length ? plotWidth / items.length : 0;
  const barWidth = Math.max(2, Math.min(24, band - 4));
  const y = (value: number) => MARGIN.top + plotHeight - (top ? (value / top) * plotHeight : 0);
  // Date labels at least ~44px apart.
  const labelEvery = Math.max(1, Math.ceil(44 / Math.max(band, 1)));
  const activeItem = active != null ? items[active] : null;

  return <section aria-labelledby="attendance-chart-title" className="mb-8 rounded-2xl border bg-card p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="attendance-chart-title" className="text-lg font-extrabold">Osallistujat tapahtumittain</h2>
        <p className="mt-1 text-sm text-muted-foreground">{held.length ? <>Yhteensä {total.toLocaleString("fi-FI")} osallistumista {held.length} tapahtumassa · keskimäärin {Math.round(total / held.length).toLocaleString("fi-FI")} / tapahtuma</> : "Kaudella ei ole vielä tuloksia."}</p>
      </div>
      {seasonsWithEvents.length > 1 && <div className="flex items-center gap-2"><Label htmlFor="attendance-chart-season" className="shrink-0">Kausi</Label><NativeSelect id="attendance-chart-season" value={seasonId} onChange={(event) => { setSeasonId(event.target.value); setActive(null); }}>{groupSeasonsBySeries(seasonsWithEvents).map((group) => { const options = group.seasons.map((season) => <NativeSelectOption key={season.id} value={season.id}>{season.name} ({season.year})</NativeSelectOption>); return group.seriesName === null ? options : <NativeSelectOptGroup key={group.seriesName} label={group.seriesName}>{options}</NativeSelectOptGroup>; })}</NativeSelect></div>}
    </div>

    <div ref={containerRef} className="relative mt-4" onPointerLeave={() => setActive(null)}>
      {width > 0 && <svg width={width} height={HEIGHT} role="img" aria-label={`Osallistujat tapahtumittain: ${items.map((item) => `${formatDay(item.startsAt)} ${item.attendanceCount}`).join(", ")}`}>
        {ticks.map((tick) => <g key={tick}>
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
          <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{tick.toLocaleString("fi-FI")}</text>
        </g>)}
        {items.map((item, index) => {
          const x = MARGIN.left + index * band + (band - barWidth) / 2;
          const isActive = index === active;
          return <g key={item.id}>
            {item.attendanceCount > 0 && <path d={columnPath(x, y(item.attendanceCount), barWidth, y(0) - y(item.attendanceCount))} fill={isActive ? BAR_ACTIVE : BAR} />}
            {item === peak && <text x={x + barWidth / 2} y={y(item.attendanceCount) - 6} textAnchor="middle" className="fill-foreground text-[11px] font-semibold tabular-nums">{item.attendanceCount}</text>}
            {index % labelEvery === 0 && <AxisLabel x={MARGIN.left + index * band + band / 2} width={width} text={formatDay(item.startsAt)} />}
            {/* Hit target: the whole column band, not just the painted bar. */}
            <rect x={MARGIN.left + index * band} y={MARGIN.top} width={band} height={plotHeight} fill="transparent" tabIndex={0} aria-label={`${item.name} ${formatDay(item.startsAt)}: ${item.attendanceCount} osallistujaa`} className="outline-none focus-visible:stroke-ring focus-visible:stroke-2" onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />
          </g>;
        })}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeWidth={1} shapeRendering="crispEdges" />
      </svg>}
      {activeItem && active != null && <div role="status" className="pointer-events-none absolute z-10 w-max max-w-64 rounded-lg border bg-popover px-3 py-2 text-sm shadow-md" style={tooltipPosition(MARGIN.left + active * band + band / 2, y(activeItem.attendanceCount), width)}>
        <p className="font-semibold tabular-nums">{activeItem.attendanceCount ? `${activeItem.attendanceCount} osallistujaa` : "Ei osallistujia"}</p>
        {activeItem.registrationCount > 0 && <p className="text-muted-foreground tabular-nums">{activeItem.registrationCount} ilmoittautunutta</p>}
        <p className="mt-1 text-muted-foreground">{formatDay(activeItem.startsAt)} · {activeItem.name}</p>
      </div>}
    </div>

    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Näytä taulukkona</summary>
      <table className="mt-2 w-full max-w-xl text-left">
        <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Päivä</th><th className="py-1 font-medium">Tapahtuma</th><th className="py-1 text-right font-medium">Osallistujia</th><th className="py-1 text-right font-medium">Ilmoittautuneita</th></tr></thead>
        <tbody className="tabular-nums">{items.map((item) => <tr key={item.id} className="border-t"><td className="py-1">{formatDay(item.startsAt)}</td><td className="py-1">{item.name}</td><td className="py-1 text-right">{item.attendanceCount}</td><td className="py-1 text-right">{item.registrationCount}</td></tr>)}</tbody>
      </table>
    </details>
  </section>;
}

// Date under a column; one too close to the right edge is right-aligned so it
// is not clipped.
function AxisLabel({ x, width, text }: { x: number; width: number; text: string }) {
  const atEdge = x + 20 > width;
  return <text x={atEdge ? width - 1 : x} y={HEIGHT - 8} textAnchor={atEdge ? "end" : "middle"} className="fill-muted-foreground text-[11px] tabular-nums">{text}</text>;
}

// The season of the most recent event that has participants, else the latest
// season with events.
function defaultSeason(events: ChartEvent[], seasons: SeasonOption[]) {
  const latest = [...events].filter((event) => event.attendanceCount > 0).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  return latest?.seasonId ?? [...seasons].sort((a, b) => b.year - a.year)[0]?.id ?? "";
}

// Clean axis ticks (0 / 50 / 100 …) with about four steps.
function niceScale(max: number) {
  if (max <= 0) return { ticks: [0], top: 0 };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  return { ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, index) => Math.round(index * step)), top };
}

// Column with a 4px rounded top, square at the baseline.
function columnPath(x: number, top: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  return `M${x},${top + height}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + width - radius}Q${x + width},${top} ${x + width},${top + radius}V${top + height}Z`;
}

// Centred over the column but kept inside the chart (tooltip max-w-64 = 256px).
function tooltipPosition(centerX: number, barTop: number, width: number) {
  const half = Math.min(128, width / 2);
  const left = Math.min(Math.max(centerX, half), width - half);
  return { left, top: Math.max(0, barTop - 8), transform: "translate(-50%, -100%)" };
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric" }).format(new Date(value));
}
