"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ListOrdered, Loader2, MapPin, Navigation, Route, RotateCcw, UserPlus, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const apiBase = "http://localhost:3001/api/v1";
type Course = { id: string; name: string; lengthMeters: number; climbMeters: number | null };
type CalendarEvent = { id: string; name: string; locationName: string | null; address: string | null; startsAt: string; endsAt: string; status: "OPEN" | "FINISHED" | "PUBLISHED"; registrationOpen: boolean; paymentMethods: string[]; attendanceCount: number; registrationCount: number; courses: Course[] };
type Season = { id: string; name: string; year: number; eventSeries: string; rewardThresholds: { id: string; name: string; requiredAttendances: number }[]; events: CalendarEvent[] };

export default function CalendarPage() {
  const [year, setYear] = useState(2026);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${apiBase}/public/calendar?year=${year}`);
      if (!response.ok) throw new Error();
      setSeasons(await response.json());
    } catch { setError("Kalenterin lataaminen epäonnistui. Tarkista yhteys ja yritä uudelleen."); }
    finally { setLoading(false); }
  }, [year]);
  useEffect(() => { void load(); }, [load]);
  const eventCount = useMemo(() => seasons.reduce((sum, season) => sum + season.events.length, 0), [seasons]);
  const attendanceCount = useMemo(() => seasons.flatMap((season) => season.events).reduce((sum, event) => sum + event.attendanceCount, 0), [seasons]);

  return <main className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4 lg:px-8"><a className="flex items-center gap-3" href="/"><span className="grid size-10 place-items-center rounded-xl bg-primary text-white"><Navigation className="size-5 rotate-45" /></span><span><b className="block tracking-tight">Maanantairastit</b><small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Kokkolan Suunnistajat</small></span></a><nav className="flex items-center gap-2"><Button asChild variant="ghost" className="hidden rounded-full sm:flex"><a href="/"><ArrowLeft className="mr-2 size-4" />Etusivulle</a></Button><Button asChild variant="outline" className="rounded-full"><a href="/admin">Ylläpito</a></Button></nav></div></header>

    <section className="border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_65%,#fff4d8_100%)]"><div className="mx-auto max-w-6xl px-5 py-10 lg:px-8 lg:py-14"><div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between"><div><p className="eyebrow">Kokkolan maanantairastit</p><h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">Kalenteri {year}</h1><p className="mt-4 max-w-2xl leading-7 text-muted-foreground">Tarkista tulevat rastit, tapahtumapaikat ja tarjolla olevat radat. Julkaistut tulokset ja osallistujamäärät näkyvät tapahtumien yhteydessä.</p></div><div className="flex gap-3"><Stat value={String(eventCount)} label="tapahtumaa" icon={CalendarDays} /><Stat value={String(attendanceCount)} label="osallistumista" icon={Users} /></div></div></div></section>

    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-8 lg:py-10"><div className="mb-7 flex items-center justify-between rounded-2xl border bg-card p-2 shadow-sm"><Button variant="ghost" className="rounded-xl" onClick={() => setYear((value) => value - 1)} aria-label="Edellinen vuosi"><ChevronLeft className="size-4" /><span className="hidden sm:inline">{year - 1}</span></Button><div className="text-center"><p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Kausi</p><p className="text-lg font-black tabular-nums">{year}</p></div><Button variant="ghost" className="rounded-xl" onClick={() => setYear((value) => value + 1)} aria-label="Seuraava vuosi"><span className="hidden sm:inline">{year + 1}</span><ChevronRight className="size-4" /></Button></div>
      {loading ? <CalendarSkeleton /> : error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Kalenteria ei voitu ladata</AlertTitle><AlertDescription><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}><RotateCcw className="mr-2 size-4" />Yritä uudelleen</Button></AlertDescription></Alert> : seasons.length === 0 ? <Empty className="min-h-80 border bg-card"><EmptyHeader><EmptyMedia variant="icon"><CalendarDays /></EmptyMedia><EmptyTitle>Vuodelle {year} ei ole vielä julkaistuja tapahtumia</EmptyTitle><EmptyDescription>Voit tarkistaa edellisen tai seuraavan vuoden kalenterin nuolipainikkeilla.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => setYear(2026)}>Palaa kauteen 2026</Button></EmptyContent></Empty> : <div className="space-y-10">{seasons.map((season) => <SeasonSection key={season.id} season={season} />)}</div>}
    </div>
  </main>;
}

function SeasonSection({ season }: { season: Season }) {
  return <section><div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">{season.eventSeries}</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight">{season.name}</h2></div>{season.rewardThresholds.length > 0 && <p className="text-sm font-semibold text-muted-foreground">Tavoitepalkinto {season.rewardThresholds[0].requiredAttendances} käynnistä</p>}</div><div className="grid gap-4">{season.events.map((event) => <EventCard key={event.id} event={event} />)}</div></section>;
}

function EventCard({ event }: { event: CalendarEvent }) {
  const timing = getTiming(event);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  return <><Card className="overflow-hidden rounded-3xl shadow-[0_18px_50px_-42px_rgba(21,70,43,.5)]"><CardContent className="p-0"><div className="grid md:grid-cols-[170px_minmax(0,1fr)]"><div className="flex flex-row items-center justify-between gap-4 bg-primary px-5 py-5 text-primary-foreground md:flex-col md:items-start md:justify-start md:px-6 md:py-7"><div><p className="text-xs font-bold uppercase tracking-widest text-white/65">{formatWeekday(event.startsAt)}</p><p className="mt-1 text-2xl font-black">{formatDateRange(event.startsAt, event.endsAt)}</p></div><Badge className="bg-white/12 text-white hover:bg-white/12"><span className={`size-2 rounded-full ${timing.dot}`} />{timing.label}</Badge></div><div className="p-5 md:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-xl font-extrabold tracking-tight">{event.name}</h3><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="size-4 text-primary" />{formatTimeRange(event.startsAt, event.endsAt)}</span><span className="flex items-center gap-2"><MapPin className="size-4 text-primary" />{event.address || event.locationName || "Paikka ilmoitetaan myöhemmin"}</span></div></div><div className="flex flex-wrap gap-2">{event.registrationOpen && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Ilmoittautuminen avoinna</Badge>}{event.registrationCount > 0 && <Badge variant="outline"><UserPlus className="mr-1 size-3" />{event.registrationCount} ilmoittautunut</Badge>}{event.attendanceCount > 0 && <Badge variant="outline"><Users className="mr-1 size-3" />{event.attendanceCount} osallistunut</Badge>}</div></div>{event.courses.length > 0 ? <div className="mt-6 border-t pt-5"><div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Route className="size-4" />Radat</div><div className="flex flex-wrap gap-2">{event.courses.map((course) => <span key={course.id} className="rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold text-secondary-foreground">{course.name} <span className="font-normal text-muted-foreground">{formatDistance(course.lengthMeters)}</span></span>)}</div><div className="mt-5 flex flex-wrap gap-2"><Button asChild variant="outline" className="rounded-full"><a href={`/tulokset/${event.id}`}><ListOrdered className="mr-2 size-4" />Tulokset</a></Button>{event.registrationOpen && <Button className="rounded-full" onClick={() => setRegistrationOpen(true)}><UserPlus className="mr-2 size-4" />Ilmoittaudu tapahtumaan</Button>}</div></div> : <p className="mt-6 border-t pt-5 text-sm text-muted-foreground">Ratavalikoima julkaistaan myöhemmin.</p>}</div></div></CardContent></Card><RegistrationDialog event={event} open={registrationOpen} onOpenChange={setRegistrationOpen} /></>;
}

function RegistrationDialog({ event, open, onOpenChange }: { event: CalendarEvent; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setSaving(true); setError("");
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const cardNumber = String(data.get("cardNumber") ?? "").trim();
    try {
      const payload = { firstName: data.get("firstName"), lastName: data.get("lastName"), clubName: data.get("clubName") || undefined, courseId: data.get("courseId"), punchingSystem: cardNumber ? data.get("punchingSystem") : undefined, cardNumber: cardNumber || undefined, paymentMethod: data.get("paymentMethod"), notes: data.get("notes") || undefined };
      const response = await fetch(`${apiBase}/public/events/${event.id}/registrations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => null) as { message?: string | string[]; participant?: string } | null;
      if (!response.ok) { const message = Array.isArray(result?.message) ? result.message.join(" ") : result?.message; throw new Error(message || "Ilmoittautuminen epäonnistui."); }
      setSuccess(`${result?.participant ?? "Osallistuja"} on ilmoitettu tapahtumaan.`); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ilmoittautuminen epäonnistui."); }
    finally { setSaving(false); }
  }
  function changeOpen(value: boolean) { if (!value) { setError(""); setSuccess(""); } onOpenChange(value); }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-xl"><DialogHeader><DialogTitle>Ilmoittaudu · {event.name}</DialogTitle><DialogDescription>Valitse rata ja anna osallistujan tiedot. Seura, leimauskortti ja lisätiedot ovat vapaaehtoisia.</DialogDescription></DialogHeader>{success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto size-9 text-emerald-700" /><p className="mt-3 font-bold text-emerald-900">Ilmoittautuminen vastaanotettu</p><p className="mt-1 text-sm text-emerald-800">{success}</p><Button className="mt-5 rounded-full" onClick={() => changeOpen(false)}>Valmis</Button></div> : <form className="grid gap-4" onSubmit={submit}><div className="grid gap-4 sm:grid-cols-2"><RegistrationField label="Etunimi" name="firstName" autoComplete="given-name" /><RegistrationField label="Sukunimi" name="lastName" autoComplete="family-name" /></div><RegistrationField label="Seura (vapaaehtoinen)" name="clubName" autoComplete="organization" required={false} /><div><Label htmlFor={`course-${event.id}`}>Sarja (rata)</Label><NativeSelect id={`course-${event.id}`} name="courseId" className="mt-2 w-full" required defaultValue=""><NativeSelectOption value="" disabled>Valitse rata</NativeSelectOption>{event.courses.map((course) => <NativeSelectOption key={course.id} value={course.id}>{course.name} · {formatDistance(course.lengthMeters)}</NativeSelectOption>)}</NativeSelect></div><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor={`system-${event.id}`}>Leimausjärjestelmä</Label><NativeSelect id={`system-${event.id}`} name="punchingSystem" className="mt-2 w-full" defaultValue="EMIT"><NativeSelectOption value="EMIT">Emit</NativeSelectOption><NativeSelectOption value="SPORT_IDENT">SportIdent</NativeSelectOption></NativeSelect></div><RegistrationField label="Kortin numero" name="cardNumber" inputMode="numeric" pattern="[0-9]*" required={false} /></div><div><p className="mb-2 text-sm text-muted-foreground">Valitse haluamasi maksutapa. Jos olet oikeutettu ilmaiseen karttaan, syötä lisätietoihin lisätiedot (Ilmainen kartta (alle 16-vuotiaat ja alle 20v KoS jäsenet) / syntymävuosi).</p><Label htmlFor={`payment-${event.id}`}>Maksutapa</Label><NativeSelect id={`payment-${event.id}`} name="paymentMethod" className="mt-2 w-full" required defaultValue=""><NativeSelectOption value="" disabled>Valitse maksutapa</NativeSelectOption>{event.paymentMethods.map((method) => <NativeSelectOption key={method} value={method}>{method}</NativeSelectOption>)}</NativeSelect></div><div><Label htmlFor={`notes-${event.id}`}>Lisätiedot (vapaaehtoinen)</Label><Textarea id={`notes-${event.id}`} name="notes" className="mt-2" maxLength={2000} rows={3} /></div>{error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}<Button type="submit" className="mt-2 rounded-full" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UserPlus className="mr-2 size-4" />}{saving ? "Tallennetaan…" : "Vahvista ilmoittautuminen"}</Button></form>}</DialogContent></Dialog>;
}

function RegistrationField({ label, name, required = true, ...props }: { label: string; name: string; required?: boolean } & React.ComponentProps<typeof Input>) {
  return <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} className="mt-2" required={required} maxLength={120} {...props} /></div>;
}

function Stat({ value, label, icon: Icon }: { value: string; label: string; icon: typeof Users }) { return <div className="min-w-28 rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur"><Icon className="size-4 text-primary" /><p className="mt-3 text-2xl font-black tabular-nums">{value}</p><p className="text-xs font-semibold text-muted-foreground">{label}</p></div>; }
function CalendarSkeleton() { return <div className="space-y-4">{[1, 2, 3].map((item) => <div key={item} className="grid overflow-hidden rounded-3xl border bg-card md:grid-cols-[170px_1fr]"><Skeleton className="h-28 rounded-none md:h-48" /><div className="space-y-4 p-6"><Skeleton className="h-6 w-52" /><Skeleton className="h-4 w-80 max-w-full" /><Skeleton className="h-9 w-full" /></div></div>)}</div>; }
function formatWeekday(value: string) { return new Intl.DateTimeFormat("fi-FI", { weekday: "long" }).format(new Date(value)); }
function formatDateRange(start: string, end: string) { const formatter = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric" }); return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`; }
function formatTimeRange(start: string, end: string) { const formatter = new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit" }); return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`; }
function formatDistance(meters: number) { return `${(meters / 1000).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`; }
function getTiming(event: CalendarEvent) { const now = Date.now(); const start = new Date(event.startsAt).getTime(); const end = new Date(event.endsAt).getTime(); if (now < start) return { label: "Tulossa", dot: "bg-amber-300" }; if (now <= end) return { label: "Käynnissä", dot: "bg-emerald-300" }; return { label: "Päättynyt", dot: "bg-white/60" }; }
