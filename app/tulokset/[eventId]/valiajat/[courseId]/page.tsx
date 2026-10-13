"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Info, Loader2, RotateCcw, Timer } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE, CLUB_NAME, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";
import { analyseSplits, type SplitLeg } from "@/lib/splits";

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
        {!course ? <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyTitle>Sarjaa ei löytynyt</EmptyTitle><EmptyDescription>Valitse sarja yllä olevasta valikosta.</EmptyDescription></EmptyHeader></Empty> : <SplitTable key={course.id} course={course} />}
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
  const [sort, setSort] = useState<SplitSort>(null);
  const accepted = course.results.filter((result) => result.status === "ACCEPTED" && result.punches.length > 0);
  const analysis = analyseSplits(accepted);
  const excluded = [...course.results.filter((result) => !accepted.includes(result)), ...analysis.excluded];
  if (analysis.rows.length === 0) {
    return <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><Timer /></EmptyMedia><EmptyTitle>Ei vertailukelpoisia tuloksia</EmptyTitle><EmptyDescription>Rastiväliaikoja ei voi vielä näyttää — odotetaan hyväksyttyjä tuloksia.</EmptyDescription></EmptyHeader></Empty>;
  }
  const rows = sort ? [...analysis.rows].sort((left, right) => {
    const key = sort.by === "split" ? "splitRank" : "cumulativeRank";
    return left.legs[sort.leg][key] - right.legs[sort.leg][key];
  }) : analysis.rows;
  const sortButton = (leg: number, by: "split" | "cumulative", label: string) => {
    const active = sort?.leg === leg && sort.by === by;
    return <button type="button" aria-pressed={active} onClick={() => setSort(active ? null : { leg, by })} className={`rounded px-1 text-xs font-normal underline-offset-2 hover:underline ${active ? "bg-primary text-primary-foreground hover:no-underline" : "text-muted-foreground"}`}>{label}</button>;
  };
  const legLabels = [...analysis.controlCodes.map((code, index) => ({ leg: `${index === 0 ? "L" : index}–${index + 1}`, code: String(code) })), { leg: `${analysis.controlCodes.length || "L"}–M`, code: "Maali" }];

  return <div className="space-y-4">
    <Card className="overflow-hidden rounded-3xl"><CardHeader className="border-b bg-muted/35"><CardTitle className="text-2xl">{course.name}</CardTitle></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow>
        <TableHead className="sticky left-0 z-10 w-12 bg-card text-right"><button type="button" onClick={() => setSort(null)} className={sort ? "underline-offset-2 hover:underline" : ""} title="Järjestä tuloksen mukaan">Sija</button></TableHead>
        <TableHead className="sticky left-12 z-10 min-w-40 bg-card shadow-[1px_0_0_var(--border)]">Nimi</TableHead>
        {legLabels.map((label, index) => <TableHead key={label.leg} className="h-auto py-2 text-right align-top tabular-nums">{label.leg}<div className="font-normal text-muted-foreground">{label.code}</div><div className="mt-1 flex justify-end gap-0.5">{sortButton(index, "split", "väli")}{sortButton(index, "cumulative", "yht.")}</div></TableHead>)}
      </TableRow></TableHeader><TableBody>{rows.map(({ result, legs }) => <TableRow key={result.id}>
        <TableCell className="sticky left-0 z-10 bg-card text-right align-top font-bold tabular-nums">{result.rank ?? "–"}</TableCell>
        <TableCell className="sticky left-12 z-10 bg-card align-top shadow-[1px_0_0_var(--border)]"><div className="font-bold">{result.firstName} {result.lastName}</div><div className="text-xs text-muted-foreground">{result.clubName || "–"}</div></TableCell>
        {legs.map((leg, index) => <LegCell key={index} leg={leg} />)}
      </TableRow>)}</TableBody></Table></div></CardContent>
    </Card>
    <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="rounded-full text-muted-foreground"><Info className="mr-1.5 size-4" />Taulukon selite</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] text-sm">
        <PopoverHeader><PopoverTitle>Taulukon selite</PopoverTitle></PopoverHeader>
        <ul className="mt-3 space-y-2.5">
          <li><b>L–1, 1–2, … –M</b> = rastiväli lähdöstä (L) maaliin (M). Otsikon alla rastikoodi.</li>
          <li><b>Ylärivi</b> = rastivälin aika, <b>alarivi</b> = kokonaisaika lähdöstä kyseiselle rastille. Suluissa sija.</li>
          <li><span className="font-bold text-emerald-700">(1)</span> = nopein, <span className="font-bold text-blue-700">(2–3)</span> = toiseksi ja kolmanneksi nopein.</li>
          <li className="flex gap-2"><span className="mt-1 inline-block size-3 shrink-0 rounded-sm bg-red-100 ring-1 ring-red-300" /><span><b>Pummi</b> = rastiväli, jolla juoksija oli selvästi omaa tasoaan hitaampi.
            <span className="mt-1.5 block">Kunkin rastivälin vertailuaika on kolmen nopeimman keskiarvo. Juoksijan oma taso on hänen rastiväliensä mediaani suhteessa vertailuaikoihin (esim. 1,12 = tyypillisesti 12 % kärkeä hitaampi).</span>
            <span className="mt-1.5 block">Odotettu aika = vertailuaika × oma taso. Väli on pummi, kun se on yli 20 % ja vähintään 20 s odotettua hitaampi. Aikahukka = toteutunut − odotettu aika; näet sen napauttamalla punaista solua.</span>
            <span className="mt-1.5 block text-muted-foreground">Pienissä sarjoissa arvio on suuntaa antava, eikä yhden juoksijan sarjassa pummeja tunnisteta.</span></span></li>
          <li><b>väli</b> ja <b>yht.</b> järjestävät juoksijat rastivälin tai kokonaisajan mukaan. <b>Sija</b> palauttaa tulosjärjestyksen.</li>
        </ul>
      </PopoverContent>
    </Popover>
    {excluded.length > 0 && <p className="text-sm text-muted-foreground">Vertailun ulkopuolella ({excluded.length}): {excluded.map((result) => `${result.firstName} ${result.lastName}`).join(", ")} — ei hyväksyttyä tulosta.</p>}
  </div>;
}

function LegCell({ leg }: { leg: SplitLeg }) {
  const top = (rank: number) => rank === 1 ? "font-bold text-emerald-700" : rank <= 3 ? "font-bold text-blue-700" : "";
  const times = <>
    <div className={top(leg.splitRank)}>{formatDuration(leg.splitMs)} <span className="text-xs">({leg.splitRank})</span></div>
    <div className={`text-xs ${leg.cumulativeRank <= 3 ? top(leg.cumulativeRank) : "text-muted-foreground"}`}>{formatDuration(leg.cumulativeMs)} ({leg.cumulativeRank})</div>
  </>;
  if (!leg.lostMs) return <TableCell className="text-right align-top tabular-nums">{times}</TableCell>;
  // A mistake cell opens its estimated time loss on click or tap (touch
  // screens have no hover for a title tooltip).
  return <TableCell className="bg-red-100 p-0 text-right align-top tabular-nums">
    <Popover><PopoverTrigger asChild><button type="button" className="block w-full cursor-pointer p-2 text-right hover:bg-red-200 focus-visible:bg-red-200 focus-visible:outline-none" aria-label={`Pummi, ${formatDuration(leg.splitMs)}: näytä aikahukka`}>{times}</button></PopoverTrigger>
      <PopoverContent side="top" className="w-auto max-w-64 text-sm"><b>Pummi</b>: arviolta <b className="tabular-nums">{formatDuration(leg.lostMs)}</b> hukkaa juoksijan omaan tasoon verrattuna.</PopoverContent>
    </Popover>
  </TableCell>;
}

function SplitsSkeleton() { return <div className="mx-auto max-w-6xl space-y-6 px-5 py-10 lg:px-8"><Skeleton className="h-12 w-80 max-w-full" /><Skeleton className="h-96 rounded-3xl" /></div>; }
function formatDuration(milliseconds: number | null) { if (milliseconds == null) return "–"; const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
