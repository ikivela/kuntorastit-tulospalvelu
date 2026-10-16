"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/lib/i18n";
import { analyseSplits, type SplitResult } from "@/lib/splits";

export type RunnerResult = SplitResult & {
  rank: number | null;
  firstName: string;
  lastName: string;
  clubName: string | null;
  status: string;
  source?: string;
  attendanceCount: number;
  acceptedCount?: number;
  startedAt?: string | null;
};
export type RunnerCourse = { name: string; lengthMeters: number; legs?: { code: string | null; lengthMeters: number | null }[]; results: RunnerResult[] };

/** A runner's card, like OLFresults': season participations, then for a
 * timed result with split times a pace chart per leg against their own base
 * level, the totals (time lost to mistakes, optimal time, base level) and
 * the control-by-control table. Mistakes come from the same analysis as the
 * split-times page (lib/splits). */
export function RunnerDialog({ course, result, onClose }: { course: RunnerCourse; result: RunnerResult | null; onClose: () => void }) {
  const { t, locale } = useT();
  const analysis = useMemo(() => analyseSplits(course.results.filter((item) => item.status === "ACCEPTED" && item.punches.length > 0)), [course]);
  const row = result ? analysis.rows.find((item) => item.result.id === result.id) : undefined;
  // Leg lengths only when the course's controls are the ones punched.
  const legs = course.legs && course.legs.length === analysis.controlCodes.length + 1
    && analysis.controlCodes.every((code, index) => course.legs![index].code === String(code)) ? course.legs : undefined;

  return <Dialog open={Boolean(result)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-3xl">
      {result && <>
        <DialogHeader><DialogTitle className="text-2xl">{result.firstName} {result.lastName}</DialogTitle><DialogDescription>{[result.clubName, course.name].filter(Boolean).join(" · ")}</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2" title={t.runner.seasonHint}>
          <Badge className="rounded-full px-3 py-1">{t.runner.attendances(result.attendanceCount)}</Badge>
          {result.acceptedCount != null && <>
            <Badge variant="outline" className="rounded-full border-emerald-300 px-3 py-1 text-emerald-800">{t.runner.accepted(result.acceptedCount)}</Badge>
            <Badge variant="outline" className="rounded-full border-amber-300 px-3 py-1 text-amber-800">{t.runner.other(Math.max(0, result.attendanceCount - result.acceptedCount))}</Badge>
          </>}
        </div>
        {!row ? <p className="text-sm text-muted-foreground">{t.runner.noSplits}</p> : <RunnerSplits row={row} analysis={analysis} result={result} course={course} legs={legs} locale={locale} />}
      </>}
    </DialogContent>
  </Dialog>;
}

type Analysis = ReturnType<typeof analyseSplits<RunnerResult>>;

function RunnerSplits({ row, analysis, result, course, legs, locale }: { row: Analysis["rows"][number]; analysis: Analysis; result: RunnerResult; course: RunnerCourse; legs?: RunnerCourse["legs"]; locale: string }) {
  const { t } = useT();
  const durationMs = result.durationMs ?? row.legs.at(-1)!.cumulativeMs;
  const lostMs = row.legs.reduce((sum, leg) => sum + leg.lostMs, 0);
  const level = 100 / row.level;
  const winnerMs = analysis.bestCumulativeMs.at(-1) ?? durationMs;
  const percent = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} %`;
  const stats: [string, string, string?][] = [
    ...(result.startedAt ? [[t.runner.start, new Date(result.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })] as [string, string]] : []),
    [t.runner.result, `${formatDuration(durationMs)}${result.rank ? ` (${result.rank}.)` : ""}`],
    [t.runner.behind, durationMs > winnerMs ? `+${formatDuration(durationMs - winnerMs)}` : "–"],
    [t.runner.pace, course.lengthMeters > 0 ? `${formatDuration(durationMs / (course.lengthMeters / 1000))} /km` : "–"],
    [t.runner.mistakeTime, lostMs ? formatDuration(lostMs) : "0:00"],
    [t.runner.optimalTime, formatDuration(durationMs - lostMs)],
    [t.runner.level, percent(level), t.runner.levelHint],
  ];

  return <div className="grid gap-5">
    <PaceChart row={row} analysis={analysis} level={level} finishLabel={t.runner.finish} />
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stats.map(([label, value, hint]) => <div key={label} className="rounded-2xl border bg-muted/30 px-3 py-2" title={hint}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="text-lg font-black tabular-nums">{value}</dd></div>)}</dl>
    <div className="overflow-x-auto rounded-2xl border"><Table><TableHeader><TableRow>
      <TableHead className="sticky left-0 z-10 bg-background text-right shadow-[1px_0_0_var(--border)]">{t.runner.control}</TableHead><TableHead className="text-right">{t.runner.code}</TableHead>
      <TableHead className="border-l text-center" colSpan={3}>{t.runner.standing}</TableHead>
      <TableHead className="border-l text-center" colSpan={legs ? 5 : 3}>{t.runner.leg}</TableHead>
    </TableRow></TableHeader><TableBody>{row.legs.map((leg, index) => {
      const length = legs?.[index].lengthMeters;
      const isFinish = index === analysis.controlCodes.length;
      return <TableRow key={index} className={leg.lostMs ? "bg-red-50" : ""}>
        <TableCell className={`sticky left-0 z-10 text-right font-bold shadow-[1px_0_0_var(--border)] ${leg.lostMs ? "bg-red-50" : "bg-background"}`}>{isFinish ? t.runner.finish : index + 1}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{isFinish ? "" : analysis.controlCodes[index]}</TableCell>
        <TableCell className="border-l text-right font-semibold tabular-nums">{formatDuration(leg.cumulativeMs)}</TableCell>
        <TableCell className={`text-right tabular-nums ${rankClass(leg.cumulativeRank)}`}>{leg.cumulativeRank}.</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{gap(leg.cumulativeMs - analysis.bestCumulativeMs[index])}</TableCell>
        <TableCell className="border-l text-right italic tabular-nums">{formatDuration(leg.splitMs)}{leg.lostMs ? <span className="ml-1.5 rounded bg-red-100 px-1 text-xs not-italic text-red-700">{t.runner.mistake(formatDuration(leg.lostMs))}</span> : null}</TableCell>
        <TableCell className={`text-right italic tabular-nums ${rankClass(leg.splitRank)}`}>{leg.splitRank}.</TableCell>
        <TableCell className="text-right italic tabular-nums text-muted-foreground">{gap(leg.splitMs - analysis.bestSplitMs[index])}</TableCell>
        {legs && <>
          <TableCell className="text-right italic tabular-nums text-muted-foreground">{length ? `${Math.round(length)} m` : "–"}</TableCell>
          <TableCell className="text-right italic tabular-nums text-muted-foreground">{length ? `${formatDuration(leg.splitMs / (length / 1000))} /km` : "–"}</TableCell>
        </>}
      </TableRow>;
    })}</TableBody></Table></div>
  </div>;
}

/** Leg pace as % of the leg's reference time (higher = faster), with the
 * runner's base level as a dashed line; mistake legs in red. */
function PaceChart({ row, analysis, level, finishLabel }: { row: Analysis["rows"][number]; analysis: Analysis; level: number; finishLabel: string }) {
  const { t } = useT();
  const values = row.legs.map((leg, index) => leg.splitMs > 0 ? analysis.referenceMs[index] / leg.splitMs * 100 : 0);
  const max = Math.max(120, Math.ceil(Math.max(...values, level) / 20) * 20);
  const width = 640, height = 220, left = 34, right = 22, top = 10, bottom = 26;
  const x = (index: number) => left + (values.length === 1 ? 0 : index * (width - left - right) / (values.length - 1));
  const y = (value: number) => top + (1 - Math.min(value, max) / max) * (height - top - bottom);
  const ticks = Array.from({ length: max / 20 + 1 }, (_, index) => index * 20);
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return <figure className="grid gap-2">
    <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-semibold">{t.runner.chartTitle}</span><span className="flex items-center gap-3"><span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-emerald-600" />{t.runner.chartLegendLeg}</span><span className="flex items-center gap-1"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-primary" />{t.runner.chartLegendLevel}</span></span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={t.runner.chartTitle}>
      {ticks.map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} /><text x={left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{tick}</text></g>)}
      <rect x={left} y={y(level)} width={width - left - right} height={y(0) - y(level)} className="fill-primary/10" />
      <path d={line} fill="none" className="stroke-emerald-600" strokeWidth={2} strokeLinejoin="round" />
      <line x1={left} x2={width - right} y1={y(level)} y2={y(level)} className="stroke-primary" strokeWidth={2} strokeDasharray="6 5" />
      {values.map((value, index) => <rect key={index} x={x(index) - 4} y={y(value) - 4} width={8} height={8} rx={1.5} className={row.legs[index].lostMs ? "fill-red-500" : "fill-emerald-600"}><title>{`${Math.round(value)} %`}</title></rect>)}
      {values.map((_, index) => <text key={index} x={x(index)} y={height - 8} textAnchor={index === values.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">{index === values.length - 1 ? finishLabel : index + 1}</text>)}
    </svg>
  </figure>;
}

function rankClass(rank: number) { return rank === 1 ? "font-bold text-emerald-700" : rank <= 3 ? "font-bold text-blue-700" : ""; }
function gap(ms: number) { return ms > 0 ? `+${formatDuration(ms)}` : "–"; }
function formatDuration(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
