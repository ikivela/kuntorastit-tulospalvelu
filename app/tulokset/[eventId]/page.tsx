"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Loader2, MapPin, Navigation, RotateCcw, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const apiBase = "http://localhost:3001/api/v1";
type ResultStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type EventResult = { id: string; rank: number | null; firstName: string; lastName: string; clubName: string | null; status: ResultStatus; durationMs: number | null };
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

  const resultCount = event?.courses.reduce((sum, course) => sum + course.results.length, 0) ?? 0;
  return <main className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4 lg:px-8"><a className="flex items-center gap-3" href="/"><span className="grid size-10 place-items-center rounded-xl bg-primary text-white"><Navigation className="size-5 rotate-45" /></span><span><b className="block tracking-tight">Maanantairastit</b><small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Kokkolan Suunnistajat</small></span></a><Button asChild variant="outline" className="rounded-full"><a href="/kalenteri"><ArrowLeft className="mr-2 size-4" />Kalenteriin</a></Button></div></header>
    {loading ? <ResultsSkeleton /> : !event ? <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8"><Alert variant="destructive"><AlertCircle /><AlertTitle>Tuloksia ei voitu ladata</AlertTitle><AlertDescription><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load(true)}><RotateCcw className="mr-2 size-4" />Yritä uudelleen</Button></AlertDescription></Alert></div> : <>
      <section className="border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_65%,#fff4d8_100%)]"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Tulokset</p><h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">{event.name}</h1><div className="mt-4 flex flex-wrap gap-5 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="size-4 text-primary" />{formatDate(event.startsAt)}</span>{event.locationName && <span className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{event.locationName}</span>}</div></div><div className="flex items-center gap-3"><Badge variant="outline" className="rounded-full bg-white/70 px-3 py-1.5"><span className="mr-2 size-2 rounded-full bg-emerald-500" />Päivittyy automaattisesti</Badge>{refreshing && <Loader2 className="size-4 animate-spin text-primary" />}</div></div></div></section>
      <div className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10">{error && <Alert className="mb-6"><AlertCircle /><AlertTitle>Yhteys katkesi hetkeksi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}{resultCount === 0 ? <Empty className="min-h-72 rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><Trophy /></EmptyMedia><EmptyTitle>Ei vielä tuloksia</EmptyTitle><EmptyDescription>Tulokset ilmestyvät tähän automaattisesti, kun kortteja luetaan.</EmptyDescription></EmptyHeader></Empty> : <div className="space-y-6">{event.courses.filter((course) => course.results.length > 0).map((course) => <CourseResults key={course.id} course={course} />)}</div>}</div>
    </>}
  </main>;
}

function CourseResults({ course }: { course: ResultCourse }) {
  return <Card className="overflow-hidden rounded-3xl"><CardHeader className="flex flex-row items-end justify-between border-b bg-muted/35"><div><p className="eyebrow">Rata</p><CardTitle className="mt-1 text-2xl">{course.name}</CardTitle></div><span className="text-sm font-semibold text-muted-foreground">{formatDistance(course.lengthMeters)} · {course.results.length} tulosta</span></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-16 text-right">Sija</TableHead><TableHead>Nimi</TableHead><TableHead>Seura</TableHead><TableHead>Tulos</TableHead><TableHead className="text-right">Aika</TableHead></TableRow></TableHeader><TableBody>{course.results.map((result) => <TableRow key={result.id}><TableCell className="text-right font-bold tabular-nums">{result.rank ?? "–"}</TableCell><TableCell className="font-bold">{result.firstName} {result.lastName}</TableCell><TableCell className="text-muted-foreground">{result.clubName || "–"}</TableCell><TableCell><ResultBadge status={result.status} /></TableCell><TableCell className="text-right font-black tabular-nums">{result.status === "ACCEPTED" ? formatDuration(result.durationMs) : "–"}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>;
}

function ResultBadge({ status }: { status: ResultStatus }) {
  if (status === "ACCEPTED") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="mr-1 size-3" />Hyväksytty</Badge>;
  if (status === "NO_TIME") return <Badge variant="secondary">Ilman aikaa</Badge>;
  if (status === "DID_NOT_FINISH") return <Badge variant="destructive">Keskeyttänyt</Badge>;
  if (status === "DISQUALIFIED") return <Badge variant="destructive">Hylätty</Badge>;
  return <Badge variant="outline">Odottaa</Badge>;
}

function ResultsSkeleton() { return <div className="mx-auto max-w-6xl space-y-6 px-5 py-10 lg:px-8"><Skeleton className="h-12 w-80 max-w-full" /><Skeleton className="h-52 rounded-3xl" /><Skeleton className="h-52 rounded-3xl" /></div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("fi-FI", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(value)); }
function formatDistance(meters: number) { return `${(meters / 1000).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`; }
function formatDuration(milliseconds: number | null) { if (milliseconds == null) return "–"; const seconds = Math.floor(milliseconds / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`; }
