"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Info, Loader2, RotateCcw, Timer } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResultsHeader } from "@/components/results-header";
import { isLiveEvent } from "@/lib/live";
import { API_BASE, SITE_NAME, withBasePath } from "@/lib/site";
import { analyseSplits, type SplitLeg } from "@/lib/splits";
import { useT } from "@/lib/i18n";

const apiBase = API_BASE;
type ResultStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type ResultPunch = { sequenceNumber: number; controlCode: number; elapsedMs: number | null; status: "VALID" | "EXTRA" | "MISSING" };
type EventResult = { id: string; rank: number | null; firstName: string; lastName: string; clubName: string | null; source?: string; status: ResultStatus; durationMs: number | null; punches: ResultPunch[] };
type ResultCourse = { id: string; name: string; lengthMeters: number; results: EventResult[] };
type ResultEvent = { id: string; name: string; startsAt: string; endsAt: string; status?: string; courses: ResultCourse[] };

export default function SplitTimesPage() {
  const { t, locale } = useT();
  const { eventId, courseId } = useParams<{ eventId: string; courseId: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<ResultEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true);
    try {
      const response = await fetch(`${apiBase}/public/events/${eventId}/results`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setEvent(await response.json());
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, [eventId]);
  useEffect(() => { void load(true); }, [load]);
  // Refresh only while the event is on; a past event's results don't change.
  const live = event ? isLiveEvent(event) : false;
  useEffect(() => {
    if (!live) return;
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, [load, live]);

  const course = event?.courses.find((item) => item.id === courseId) ?? null;
  useEffect(() => {
    if (!event || !course) return;
    document.title = `${t.splits.eyebrow} · ${course.name} · ${event.name} | ${SITE_NAME}`;
  }, [event, course, t]);

  const coursesWithResults = event?.courses.filter((item) => item.results.length > 0) ?? [];
  const coursePicker = (id: string) => <NativeSelect id={id} className="w-full" value={courseId} onChange={(changeEvent) => router.push(`/tulokset/${eventId}/valiajat/${changeEvent.target.value}`)}>{coursesWithResults.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect>;

  return <main className="min-h-screen bg-background text-foreground">
    <ResultsHeader title={event?.name ?? null} subtitle={event ? `${t.splits.eyebrow} · ${formatShortDate(event.startsAt, locale)}` : null} live={live} refreshing={refreshing} backHref={withBasePath(`/tulokset/${eventId}`)} backLabel={t.splits.toResults} />
    {loading ? <SplitsSkeleton /> : !event ? <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8"><Alert variant="destructive"><AlertCircle /><AlertTitle>{t.splits.loadErrorTitle}</AlertTitle><AlertDescription><p>{t.splits.loadError}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load(true)}><RotateCcw className="mr-2 size-4" />{t.common.retry}</Button></AlertDescription></Alert></div> : <>
      <section className="hidden border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_65%,#fff4d8_100%)] sm:block"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14"><p className="eyebrow">{t.splits.eyebrow}</p><h1 className="mt-2 text-5xl font-black tracking-[-.04em]">{event.name}</h1>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div className="w-full max-w-xs flex-1"><label htmlFor="course-desktop" className="mb-1 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">{t.splits.class}</label>{coursePicker("course-desktop")}</div><div className="flex items-center gap-3">{live && <Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1.5"><span className="mr-2 size-2 rounded-full bg-emerald-500" />{t.common.liveUpdating}</Badge>}{refreshing && <Loader2 className="size-4 animate-spin text-primary" />}</div></div>
      </div></section>
      <div className="flex items-center gap-3 border-b bg-muted/35 px-4 py-2 sm:hidden"><label htmlFor="course-mobile" className="text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">{t.splits.class}</label><div className="min-w-0 flex-1">{coursePicker("course-mobile")}</div></div>
      <div className="px-5 pb-4 sm:py-8 lg:px-8 lg:py-10">{error && <Alert className="mx-auto mb-6 max-w-6xl"><AlertCircle /><AlertTitle>{t.common.connectionLost}</AlertTitle><AlertDescription>{t.splits.loadError}</AlertDescription></Alert>}
        {!course ? <Empty className="mx-auto min-h-72 max-w-6xl rounded-3xl border bg-card"><EmptyHeader><EmptyTitle>{t.splits.classNotFound}</EmptyTitle><EmptyDescription>{t.splits.classNotFoundText}</EmptyDescription></EmptyHeader></Empty> : <SplitTable key={course.id} course={course} />}
      </div>
    </>}
  </main>;
}

// WinSplits-style table: one column per leg (start → 1, …, last → finish),
// each cell the leg time over the cumulative time, both with their rank.
// Rank 1 is green and ranks 2–3 blue; a leg the runner lost clear time on (estimated from
// their own pace on the other legs, see lib/splits) has a red background.
// Like WinSplits, any leg can be sorted by its leg time or by the
// cumulative time there; "Sija" goes back to the result order.
type SplitSort = { leg: number; by: "split" | "cumulative" } | null;

function SplitTable({ course }: { course: ResultCourse }) {
  const { t } = useT();
  const [sort, setSort] = useState<SplitSort>(null);
  const accepted = course.results.filter((result) => result.status === "ACCEPTED" && result.punches.length > 0);
  const analysis = analyseSplits(accepted);
  // "Omatoimi" (no timing at all) isn't a result left out of the comparison.
  const excluded = [...course.results.filter((result) => !accepted.includes(result) && result.source !== "SELF_SERVICE"), ...analysis.excluded];
  if (analysis.rows.length === 0) {
    return <Empty className="mx-auto min-h-72 max-w-6xl rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><Timer /></EmptyMedia><EmptyTitle>{t.splits.noneTitle}</EmptyTitle><EmptyDescription>{t.splits.noneText}</EmptyDescription></EmptyHeader></Empty>;
  }
  const rows = sort ? [...analysis.rows].sort((left, right) => {
    const key = sort.by === "split" ? "splitRank" : "cumulativeRank";
    return left.legs[sort.leg][key] - right.legs[sort.leg][key];
  }) : analysis.rows;
  const sortButton = (leg: number, by: "split" | "cumulative", label: string) => {
    const active = sort?.leg === leg && sort.by === by;
    return <button type="button" aria-pressed={active} onClick={() => setSort(active ? null : { leg, by })} className={`rounded px-1 text-xs font-normal underline-offset-2 hover:underline ${active ? "bg-primary text-primary-foreground hover:no-underline" : "text-muted-foreground"}`}>{label}</button>;
  };
  const legLabels = [...analysis.controlCodes.map((code, index) => ({ leg: `${index === 0 ? t.splits.start : index}–${index + 1}`, code: String(code) })), { leg: `${analysis.controlCodes.length || t.splits.start}–${t.splits.finishShort}`, code: t.splits.finish }];

  // As wide as the legs need on a wide screen (centred, at least the page's
  // usual 72rem column), scrolling sideways only when the window runs out.
  return <div className="space-y-4 sm:mx-auto sm:w-fit sm:max-w-full sm:min-w-[min(100%,72rem)]">
    <Card className="-mx-5 gap-0 overflow-hidden rounded-none border-x-0 py-0 shadow-none sm:mx-0 sm:rounded-3xl sm:border-x sm:shadow-sm"><CardHeader className="hidden border-b bg-muted/35 pt-6 sm:grid"><CardTitle className="text-2xl">{course.name}</CardTitle></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow>
        <TableHead className="sticky left-0 z-10 w-32 max-w-32 bg-card pl-2 shadow-[1px_0_0_var(--border)] sm:w-auto sm:max-w-none sm:min-w-52 sm:pl-4"><button type="button" onClick={() => setSort(null)} className={sort ? "underline-offset-2 hover:underline" : ""} title={t.splits.sortByResult}>{t.splits.rank}</button> · {t.results.name}</TableHead>
        {legLabels.map((label, index) => <TableHead key={label.leg} className="h-auto px-1.5 py-2 text-right align-top tabular-nums sm:px-2">{label.leg}<div className="font-normal text-muted-foreground">{label.code}</div><div className="mt-1 flex justify-end gap-0.5">{sortButton(index, "split", t.splits.leg)}{sortButton(index, "cumulative", t.splits.total)}</div></TableHead>)}
      </TableRow></TableHeader><TableBody>{rows.map(({ result, legs }) => <TableRow key={result.id}>
        <TableCell className="sticky left-0 z-10 w-32 max-w-32 bg-card px-1.5 py-1.5 align-top shadow-[1px_0_0_var(--border)] sm:w-auto sm:max-w-none sm:p-2 sm:pl-4"><div className="flex gap-1.5 sm:gap-3"><span className="w-5 shrink-0 text-right text-[13px] font-bold tabular-nums sm:w-6 sm:text-sm">{result.rank ?? "–"}</span><div className="min-w-0"><div className="truncate text-[13px] font-bold sm:text-sm">{result.firstName} {result.lastName}</div><div className="truncate text-xs text-muted-foreground">{result.clubName || "–"}</div></div></div></TableCell>
        {legs.map((leg, index) => <LegCell key={index} leg={leg} />)}
      </TableRow>)}</TableBody></Table></div></CardContent>
    </Card>
    <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground"><Info className="mr-1.5 size-4" />{t.splits.legend}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <PopoverHeader><PopoverTitle>{t.splits.legend}</PopoverTitle></PopoverHeader>
        <ul className="mt-3 space-y-2.5">
          <li>{t.splits.legendLegs}</li>
          <li>{t.splits.legendRows}</li>
          <li>{t.splits.legendRanks(<span className="font-bold text-emerald-700">(1)</span>, <span className="font-bold text-blue-700">(2–3)</span>)}</li>
          <li className="flex gap-2"><span className="mt-1 inline-block size-3 shrink-0 rounded-sm bg-red-100 ring-1 ring-red-300" /><span>{t.splits.legendMistake}
            <span className="mt-1.5 block">{t.splits.legendMistakeHow}</span>
            <span className="mt-1.5 block">{t.splits.legendMistakeRule}</span>
            <span className="mt-1.5 block text-muted-foreground">{t.splits.legendMistakeNote}</span></span></li>
          <li>{t.splits.legendSort}</li>
        </ul>
      </PopoverContent>
    </Popover>
    {excluded.length > 0 && <p className="text-sm text-muted-foreground">{t.splits.excluded(excluded.length, excluded.map((result) => `${result.firstName} ${result.lastName}`).join(", "))}</p>}
  </div>;
}

function LegCell({ leg }: { leg: SplitLeg }) {
  const { t } = useT();
  const top = (rank: number) => rank === 1 ? "font-bold text-emerald-700" : rank <= 3 ? "font-bold text-blue-700" : "";
  const times = <>
    <div className={`text-[13px] sm:text-sm ${top(leg.splitRank)}`}>{formatDuration(leg.splitMs)} <span className="text-[11px] sm:text-xs">({leg.splitRank})</span></div>
    <div className={`text-[11px] sm:text-xs ${leg.cumulativeRank <= 3 ? top(leg.cumulativeRank) : "text-muted-foreground"}`}>{formatDuration(leg.cumulativeMs)} ({leg.cumulativeRank})</div>
  </>;
  if (!leg.lostMs) return <TableCell className="px-1.5 py-1.5 text-right align-top tabular-nums sm:p-2">{times}</TableCell>;
  // A mistake cell opens its estimated time loss on click or tap (touch
  // screens have no hover for a title tooltip).
  return <TableCell className="bg-red-100 p-0 text-right align-top tabular-nums">
    <Popover><PopoverTrigger asChild><button type="button" className="block w-full cursor-pointer px-1.5 py-1.5 text-right sm:p-2 hover:bg-red-200 focus-visible:bg-red-200 focus-visible:outline-none" aria-label={t.splits.mistakeLabel(formatDuration(leg.splitMs))}>{times}</button></PopoverTrigger>
      <PopoverContent side="top" className="w-auto max-w-64 text-sm">{t.splits.mistake(formatDuration(leg.lostMs))}</PopoverContent>
    </Popover>
  </TableCell>;
}

function SplitsSkeleton() { return <div className="mx-auto max-w-6xl space-y-6 px-5 py-10 lg:px-8"><Skeleton className="h-12 w-80 max-w-full" /><Skeleton className="h-96 rounded-3xl" /></div>; }
function formatShortDate(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(value)); }
function formatDuration(milliseconds: number | null) { if (milliseconds == null) return "–"; const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
