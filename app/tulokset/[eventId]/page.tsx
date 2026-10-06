"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Clock3, Loader2, MapPin, RotateCcw, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE, SITE_NAME, withBasePath } from "@/lib/site";

const apiBase = API_BASE;
type ResultStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type ResultPunch = { sequenceNumber: number; controlCode: number; elapsedMs: number | null; status: "VALID" | "EXTRA" | "MISSING" };
type EventResult = { id: string; rank: number | null; firstName: string; lastName: string; clubName: string | null; attendanceCount: number; status: ResultStatus; durationMs: number | null; punches: ResultPunch[] };
type ResultCourse = { id: string; name: string; lengthMeters: number; results: EventResult[] };
type ResultEvent = { id: string; name: string; locationName: string | null; startsAt: string; endsAt: string; updatedAt: string; courses: ResultCourse[] };

export default function ResultsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<ResultEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (initial = false) => {
    initial ? setLoading(true) : setRefreshing(true);
    try {
      const response = await fetch(`${apiBase}/public/events/${eventId}/results`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setEvent(await response.json());
      setError("");
    } catch { setError("Tulosten lataaminen epäonnistui. Yritetään pian uudelleen."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [eventId]);
  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!event) return;
    document.title = `${event.name} ${new Date(event.startsAt).toLocaleDateString("fi-FI")} | ${SITE_NAME}`;
  }, [event]);

  const resultCount = event?.courses.reduce((sum, course) => sum + course.results.length, 0) ?? 0;
  return <main className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4 lg:px-8"><a className="flex items-center gap-3" href={withBasePath("/")}><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={withBasePath("/kos-logo.png")} alt="" className="size-8 object-contain" /></span><span><b className="block tracking-tight">{SITE_NAME}</b><small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Kokkolan Suunnistajat</small></span></a><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/kalenteri")}><ArrowLeft className="mr-2 size-4" />Kalenteriin</a></Button></div></header>
    {loading ? <ResultsSkeleton /> : !event ? <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8"><Alert variant="destructive"><AlertCircle /><AlertTitle>Tuloksia ei voitu ladata</AlertTitle><AlertDescription><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load(true)}><RotateCcw className="mr-2 size-4" />Yritä uudelleen</Button></AlertDescription></Alert></div> : <>
      <section className="border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_65%,#fff4d8_100%)]"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Tulokset</p><h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">{event.name}</h1><div className="mt-4 flex flex-wrap gap-5 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="size-4 text-primary" />{formatDate(event.startsAt)}</span>{event.locationName && <span className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{event.locationName}</span>}</div></div><div className="flex items-center gap-3"><Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1.5"><span className="mr-2 size-2 rounded-full bg-emerald-500" />Päivittyy automaattisesti</Badge>{refreshing && <Loader2 className="size-4 animate-spin text-primary" />}</div></div></div></section>
      <div className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">{error && <Alert className="mb-6"><AlertCircle /><AlertTitle>Yhteys katkesi hetkeksi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}{resultCount === 0 ? <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><Trophy /></EmptyMedia><EmptyTitle>Ei vielä tuloksia</EmptyTitle><EmptyDescription>Tulokset ilmestyvät tähän automaattisesti, kun kortteja luetaan.</EmptyDescription></EmptyHeader></Empty> : <div className="space-y-6">{event.courses.filter((course) => course.results.length > 0).map((course) => <CourseResults key={course.id} eventId={event.id} course={course} />)}</div>}</div>
    </>}
  </main>;
}

function CourseResults({ eventId, course }: { eventId: string; course: ResultCourse }) {
  const winnerDurationMs = course.results.find((result) => result.rank === 1)?.durationMs ?? null;
  const hasSplits = course.results.some((result) => result.status === "ACCEPTED" && result.punches.length > 0);
  return <Card className="overflow-hidden rounded-3xl"><CardHeader className="flex flex-row items-end justify-between border-b bg-muted/35"><div><p className="eyebrow">Rata</p><CardTitle className="mt-1 text-2xl">{course.name}</CardTitle></div><div className="flex items-center gap-4"><span className="text-sm font-semibold text-muted-foreground">{formatDistance(course.lengthMeters)} · {course.results.length} tulosta</span>{hasSplits && <Button asChild variant="outline" size="sm" className="rounded-full"><a href={withBasePath(`/tulokset/${eventId}/valiajat/${course.id}`)}>Rastiväliajat</a></Button>}</div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-16 text-right">Sija</TableHead><TableHead>Nimi</TableHead><TableHead>Seura</TableHead><TableHead className="text-right">Tulos</TableHead><TableHead className="text-right">Ero kärkeen</TableHead><TableHead className="text-right">Vauhti</TableHead><TableHead className="text-right">Osallistumiskerrat</TableHead></TableRow></TableHeader><TableBody>{course.results.map((result) => <TableRow key={result.id}><TableCell className="text-right font-bold tabular-nums">{result.rank ?? "–"}</TableCell><TableCell className="font-bold">{result.firstName} {result.lastName}</TableCell><TableCell className="text-muted-foreground">{result.clubName || "–"}</TableCell><TableCell className="text-right"><ResultOutcome status={result.status} durationMs={result.durationMs} /></TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{formatGap(result.durationMs, winnerDurationMs)}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{formatPace(result.durationMs, course.lengthMeters)}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{result.attendanceCount}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>;
}

function ResultOutcome({ status, durationMs }: { status: ResultStatus; durationMs: number | null }) {
  if (status === "ACCEPTED") return <span className="font-black tabular-nums">{formatDuration(durationMs)}</span>;
  if (status === "NO_TIME") return <span className="font-semibold text-muted-foreground">Ei aikaa</span>;
  if (status === "DISQUALIFIED") return <span className="font-semibold text-destructive">Leima puuttuu</span>;
  if (status === "DID_NOT_FINISH") return <span className="font-semibold text-destructive">Keskeyttänyt</span>;
  return <span className="font-semibold text-muted-foreground">Odottaa</span>;
}

function ResultsSkeleton() { return <div className="mx-auto max-w-6xl space-y-6 px-5 py-10 lg:px-8"><Skeleton className="h-12 w-80 max-w-full" /><Skeleton className="h-52 rounded-3xl" /><Skeleton className="h-52 rounded-3xl" /></div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("fi-FI", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); }
function formatDistance(meters: number) { return `${(meters / 1000).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`; }
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
