"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, RotateCcw, Timer } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE, CLUB_NAME, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";

const apiBase = API_BASE;
type ResultStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type ResultPunch = { sequenceNumber: number; controlCode: number; elapsedMs: number | null; status: "VALID" | "EXTRA" | "MISSING" };
type EventResult = { id: string; rank: number | null; firstName: string; lastName: string; clubName: string | null; status: ResultStatus; durationMs: number | null; punches: ResultPunch[] };
type ResultCourse = { id: string; name: string; lengthMeters: number; results: EventResult[] };
type ResultEvent = { id: string; name: string; startsAt: string; courses: ResultCourse[] };

export default function SplitTimesPage() {
  const { eventId, courseId } = useParams<{ eventId: string; courseId: string }>();
  const router = useRouter();
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
    } catch { setError("Rastiväliaikojen lataaminen epäonnistui. Yritetään pian uudelleen."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [eventId]);
  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  const course = event?.courses.find((item) => item.id === courseId) ?? null;
  useEffect(() => {
    if (!event || !course) return;
    document.title = `Rastiväliajat · ${course.name} · ${event.name} | ${SITE_NAME}`;
  }, [event, course]);

  const coursesWithResults = event?.courses.filter((item) => item.results.length > 0) ?? [];

  return <main className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4 lg:px-8"><a className="flex items-center gap-3" href={withBasePath("/")}><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><span><b className="block tracking-tight">{SITE_NAME}</b>{CLUB_NAME && <small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">{CLUB_NAME}</small>}</span></a><Button asChild variant="outline" className="rounded-full"><a href={withBasePath(`/tulokset/${eventId}`)}><ArrowLeft className="mr-2 size-4" />Tuloksiin</a></Button></div></header>
    {loading ? <SplitsSkeleton /> : !event ? <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8"><Alert variant="destructive"><AlertCircle /><AlertTitle>Tietoja ei voitu ladata</AlertTitle><AlertDescription><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load(true)}><RotateCcw className="mr-2 size-4" />Yritä uudelleen</Button></AlertDescription></Alert></div> : <>
      <section className="border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_65%,#fff4d8_100%)]"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Rastiväliajat</p><h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">{event.name}</h1></div><div className="flex items-center gap-3"><Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1.5"><span className="mr-2 size-2 rounded-full bg-emerald-500" />Päivittyy automaattisesti</Badge>{refreshing && <Loader2 className="size-4 animate-spin text-primary" />}</div></div>
        <div className="mt-6 max-w-xs"><label className="mb-1 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground">Sarja</label><NativeSelect value={courseId} onChange={(changeEvent) => router.push(`/tulokset/${eventId}/valiajat/${changeEvent.target.value}`)}>{coursesWithResults.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></div>
      </div></section>
      <div className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">{error && <Alert className="mb-6"><AlertCircle /><AlertTitle>Yhteys katkesi hetkeksi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {!course ? <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyTitle>Sarjaa ei löytynyt</EmptyTitle><EmptyDescription>Valitse sarja yllä olevasta valikosta.</EmptyDescription></EmptyHeader></Empty> : <SplitTable course={course} />}
      </div>
    </>}
  </main>;
}

function SplitTable({ course }: { course: ResultCourse }) {
  const accepted = course.results.filter((result) => result.status === "ACCEPTED" && result.punches.length > 0);
  const excluded = course.results.filter((result) => !(result.status === "ACCEPTED" && result.punches.length > 0));
  if (accepted.length === 0) {
    return <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><Timer /></EmptyMedia><EmptyTitle>Ei vertailukelpoisia tuloksia</EmptyTitle><EmptyDescription>Rastiväliaikoja ei voi vielä näyttää — odotetaan hyväksyttyjä tuloksia.</EmptyDescription></EmptyHeader></Empty>;
  }
  const legCount = accepted[0].punches.length;
  const referenceCodes = [...accepted[0].punches].sort((a, b) => a.sequenceNumber - b.sequenceNumber).map((punch) => punch.controlCode);
  // Winsplits-style: one column per control, each cell pairing the leg
  // (split) time with the cumulative time at that point. The recorded
  // duration always ends exactly at the last punch (there's no separate
  // finish-line timing beyond it), so that last column doubles as "Maali"
  // rather than getting its own always-zero trailing column.
  const legTimes = accepted.map((result) => {
    const punches = [...result.punches].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const legs: { splitMs: number | null; cumulativeMs: number | null }[] = punches.map((punch, index) => {
      if (punch.elapsedMs == null) return { splitMs: null, cumulativeMs: null };
      const previous = index === 0 ? 0 : punches[index - 1].elapsedMs;
      return { splitMs: previous == null ? null : punch.elapsedMs - previous, cumulativeMs: punch.elapsedMs };
    });
    return { result, legs };
  });

  return <div className="space-y-4">
    <Card className="overflow-hidden rounded-3xl"><CardHeader className="border-b bg-muted/35"><CardTitle className="text-2xl">{course.name}</CardTitle></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow>
        <TableHead className="w-16 text-right">Sija</TableHead>
        <TableHead>Nimi</TableHead>
        <TableHead>Seura</TableHead>
        {Array.from({ length: legCount }, (_, index) => <TableHead key={index} className="text-right tabular-nums">{index === legCount - 1 ? "Maali" : index + 1}<div className="font-normal text-muted-foreground">{referenceCodes[index]}</div></TableHead>)}
      </TableRow></TableHeader><TableBody>{legTimes.map(({ result, legs }) => <TableRow key={result.id}>
        <TableCell className="text-right font-bold tabular-nums">{result.rank ?? "–"}</TableCell>
        <TableCell className="font-bold">{result.firstName} {result.lastName}</TableCell>
        <TableCell className="text-muted-foreground">{result.clubName || "–"}</TableCell>
        {legs.map((leg, index) => <LegCell key={index} splitMs={leg.splitMs} cumulativeMs={leg.cumulativeMs} />)}
      </TableRow>)}</TableBody></Table></div></CardContent>
    </Card>
    <p className="text-xs text-muted-foreground">Ylärivi = väliaika edellisestä rastista, alarivi = kokonaisaika lähdöstä.</p>
    {excluded.length > 0 && <p className="text-sm text-muted-foreground">Vertailun ulkopuolella ({excluded.length}): {excluded.map((result) => `${result.firstName} ${result.lastName}`).join(", ")} — ei hyväksyttyä tulosta.</p>}
  </div>;
}

function LegCell({ splitMs, cumulativeMs }: { splitMs: number | null; cumulativeMs: number | null }) {
  if (splitMs == null) return <TableCell className="text-right tabular-nums text-muted-foreground">–</TableCell>;
  return <TableCell className="text-right tabular-nums">
    {formatDuration(splitMs)}
    <div className="text-xs font-normal text-muted-foreground">{formatDuration(cumulativeMs)}</div>
  </TableCell>;
}

function SplitsSkeleton() { return <div className="mx-auto max-w-6xl space-y-6 px-5 py-10 lg:px-8"><Skeleton className="h-12 w-80 max-w-full" /><Skeleton className="h-96 rounded-3xl" /></div>; }
function formatDuration(milliseconds: number | null) { if (milliseconds == null) return "–"; const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
