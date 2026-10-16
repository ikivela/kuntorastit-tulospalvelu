"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, Clock3, Loader2, MapPin, RotateCcw, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResultsHeader } from "@/components/results-header";
import { isLiveEvent } from "@/lib/live";
import { API_BASE, SITE_NAME, withBasePath } from "@/lib/site";
import { formatDistance, useT } from "@/lib/i18n";

const apiBase = API_BASE;
type ResultStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type ResultPunch = { sequenceNumber: number; controlCode: number; elapsedMs: number | null; status: "VALID" | "EXTRA" | "MISSING" };
type EventResult = { id: string; rank: number | null; firstName: string; lastName: string; clubName: string | null; attendanceCount: number; source?: string; status: ResultStatus; durationMs: number | null; punches: ResultPunch[] };
type ResultCourse = { id: string; name: string; lengthMeters: number; results: EventResult[] };
type ResultEvent = { id: string; name: string; locationName: string | null; startsAt: string; endsAt: string; status?: string; updatedAt: string; courses: ResultCourse[] };

export default function ResultsPage() {
  const { t, locale } = useT();
  const { eventId } = useParams<{ eventId: string }>();
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

  useEffect(() => {
    if (!event) return;
    document.title = `${event.name} ${new Date(event.startsAt).toLocaleDateString(locale)} | ${SITE_NAME}`;
  }, [event, locale]);

  const resultCount = event?.courses.reduce((sum, course) => sum + course.results.length, 0) ?? 0;
  return <main className="min-h-screen bg-background text-foreground">
    <ResultsHeader title={event?.name ?? null} subtitle={event ? [formatShortDate(event.startsAt, locale), event.locationName].filter(Boolean).join(" · ") : null} live={live} refreshing={refreshing} backHref={withBasePath("/kalenteri")} backLabel={t.results.toCalendar} />
    {loading ? <ResultsSkeleton /> : !event ? <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8"><Alert variant="destructive"><AlertCircle /><AlertTitle>{t.results.loadErrorTitle}</AlertTitle><AlertDescription><p>{t.results.loadError}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load(true)}><RotateCcw className="mr-2 size-4" />{t.common.retry}</Button></AlertDescription></Alert></div> : <>
      <section className="hidden border-b sm:block bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_65%,#fff4d8_100%)]"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14"><div className="flex flex-row items-end justify-between gap-6"><div><p className="eyebrow">{t.results.eyebrow}</p><h1 className="mt-2 text-5xl font-black tracking-[-.04em]">{event.name}</h1><div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="size-4 text-primary" />{formatDate(event.startsAt, locale)}</span>{event.locationName && <span className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{event.locationName}</span>}</div></div><div className="flex items-center gap-3">{live && <Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1.5"><span className="mr-2 size-2 rounded-full bg-emerald-500" />{t.common.liveUpdating}</Badge>}{refreshing && <Loader2 className="size-4 animate-spin text-primary" />}</div></div></div></section>
      <div className="mx-auto max-w-6xl px-5 pb-4 sm:py-8 lg:px-8 lg:py-10">{error && <Alert className="mb-6"><AlertCircle /><AlertTitle>{t.common.connectionLost}</AlertTitle><AlertDescription>{t.results.loadError}</AlertDescription></Alert>}{resultCount === 0 ? <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><Trophy /></EmptyMedia><EmptyTitle>{t.results.noneTitle}</EmptyTitle><EmptyDescription>{t.results.noneText}</EmptyDescription></EmptyHeader></Empty> : <div className="space-y-4 sm:space-y-6">{event.courses.filter((course) => course.results.length > 0).map((course) => <CourseResults key={course.id} eventId={event.id} course={course} />)}</div>}</div>
    </>}
  </main>;
}

function CourseResults({ eventId, course }: { eventId: string; course: ResultCourse }) {
  const { t, locale } = useT();
  const winnerDurationMs = course.results.find((result) => result.rank === 1)?.durationMs ?? null;
  const hasSplits = course.results.some((result) => result.status === "ACCEPTED" && result.punches.length > 0);
  // Phones get a stacked row with no sideways scrolling: rank | name with
  // club, pace and attendance under it | result with the gap under it.
  return <Card className="-mx-5 gap-0 overflow-hidden rounded-none border-x-0 py-0 shadow-none sm:mx-0 sm:rounded-3xl sm:border-x sm:shadow-sm">
    <CardHeader className="flex flex-row items-center justify-between gap-3 border-b bg-muted/35 px-4 py-3 sm:items-end sm:px-6 sm:py-6"><div className="min-w-0"><p className="eyebrow hidden sm:block">{t.results.course}</p><CardTitle className="text-lg sm:mt-1 sm:text-2xl">{course.name}</CardTitle><p className="text-xs font-semibold text-muted-foreground sm:hidden">{formatDistance(course.lengthMeters, locale)} · {t.results.resultCount(course.results.length)}</p></div><div className="flex shrink-0 items-center gap-4"><span className="hidden text-sm font-semibold text-muted-foreground sm:inline">{formatDistance(course.lengthMeters, locale)} · {t.results.resultCount(course.results.length)}</span>{hasSplits && <Button asChild variant="outline" size="sm" className="rounded-full"><a href={withBasePath(`/tulokset/${eventId}/valiajat/${course.id}`)}>{t.results.splitTimes}</a></Button>}</div></CardHeader>
    <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-10 text-right sm:w-16">{t.results.rank}</TableHead><TableHead className="w-full sm:w-auto">{t.results.name}</TableHead><TableHead className="hidden sm:table-cell">{t.results.club}</TableHead><TableHead className="pr-4 text-right sm:pr-2">{t.results.result}</TableHead><TableHead className="hidden text-right sm:table-cell">{t.results.behind}</TableHead><TableHead className="hidden text-right sm:table-cell">{t.results.pace}</TableHead><TableHead className="hidden text-right sm:table-cell">{t.results.attendances}</TableHead></TableRow></TableHeader>
      <TableBody>{course.results.map((result) => <TableRow key={result.id}>
        <TableCell className="text-right align-top font-bold tabular-nums sm:align-middle">{result.rank ?? "–"}</TableCell>
        <TableCell className="max-w-0 whitespace-normal sm:max-w-none sm:whitespace-nowrap"><div className="font-bold">{result.firstName} {result.lastName}</div><div className="truncate text-xs text-muted-foreground sm:hidden">{[result.clubName, result.status === "ACCEPTED" ? formatPace(result.durationMs, course.lengthMeters) : null, t.results.timesShort(result.attendanceCount)].filter(Boolean).join(" · ")}</div></TableCell>
        <TableCell className="hidden text-muted-foreground sm:table-cell">{result.clubName || "–"}</TableCell>
        <TableCell className="pr-4 text-right align-top sm:pr-2 sm:align-middle"><ResultOutcome status={result.status} source={result.source} durationMs={result.durationMs} /><div className="text-xs tabular-nums text-muted-foreground sm:hidden">{formatGap(result.durationMs, winnerDurationMs) === "–" ? "" : formatGap(result.durationMs, winnerDurationMs)}</div></TableCell>
        <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatGap(result.durationMs, winnerDurationMs)}</TableCell>
        <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatPace(result.durationMs, course.lengthMeters)}</TableCell>
        <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{result.attendanceCount}</TableCell>
      </TableRow>)}</TableBody></Table></div></CardContent>
  </Card>;
}

function ResultOutcome({ status, source, durationMs }: { status: ResultStatus; source?: string; durationMs: number | null }) {
  const { t } = useT();
  if (status === "ACCEPTED") return <span className="font-black tabular-nums">{formatDuration(durationMs)}</span>;
  // Registered or recorded "omatoimi": took part on their own time, no timing.
  if (status === "NO_TIME" && source === "SELF_SERVICE") return <span className="font-semibold text-muted-foreground">{t.results.selfService}</span>;
  if (status === "NO_TIME") return <span className="font-semibold text-muted-foreground">{t.results.noTime}</span>;
  if (status === "DISQUALIFIED") return <span className="font-semibold text-destructive">{t.results.missingPunch}</span>;
  if (status === "DID_NOT_FINISH") return <span className="font-semibold text-destructive">{t.results.didNotFinish}</span>;
  return <span className="font-semibold text-muted-foreground">{t.results.pending}</span>;
}

function ResultsSkeleton() { return <div className="mx-auto max-w-6xl space-y-6 px-5 py-10 lg:px-8"><Skeleton className="h-12 w-80 max-w-full" /><Skeleton className="h-52 rounded-3xl" /><Skeleton className="h-52 rounded-3xl" /></div>; }
function formatDate(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); }
function formatShortDate(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(value)); }
function formatGap(durationMs: number | null, winnerDurationMs: number | null) {
  if (durationMs == null || winnerDurationMs == null) return "–";
  const gapMs = durationMs - winnerDurationMs;
  if (gapMs <= 0) return "–";
  return `+${formatDuration(gapMs)}`;
}
function formatPace(durationMs: number | null, lengthMeters: number) {
  if (durationMs == null || lengthMeters <= 0) return "–";
  return `${formatDuration(durationMs / (lengthMeters / 1000))} /km`;
}
function formatDuration(milliseconds: number | null) { if (milliseconds == null) return "–"; const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
