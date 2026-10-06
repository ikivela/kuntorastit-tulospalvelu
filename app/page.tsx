"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarDays, Clock3, ListOrdered, MapPin, RotateCcw, UserPlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { RegistrationDialog } from "@/components/registration-dialog";
import { API_BASE, CLUB_NAME, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";

const apiBase = API_BASE;
type Course = { id: string; name: string; lengthMeters: number };
type CalendarEvent = { id: string; name: string; locationName: string | null; address: string | null; startsAt: string; endsAt: string; registrationOpen: boolean; paymentMethods: string[]; courses: Course[] };
type Season = { events: CalendarEvent[] };

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const year = new Date().getFullYear();
      const response = await fetch(`${apiBase}/public/calendar?year=${year}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const seasons = await response.json() as Season[];
      const now = Date.now();
      const upcoming = seasons
        .flatMap((season) => season.events)
        .filter((event) => new Date(event.endsAt).getTime() >= now)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setEvents(upcoming);
    } catch { setError("Tapahtumien lataaminen epäonnistui. Tarkista yhteys ja yritä uudelleen."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-5 px-5 py-4 lg:px-8">
        <a className="flex items-center gap-3" href={withBasePath("/")}><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><span><b className="block tracking-tight">{SITE_NAME}</b>{CLUB_NAME && <small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">{CLUB_NAME}</small>}</span></a>
        <nav className="flex items-center gap-2"><Button asChild variant="ghost" className="rounded-full"><a href={withBasePath("/kalenteri")}>Koko kalenteri</a></Button><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/admin")}>Ylläpito</a></Button></nav>
      </div>
    </header>

    <section className="border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_60%,#fff4d8_100%)]">
      <div className="mx-auto max-w-4xl px-5 py-12 lg:px-8 lg:py-16">
        {CLUB_NAME && <p className="eyebrow">{CLUB_NAME}</p>}
        <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">{SITE_NAME}</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">Täältä löydät kaikki tulevat tapahtumat, tulokset ja ilmoittautumisen.</p>
      </div>
    </section>

    <div className="mx-auto max-w-4xl px-5 py-10 lg:px-8 lg:py-12">
      <div className="mb-6 flex items-end justify-between gap-4"><h2 className="text-2xl font-extrabold tracking-tight">Seuraavat tapahtumat</h2>{error && <Button variant="outline" size="sm" className="rounded-full" onClick={() => void load()}><RotateCcw className="mr-2 size-4" />Yritä uudelleen</Button>}</div>
      {error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Tapahtumia ei voitu ladata</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        : events === null ? <div className="space-y-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-3xl" />)}</div>
        : events.length === 0 ? <Empty className="rounded-3xl border bg-card"><EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>Ei tulevia tapahtumia juuri nyt</EmptyTitle><EmptyDescription>Koko kauden tapahtumat löytyvät kalenterista.</EmptyDescription></EmptyHeader><EmptyContent><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/kalenteri")}>Avaa kalenteri</a></Button></EmptyContent></Empty>
        : <div className="space-y-4">{events.map((event) => <EventRow key={event.id} event={event} />)}</div>}
    </div>

    <footer className="border-t bg-white"><div className="mx-auto flex max-w-4xl flex-col gap-2 px-5 py-7 text-sm text-muted-foreground sm:flex-row sm:justify-between lg:px-8"><p>© {new Date().getFullYear()} {CLUB_NAME || SITE_NAME}</p><p>{SITE_NAME} — tapahtumat, tulokset ja ilmoittautuminen.</p></div></footer>
  </main>;
}

function EventRow({ event }: { event: CalendarEvent }) {
  const [registrationOpen, setRegistrationOpen] = useState(false);
  return <><Card className="overflow-hidden rounded-3xl transition hover:-translate-y-0.5 hover:shadow-md">
    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-secondary text-center leading-tight text-primary"><span><span className="block text-[10px] font-bold uppercase tracking-wider">{formatMonth(event.startsAt)}</span><span className="block text-xl font-black">{formatDay(event.startsAt)}</span></span></div>
        <div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-extrabold">{event.name}</h3>{event.registrationOpen && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Ilmoittautuminen avoinna</Badge>}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{formatTimeRange(event.startsAt, event.endsAt)}</span><span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{event.address || event.locationName || "Paikka ilmoitetaan myöhemmin"}</span></div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:pl-4"><Button asChild variant="outline" className="rounded-full"><a href={withBasePath(`/tulokset/${event.id}`)}><ListOrdered className="mr-2 size-4" />Tulokset</a></Button>{event.registrationOpen && <Button className="rounded-full" onClick={() => setRegistrationOpen(true)}><UserPlus className="mr-2 size-4" />Ilmoittaudu</Button>}</div>
    </CardContent>
  </Card><RegistrationDialog event={event} open={registrationOpen} onOpenChange={setRegistrationOpen} /></>;
}
function formatMonth(value: string) { return new Intl.DateTimeFormat("fi-FI", { month: "short" }).format(new Date(value)).replace(".", ""); }
function formatDay(value: string) { return new Intl.DateTimeFormat("fi-FI", { day: "numeric" }).format(new Date(value)); }
function formatTimeRange(start: string, end: string) { const formatter = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }); return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`; }
