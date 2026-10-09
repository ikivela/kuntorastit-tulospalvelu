"use client";

import { ChangeEventHandler, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Award, CalendarDays, CheckCircle2, Clock3, Cpu, Download, FileUp, KeyRound, Loader2, Nfc, LockKeyhole, LogOut, MapPin, Pencil, Plus, Route, Trash2, UserRound, Users } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { LocationMapPicker } from "@/components/location-map-picker";
import { API_BASE, DEFAULT_CITY, DEFAULT_PAYMENT_METHODS, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";
import { downloadEventsExcel, readEventsExcel, type ImportRow } from "@/lib/event-excel";
import { groupSeasonsBySeries, type SeasonOption } from "@/lib/seasons";

const apiBase = API_BASE;
type EventStatus = "DRAFT" | "OPEN" | "FINISHED" | "PUBLISHED";
type CourseControl = { id: string; sequenceNumber: number; type: "START" | "NORMAL" | "FINISH" | "CROSSING_POINT" | "END_OF_MARKED_ROUTE"; controlCodes: string[]; control: { code: string } };
type Course = { id: string; name: string; lengthMeters: number; climbMeters: number | null; sortOrder: number; controls?: CourseControl[] };
type EventItem = { id: string; seasonId: string; name: string; locationName: string | null; address: string | null; locationDescription: string | null; latitude: string | number | null; longitude: string | number | null; startsAt: string; endsAt: string; status: EventStatus; registrationOpen: boolean; paymentMethods: string[]; registrationCount: number; attendanceCount: number; courses: Course[]; season: { name: string; year: number } };
type RegistrationItem = { id: string; registeredAt: string; paymentMethod: string | null; notes: string | null; person: { firstName: string; lastName: string; club: { name: string } | null }; course: { id: string; name: string } | null; punchCard: { system: "EMIT" | "SPORT_IDENT"; cardNumber: string } | null };
type Season = SeasonOption;
type ReaderDeviceStatus = "PENDING" | "APPROVED" | "REVOKED";
type ReaderDeviceItem = { id: string; name: string; status: ReaderDeviceStatus; requestedAt: string; approvedAt: string | null; revokedAt: string | null; lastSeenAt: string | null };
const statusLabels: Record<EventStatus, string> = { DRAFT: "Luonnos", OPEN: "Avoinna", FINISHED: "Päättynyt", PUBLISHED: "Julkaistu" };
const editableStatuses: EventStatus[] = ["DRAFT", "PUBLISHED", "FINISHED"];

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState("");
  useEffect(() => {
    const stored = window.localStorage.getItem("kuntorastit-admin-token");
    if (!stored) { setChecking(false); return; }
    fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${stored}` } })
      .then((response) => { if (!response.ok) throw new Error(); setToken(stored); })
      .catch(() => window.localStorage.removeItem("kuntorastit-admin-token"))
      .finally(() => setChecking(false));
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoginError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch(`${apiBase}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
    if (!response.ok) {
      // 429 = too many failed attempts; show the API's wait time.
      const body = response.status === 429 ? await response.json().catch(() => null) as { message?: string } | null : null;
      setLoginError(body?.message || "Virheellinen käyttäjätunnus tai salasana."); return;
    }
    const result = await response.json() as { accessToken: string };
    window.localStorage.setItem("kuntorastit-admin-token", result.accessToken); setToken(result.accessToken);
  }
  function logout() { window.localStorage.removeItem("kuntorastit-admin-token"); setToken(null); }
  if (checking) return <main className="grid min-h-screen place-items-center bg-muted/30"><Loader2 className="size-6 animate-spin text-primary" /></main>;
  if (!token) return <LoginForm onSubmit={login} error={loginError} />;
  return <AdminEvents token={token} onLogout={logout} />;
}

function LoginForm({ onSubmit, error }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string }) {
  return <main className="grid min-h-screen place-items-center bg-[linear-gradient(135deg,#eaf5ed,#fff8e5)] px-5 py-12"><Card className="w-full max-w-md rounded-3xl shadow-xl shadow-primary/10"><CardHeader className="space-y-4"><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><LockKeyhole className="size-5" /></span><div><CardTitle className="text-2xl">Ylläpidon kirjautuminen</CardTitle><CardDescription className="mt-2">Kirjaudu {SITE_NAME}:n hallintaan.</CardDescription></div></CardHeader><CardContent><form className="space-y-5" onSubmit={onSubmit}><Field label="Käyttäjätunnus" name="username" autoComplete="username" /><Field label="Salasana" name="password" type="password" autoComplete="current-password" />{error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}<Button className="w-full rounded-full" type="submit">Kirjaudu hallintaan</Button><Button asChild variant="ghost" className="w-full rounded-full"><a href={withBasePath("/")}><ArrowLeft className="mr-2 size-4" />Takaisin tulospalveluun</a></Button></form></CardContent></Card></main>;
}

function AdminEvents({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [courseEvent, setCourseEvent] = useState<EventItem | null>(null);
  const [registrationEvent, setRegistrationEvent] = useState<EventItem | null>(null);
  const [readerDevicesOpen, setReaderDevicesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [eventsResponse, seasonsResponse] = await Promise.all([fetch(`${apiBase}/events`, { headers: headers() }), fetch(`${apiBase}/events/seasons`, { headers: headers() })]);
      if (!eventsResponse.ok || !seasonsResponse.ok) throw new Error();
      setEvents(await eventsResponse.json()); setSeasons(await seasonsResponse.json());
    } catch { setError("Tapahtumien lataaminen epäonnistui."); }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { void load(); }, [load]);
  function openCreate() { setEditing(null); setFormError(""); setDialogOpen(true); }
  function openEdit(item: EventItem) { setEditing(item); setFormError(""); setDialogOpen(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError("");
    try {
      const data = new FormData(event.currentTarget);
      const startsAt = new Date(String(data.get("startsAt")));
      const endsAt = new Date(String(data.get("endsAt")));
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new Error("Anna tapahtumalle kelvollinen alkamis- ja päättymisaika.");
      if (endsAt <= startsAt) throw new Error("Päättymisajan pitää olla alkamisajan jälkeen.");
      const paymentMethods = String(data.get("paymentMethods") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const latitude = String(data.get("latitude") ?? "").trim();
      const longitude = String(data.get("longitude") ?? "").trim();
      const payload = { seasonId: data.get("seasonId"), name: data.get("name"), locationName: data.get("locationName"), address: data.get("address"), locationDescription: data.get("locationDescription") || undefined, latitude: latitude ? Number(latitude) : undefined, longitude: longitude ? Number(longitude) : undefined, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), status: data.get("status"), registrationOpen: data.get("registrationOpen") === "on", paymentMethods };
      const response = await fetch(editing ? `${apiBase}/events/${editing.id}` : `${apiBase}/events`, { method: editing ? "PATCH" : "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 401) { onLogout(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
        const message = Array.isArray(result?.message) ? result.message.join(" ") : result?.message;
        throw new Error(message || "Tapahtuman tallentaminen epäonnistui.");
      }
      setDialogOpen(false); await load();
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Tapahtuman tallentaminen epäonnistui."); }
    finally { setSaving(false); }
  }
  async function remove(id: string) {
    setError("");
    const response = await fetch(`${apiBase}/events/${id}`, { method: "DELETE", headers: headers() });
    if (!response.ok) { setError("Tapahtuman poistaminen epäonnistui."); return; }
    await load();
  }
  return <main className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><div><b className="block">{SITE_NAME}</b><span className="text-xs text-muted-foreground">Ylläpito</span></div></div><div className="flex gap-2"><Button asChild variant="ghost" className="rounded-full"><a href={withBasePath("/")}>Julkinen sivu</a></Button><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/admin/osallistumiskerrat")}><Award className="mr-2 size-4" />Osallistumiskerrat</a></Button><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/admin/kaudet")}><CalendarDays className="mr-2 size-4" />Kaudet</a></Button><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/admin/emit")}><Nfc className="mr-2 size-4" />EMIT-luenta</a></Button><Button variant="outline" className="rounded-full" onClick={() => setReaderDevicesOpen(true)}><Cpu className="mr-2 size-4" />Lukijalaitteet</Button><Button variant="outline" className="rounded-full" onClick={() => setPasswordOpen(true)}><KeyRound className="mr-2 size-4" />Vaihda salasana</Button><Button variant="outline" className="rounded-full" onClick={onLogout}><LogOut className="mr-2 size-4" />Kirjaudu ulos</Button></div></div></header>
    <div className="mx-auto max-w-6xl px-5 py-10"><div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold uppercase tracking-wider text-primary">Hallinta</p><h1 className="mt-2 text-3xl font-black tracking-tight">Tapahtumat</h1><p className="mt-2 text-muted-foreground">Lisää, muokkaa ja julkaise kauden tapahtumia.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="rounded-full" disabled={loading || events.length === 0} onClick={() => downloadEventsExcel(events)}><Download className="mr-2 size-4" />Lataa Excel</Button><Button variant="outline" className="rounded-full" onClick={() => setImportOpen(true)}><FileUp className="mr-2 size-4" />Tuo Excel</Button><Button className="rounded-full" onClick={openCreate}><Plus className="mr-2 size-4" />Lisää tapahtuma</Button></div></div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      {loading ? <div className="grid place-items-center py-20"><Loader2 className="size-7 animate-spin text-primary" /></div> : events.length === 0 ? <Card className="rounded-3xl border-dashed"><CardContent className="grid place-items-center py-16 text-center"><CalendarDays className="mb-4 size-9 text-muted-foreground" /><p className="font-bold">Ei tapahtumia</p><p className="mt-1 text-sm text-muted-foreground">Luo kauden ensimmäinen tapahtuma.</p></CardContent></Card> : <div className="grid gap-4">{events.map((item) => <EventCard key={item.id} item={item} onRegistrations={() => setRegistrationEvent(item)} onCourses={() => setCourseEvent(item)} onEdit={() => openEdit(item)} onDelete={() => remove(item.id)} />)}</div>}
    </div>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl"><DialogHeader><DialogTitle>{editing ? "Muokkaa tapahtumaa" : "Lisää tapahtuma"}</DialogTitle><DialogDescription>Täytä tapahtuman perustiedot ja valitse julkaisutila.</DialogDescription></DialogHeader><EventForm key={editing?.id ?? "new"} item={editing} seasons={seasons} saving={saving} error={formError} onSubmit={save} onCancel={() => setDialogOpen(false)} /></DialogContent></Dialog>
    <Dialog open={Boolean(courseEvent)} onOpenChange={(open) => { if (!open) { setCourseEvent(null); void load(); } }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-3xl">{courseEvent && <CourseManager event={courseEvent} token={token} onSessionExpired={onLogout} />}</DialogContent></Dialog>
    <Dialog open={Boolean(registrationEvent)} onOpenChange={(open) => { if (!open) setRegistrationEvent(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-4xl">{registrationEvent && <RegistrationManager event={registrationEvent} token={token} onSessionExpired={onLogout} />}</DialogContent></Dialog>
    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent className="rounded-3xl sm:max-w-md">{passwordOpen && <ChangePasswordDialog token={token} onSessionExpired={onLogout} onClose={() => setPasswordOpen(false)} />}</DialogContent></Dialog>
    <Dialog open={importOpen} onOpenChange={setImportOpen}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">{importOpen && <EventImport token={token} onSessionExpired={onLogout} onImported={() => void load()} onClose={() => setImportOpen(false)} />}</DialogContent></Dialog>
    <Dialog open={readerDevicesOpen} onOpenChange={setReaderDevicesOpen}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-3xl">{readerDevicesOpen && <ReaderDevicesManager token={token} onSessionExpired={onLogout} />}</DialogContent></Dialog>
  </main>;
}

function EventCard({ item, onRegistrations, onCourses, onEdit, onDelete }: { item: EventItem; onRegistrations: () => void; onCourses: () => void; onEdit: () => void; onDelete: () => void }) {
  return <Card className="rounded-2xl"><CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-extrabold">{item.name}</h2><Badge variant={item.status === "DRAFT" ? "secondary" : "default"}>{statusLabels[item.status]}</Badge>{item.registrationOpen && <Badge variant="outline">Ilmoittautuminen avoinna</Badge>}</div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"><span className="flex items-center gap-2"><CalendarDays className="size-4" />{formatDate(item.startsAt)}–{formatDate(item.endsAt)}</span><span className="flex items-center gap-2"><MapPin className="size-4" />{item.locationName || item.address || "Ei sijaintia"}</span><span className="flex items-center gap-2"><Clock3 className="size-4" />{item.season.name}</span><span className="flex items-center gap-2"><Route className="size-4" />{item.courses.length} rataa</span><span className="flex items-center gap-2"><Users className="size-4" />{item.attendanceCount} tulosta · {item.registrationCount} ilmoittautunutta</span></div></div><div className="flex shrink-0 flex-wrap gap-2"><Button variant="secondary" className="rounded-full" onClick={onRegistrations}><Users className="mr-2 size-4" />Osanottajat</Button><Button variant="secondary" className="rounded-full" onClick={onCourses}><FileUp className="mr-2 size-4" />Radat / XML-tuonti</Button><Button variant="outline" className="rounded-full" onClick={onEdit}><Pencil className="mr-2 size-4" />Muokkaa</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="icon" className="rounded-full text-destructive" aria-label={`Poista ${item.name}`}><Trash2 className="size-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Poistetaanko tapahtuma?</AlertDialogTitle><AlertDialogDescription>Tapahtuma “{item.name}” ja siihen liittyvät tiedot poistetaan pysyvästi. Toimintoa ei voi perua.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Peruuta</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onDelete}>Poista tapahtuma</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></CardContent></Card>;
}

type ImportResult = { created: number; updated: number; unchanged: number; applied: boolean; changes: { row: number; action: "create" | "update" | "unchanged"; name: string; fields?: string[] }[]; errors: { row: number; message: string }[] };

// Excel import: parse in the browser, dry-run on the API for a preview, then
// apply all rows in one transaction once the admin confirms.
function EventImport({ token, onSessionExpired, onImported, onClose }: { token: string; onSessionExpired: () => void; onImported: () => void; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  async function send(importRows: ImportRow[], dryRun: boolean) {
    const response = await fetch(`${apiBase}/events/import`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ dryRun, rows: importRows }) });
    if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
    const body = await response.json().catch(() => null) as (ImportResult & { message?: string | string[] }) | null;
    if (!response.ok || !body) throw new Error((Array.isArray(body?.message) ? body.message.join(" ") : body?.message) || "Tuonti epäonnistui.");
    return body;
  }
  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(""); setResult(null); setRows(null); setFileName(file.name);
    try {
      const parsed = await readEventsExcel(file);
      if (parsed.length === 0) throw new Error("Tiedostossa ei ole yhtään tapahtumariviä.");
      setRows(parsed); setResult(await send(parsed, true));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tiedoston lukeminen epäonnistui."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  async function apply() {
    if (!rows) return;
    setBusy(true); setError("");
    try { const applied = await send(rows, false); setResult(applied); if (applied.applied) onImported(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Tuonti epäonnistui."); }
    finally { setBusy(false); }
  }
  const pending = result && !result.applied && result.errors.length === 0 && result.created + result.updated > 0;
  const actionLabels = { create: "Uusi", update: "Päivitetään", unchanged: "Ei muutoksia" } as const;
  return <><DialogHeader><DialogTitle>Tuo tapahtumat Excelistä</DialogTitle><DialogDescription>Yksi rivi = yksi tapahtuma. Rivi, jolla on ID, päivittää tapahtuman; tyhjä ID luo uuden. Lataa pohja &quot;Lataa Excel&quot; -napilla. Excelistä puuttuvia tapahtumia ei poisteta.</DialogDescription></DialogHeader>
    <input ref={inputRef} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={(changeEvent) => void choose(changeEvent.target.files?.[0])} />
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="rounded-full" disabled={busy} onClick={() => inputRef.current?.click()}><FileUp className="mr-2 size-4" />{fileName ? "Valitse toinen tiedosto" : "Valitse tiedosto"}</Button>{fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}{busy && <Loader2 className="size-4 animate-spin text-primary" />}</div>
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {result && <div className="space-y-4">
      {result.applied ? <p className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium"><CheckCircle2 className="size-4 text-primary" />Tuonti valmis: {result.created} uutta, {result.updated} päivitettyä, {result.unchanged} ennallaan.</p>
        : <p className="text-sm">{result.errors.length ? <b className="text-destructive">Tiedostossa on {result.errors.length} virhettä — mitään ei tallennettu. Korjaa rivit ja valitse tiedosto uudelleen.</b> : <>Tarkistettu: <b>{result.created}</b> uutta, <b>{result.updated}</b> päivitettävää, <b>{result.unchanged}</b> ennallaan.</>}</p>}
      {result.errors.length > 0 && <Table><TableHeader><TableRow><TableHead className="w-16">Rivi</TableHead><TableHead>Virhe</TableHead></TableRow></TableHeader><TableBody>{result.errors.map((item, index) => <TableRow key={index}><TableCell>{item.row}</TableCell><TableCell className="whitespace-normal text-destructive">{item.message}</TableCell></TableRow>)}</TableBody></Table>}
      {result.errors.length === 0 && result.changes.some((change) => change.action !== "unchanged") && <Table><TableHeader><TableRow><TableHead className="w-16">Rivi</TableHead><TableHead>Tapahtuma</TableHead><TableHead>Muutos</TableHead></TableRow></TableHeader><TableBody>{result.changes.filter((change) => change.action !== "unchanged").map((change) => <TableRow key={change.row}><TableCell>{change.row}</TableCell><TableCell className="font-medium">{change.name}</TableCell><TableCell className="whitespace-normal text-muted-foreground">{actionLabels[change.action]}{change.fields?.length ? `: ${change.fields.join(", ")}` : ""}</TableCell></TableRow>)}</TableBody></Table>}
    </div>}
    <DialogFooter><Button variant="ghost" className="rounded-full" onClick={onClose}>{result?.applied ? "Sulje" : "Peruuta"}</Button>{pending && <Button className="rounded-full" disabled={busy} onClick={() => void apply()}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />}Tuo {result.created + result.updated} tapahtumaa</Button>}</DialogFooter>
  </>;
}

function RegistrationManager({ event, token, onSessionExpired }: { event: EventItem; token: string; onSessionExpired: () => void }) {
  const [items, setItems] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true); setError("");
    fetch(`${apiBase}/events/${event.id}/registrations`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); } if (!response.ok) throw new Error("Ilmoittautuneiden lataaminen epäonnistui."); return response.json() as Promise<RegistrationItem[]>; })
      .then(setItems).catch((cause) => setError(cause instanceof Error ? cause.message : "Ilmoittautuneiden lataaminen epäonnistui.")).finally(() => setLoading(false));
  }, [event.id, token, onSessionExpired]);
  return <><DialogHeader><DialogTitle>Osanottajia · {event.name}</DialogTitle><DialogDescription>{loading ? "Ladataan osallistujia…" : `${items.length} aktiivista ilmoittautumista.`}</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}{loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : items.length === 0 ? <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed text-center text-muted-foreground"><div><UserRound className="mx-auto mb-3 size-8" /><p>Tapahtumaan ei ole vielä ilmoittautuneita.</p></div></div> : <div className="overflow-hidden rounded-2xl border"><Table><TableHeader><TableRow><TableHead>Nimi</TableHead><TableHead>Seura</TableHead><TableHead>Rata</TableHead><TableHead>Leimauskortti</TableHead><TableHead>Maksutapa</TableHead><TableHead>Lisätiedot</TableHead><TableHead>Ilmoittautunut</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell className="font-semibold">{item.person.lastName}, {item.person.firstName}</TableCell><TableCell>{item.person.club?.name ?? "—"}</TableCell><TableCell>{item.course?.name ?? "—"}</TableCell><TableCell>{item.punchCard ? `${item.punchCard.system === "EMIT" ? "Emit" : "SportIdent"} ${item.punchCard.cardNumber}` : "—"}</TableCell><TableCell className="max-w-52 truncate" title={item.paymentMethod ?? undefined}>{item.paymentMethod ?? "—"}</TableCell><TableCell className="max-w-40 truncate" title={item.notes ?? undefined}>{item.notes ?? "—"}</TableCell><TableCell>{formatDate(item.registeredAt)}</TableCell></TableRow>)}</TableBody></Table></div>}</>;
}

function ReaderDevicesManager({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [items, setItems] = useState<ReaderDeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`${apiBase}/reader-devices`, { headers: headers() });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) throw new Error("Lukijalaitteiden lataaminen epäonnistui.");
      setItems(await response.json() as ReaderDeviceItem[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Lukijalaitteiden lataaminen epäonnistui."); }
    finally { setLoading(false); }
  }, [headers, onSessionExpired]);
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);
  async function approve(id: string) {
    setActingId(id); setError("");
    try {
      const response = await fetch(`${apiBase}/reader-devices/${id}/approve`, { method: "POST", headers: headers() });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) throw new Error("Laitteen hyväksyminen epäonnistui.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Laitteen hyväksyminen epäonnistui."); }
    finally { setActingId(null); }
  }
  async function revoke(id: string) {
    setActingId(id); setError("");
    try {
      const response = await fetch(`${apiBase}/reader-devices/${id}/revoke`, { method: "POST", headers: headers() });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) throw new Error("Pääsyn peruminen epäonnistui.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pääsyn peruminen epäonnistui."); }
    finally { setActingId(null); }
  }
  const statusLabel: Record<ReaderDeviceStatus, string> = { PENDING: "Odottaa hyväksyntää", APPROVED: "Hyväksytty", REVOKED: "Peruttu" };
  return <><DialogHeader><DialogTitle>Lukijalaitteet</DialogTitle><DialogDescription>Hyväksy tai peru pc-clientin laitteita. Client rekisteröi itsensä nimellä ja odottaa hyväksyntää.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : items.length === 0 ? <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed text-center text-muted-foreground"><div><Cpu className="mx-auto mb-3 size-8" /><p>Yksikään lukija ei ole vielä pyytänyt pääsyä.</p></div></div> : <div className="overflow-hidden rounded-2xl border"><Table><TableHeader><TableRow><TableHead>Nimi</TableHead><TableHead>Tila</TableHead><TableHead>Pyydetty</TableHead><TableHead>Viimeksi käytetty</TableHead><TableHead className="text-right">Toiminnot</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell className="font-semibold">{item.name}</TableCell><TableCell><Badge variant={item.status === "APPROVED" ? "default" : item.status === "PENDING" ? "secondary" : "destructive"}>{statusLabel[item.status]}</Badge></TableCell><TableCell>{formatDate(item.requestedAt)}</TableCell><TableCell>{item.lastSeenAt ? formatDate(item.lastSeenAt) : "Ei koskaan"}</TableCell><TableCell className="text-right">{item.status === "PENDING" ? <Button size="sm" className="rounded-full" disabled={actingId === item.id} onClick={() => void approve(item.id)}>{actingId === item.id ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Hyväksy</Button> : item.status === "APPROVED" ? <AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="outline" className="rounded-full text-destructive" disabled={actingId === item.id}>Peru pääsy</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Perutaanko laitteen pääsy?</AlertDialogTitle><AlertDialogDescription>Laite “{item.name}” ei voi enää lähettää tuloksia ennen kuin se hyväksytään uudelleen.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Peruuta</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void revoke(item.id)}>Peru pääsy</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : <span className="text-sm text-muted-foreground">—</span>}</TableCell></TableRow>)}</TableBody></Table></div>}</>;
}

function CourseManager({ event, token, onSessionExpired }: { event: EventItem; token: string; onSessionExpired: () => void }) {
  const [courses, setCourses] = useState(event.courses);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    setLoadingDetails(true);
    fetch(`${apiBase}/events/${event.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); } if (!response.ok) throw new Error("Ratojen rastitietojen lataaminen epäonnistui."); return response.json() as Promise<{ courses: Course[] }>; })
      .then((result) => setCourses(result.courses.sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Ratojen rastitietojen lataaminen epäonnistui."))
      .finally(() => setLoadingDetails(false));
  }, [event.id, token, onSessionExpired]);

  async function request(url: string, options: RequestInit) {
    const response = await fetch(url, options);
    if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
      const message = Array.isArray(result?.message) ? result.message.join(" ") : result?.message;
      throw new Error(message || "Radan tallentaminen epäonnistui.");
    }
    return response;
  }

  function coursePayload(data: FormData) {
    const name = String(data.get("name") ?? "").trim();
    const lengthKm = Number(data.get("lengthKm"));
    const climb = String(data.get("climbMeters") ?? "").trim();
    const sortOrder = Number(data.get("sortOrder"));
    if (!name) throw new Error("Anna radalle nimi.");
    if (!Number.isFinite(lengthKm) || lengthKm <= 0) throw new Error("Anna radalle pituus kilometreinä.");
    if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new Error("Anna radalle kelvollinen järjestysnumero.");
    return { name, lengthMeters: Math.round(lengthKm * 1000), climbMeters: climb ? Number(climb) : undefined, sortOrder };
  }

  async function addCourse(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setError(""); setSavingId("new");
    const form = formEvent.currentTarget;
    try {
      const response = await request(`${apiBase}/events/${event.id}/courses`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify(coursePayload(new FormData(form))) });
      const created = await response.json() as Course;
      setCourses((current) => [...current, created].sort((a, b) => a.sortOrder - b.sortOrder));
      form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Radan lisääminen epäonnistui."); }
    finally { setSavingId(null); }
  }

  async function updateCourse(formEvent: FormEvent<HTMLFormElement>, courseId: string) {
    formEvent.preventDefault(); setError(""); setSavingId(courseId);
    try {
      const response = await request(`${apiBase}/events/${event.id}/courses/${courseId}`, { method: "PATCH", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify(coursePayload(new FormData(formEvent.currentTarget))) });
      const updated = await response.json() as Course;
      setCourses((current) => current.map((course) => course.id === courseId ? { ...updated, controls: course.controls } : course).sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Radan tallentaminen epäonnistui."); }
    finally { setSavingId(null); }
  }

  async function removeCourse(courseId: string) {
    setError(""); setSavingId(courseId);
    try {
      await request(`${apiBase}/events/${event.id}/courses/${courseId}`, { method: "DELETE", headers: authHeaders });
      setCourses((current) => current.filter((course) => course.id !== courseId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Radan poistaminen epäonnistui."); }
    finally { setSavingId(null); }
  }

  async function importXml(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setError(""); setNotice(""); setSavingId("import");
    const form = formEvent.currentTarget;
    try {
      const file = (new FormData(form).get("courseData") as File | null);
      if (!file || file.size === 0) throw new Error("Valitse IOF XML CourseData -tiedosto.");
      if (file.size > 9_000_000) throw new Error("XML-tiedosto on liian suuri. Enimmäiskoko on 9 Mt.");
      const response = await request(`${apiBase}/events/${event.id}/courses/import-iof-xml`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ xml: await file.text() }) });
      const result = await response.json() as { imported: number; created: number; updated: number; controls: number; courseControls: number; assignmentsIgnored: number };
      const refreshed = await request(`${apiBase}/events/${event.id}`, { method: "GET", headers: authHeaders });
      const refreshedEvent = await refreshed.json() as { courses: Course[] };
      setCourses(refreshedEvent.courses.sort((a, b) => a.sortOrder - b.sortOrder));
      setNotice(`Tuotiin ${result.imported} rataa, ${result.controls} rastia ja ${result.courseControls} ratapistettä: ${result.created} uutta ja ${result.updated} päivitettyä rataa.${result.assignmentsIgnored ? ` ${result.assignmentsIgnored} luokka- tai kilpailijakytkentää ohitettiin.` : ""}`);
      form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "XML-tuonti epäonnistui."); }
    finally { setSavingId(null); }
  }

  return <><DialogHeader><DialogTitle>Radat · {event.name}</DialogTitle><DialogDescription>Hallinnoi tapahtuman ratoja. Pituus syötetään kilometreinä ja nousu metreinä.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">{notice}</p>}
    <form className="rounded-2xl border border-dashed bg-muted/25 p-4" onSubmit={importXml}><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0 flex-1"><Label htmlFor="courseData">Tuo IOF XML 3.0 CourseData</Label><Input id="courseData" className="mt-2 bg-background" name="courseData" type="file" accept=".xml,application/xml,text/xml" required /><p className="mt-2 text-xs leading-5 text-muted-foreground">Tuonti lukee radat, rastit, koordinaatit, ratapisteet, välipituudet ja karttatekstit. Samanniminen rata ja samankoodinen rasti päivitetään; muita tietoja ei poisteta.</p></div><Button type="submit" variant="outline" disabled={savingId === "import"}>{savingId === "import" ? <Loader2 className="mr-2 animate-spin" /> : <FileUp className="mr-2" />}Tuo XML</Button></div></form>
    <div className="space-y-3">{loadingDetails && <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Ladataan ratapisteitä…</div>}{!loadingDetails && courses.length === 0 && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Tapahtumalla ei ole vielä ratoja.</div>}{!loadingDetails && courses.map((course) => <form key={course.id} className="grid gap-3 rounded-2xl border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1.4fr)_110px_100px_80px_auto] sm:items-end" onSubmit={(formEvent) => updateCourse(formEvent, course.id)}><CourseFields course={course} /><div className="flex gap-2"><Button type="submit" size="icon" variant="outline" disabled={savingId === course.id} aria-label={`Tallenna ${course.name}`}>{savingId === course.id ? <Loader2 className="animate-spin" /> : <Pencil />}</Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" size="icon" variant="outline" className="text-destructive" aria-label={`Poista ${course.name}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Poistetaanko rata?</AlertDialogTitle><AlertDialogDescription>Rata “{course.name}” poistetaan tapahtumasta. Toimintoa ei voi perua.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Peruuta</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void removeCourse(course.id)}>Poista rata</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div><CourseControlSequence course={course} /></form>)}</div>
    <form className="grid gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:grid-cols-[minmax(0,1.4fr)_110px_100px_80px_auto] sm:items-end" onSubmit={addCourse}><CourseFields course={null} defaultSortOrder={courses.length + 1} /><Button type="submit" disabled={savingId === "new"}>{savingId === "new" ? <Loader2 className="mr-2 animate-spin" /> : <Plus className="mr-2" />}Lisää</Button></form>
  </>;
}

function CourseControlSequence({ course }: { course: Course }) {
  const controls = [...(course.controls ?? [])].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return <div className="sm:col-span-5"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Rastikoodit järjestyksessä</p>{controls.length === 0 ? <p className="text-sm text-muted-foreground">Radalle ei ole tuotu ratapisteitä.</p> : <div className="flex flex-wrap items-center gap-1.5">{controls.map((item, index) => <span key={item.id} className="contents">{index > 0 && <span className="text-xs text-muted-foreground" aria-hidden="true">→</span>}<Badge variant={item.type === "NORMAL" ? "outline" : "secondary"} className="font-mono"><span className="mr-1 font-sans text-[10px] font-bold uppercase text-muted-foreground">{courseControlLabel(item.type)}</span>{(item.controlCodes.length ? item.controlCodes : [item.control.code]).join("/")}</Badge></span>)}</div>}</div>;
}

function courseControlLabel(type: CourseControl["type"]) { return ({ START: "Lähtö", NORMAL: "", FINISH: "Maali", CROSSING_POINT: "Ylitys", END_OF_MARKED_ROUTE: "Viitoitus" } as const)[type]; }

function CourseFields({ course, defaultSortOrder = 1 }: { course: Course | null; defaultSortOrder?: number }) {
  return <><Field label="Radan nimi" name="name" defaultValue={course?.name ?? ""} /><Field label="Pituus (km)" name="lengthKm" type="number" defaultValue={course ? String(course.lengthMeters / 1000) : ""} step="0.1" min="0.1" /><Field label="Nousu (m)" name="climbMeters" type="number" defaultValue={course?.climbMeters == null ? "" : String(course.climbMeters)} required={false} min="0" /><Field label="Järjestys" name="sortOrder" type="number" defaultValue={String(course?.sortOrder ?? defaultSortOrder)} min="0" /></>;
}

function EventForm({ item, seasons, saving, error, onSubmit, onCancel }: { item: EventItem | null; seasons: Season[]; saving: boolean; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  // Only drafts may lack courses (the API enforces the same rule).
  const canPublish = Boolean(item && (item.status !== "DRAFT" || item.courses.length > 0));
  const [latitude, setLatitude] = useState<number | null>(item?.latitude != null ? Number(item.latitude) : null);
  const [longitude, setLongitude] = useState<number | null>(item?.longitude != null ? Number(item.longitude) : null);
  const [locationName, setLocationName] = useState(item?.locationName ?? "");
  const [address, setAddress] = useState(item?.address ?? "");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeNotFound, setGeocodeNotFound] = useState(false);
  const hasManuallyMovedRef = useRef(false);

  useEffect(() => {
    const trimmedName = locationName.trim();
    const trimmedAddress = address.trim();
    // Nominatim can be picky about combining an informal venue name with a
    // street ("Karhi, Vikåntie" finds nothing), so try the more specific,
    // more likely-to-resolve combinations first and fall back to broader
    // ones — stopping at the first hit instead of firing them all at once.
    const city = DEFAULT_CITY ? `, ${DEFAULT_CITY}` : "";
    const candidates = [
      trimmedAddress && `${trimmedAddress}${city}`,
      trimmedName && trimmedAddress && `${trimmedName}, ${trimmedAddress}${city}`,
      trimmedName && `${trimmedName}${city}`,
    ].filter((value): value is string => Boolean(value));
    if (candidates.length === 0 || hasManuallyMovedRef.current) { setGeocoding(false); return; }
    setGeocodeNotFound(false);
    const timeout = window.setTimeout(async () => {
      setGeocoding(true);
      try {
        for (const candidate of candidates) {
          const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fi&q=${encodeURIComponent(candidate)}`);
          if (!response.ok) continue;
          const results = await response.json() as { lat: string; lon: string }[];
          if (hasManuallyMovedRef.current) return;
          if (results[0]) { setLatitude(Number(results[0].lat)); setLongitude(Number(results[0].lon)); setGeocodeNotFound(false); return; }
        }
        setGeocodeNotFound(true);
      } catch { /* offline or rate-limited: leave the map as-is */ }
      finally { setGeocoding(false); }
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [locationName, address]);

  return <form className="grid gap-5" onSubmit={onSubmit}><div className="grid gap-5 sm:grid-cols-2"><div className="sm:col-span-2"><Label htmlFor="seasonId">Kausi</Label><select id="seasonId" name="seasonId" defaultValue={item?.seasonId ?? seasons[0]?.id} required className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{groupSeasonsBySeries(seasons).map((group) => { const options = group.seasons.map((season) => <option key={season.id} value={season.id}>{season.name} ({season.year})</option>); return group.seriesName === null ? options : <optgroup key={group.seriesName} label={group.seriesName}>{options}</optgroup>; })}</select></div><div className="sm:col-span-2"><Field label="Tapahtuman nimi" name="name" defaultValue={item?.name ?? ""} /></div><Field label="Paikka" name="locationName" defaultValue={locationName} onChange={(event) => setLocationName(event.target.value)} required={false} /><Field label="Osoite" name="address" defaultValue={address} onChange={(event) => setAddress(event.target.value)} required={false} /><Field label="Alkaa" name="startsAt" type="datetime-local" defaultValue={toLocalInput(item?.startsAt)} /><Field label="Päättyy" name="endsAt" type="datetime-local" defaultValue={toLocalInput(item?.endsAt)} /><div><Label htmlFor="status">Tila</Label><select id="status" name="status" defaultValue={item?.status === "OPEN" ? "PUBLISHED" : item?.status ?? "DRAFT"} className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{editableStatuses.map((value) => <option key={value} value={value} disabled={value !== "DRAFT" && !canPublish}>{statusLabels[value]}</option>)}</select>{!canPublish && <p className="mt-1.5 text-xs text-muted-foreground">{item ? "Lisää tapahtumalle radat ennen julkaisua." : "Uusi tapahtuma tallennetaan luonnoksena. Lisää radat ja julkaise sen jälkeen."}</p>}</div><label className="flex items-center gap-3 self-end rounded-xl border px-4 py-2.5 text-sm font-medium"><input name="registrationOpen" type="checkbox" defaultChecked={item?.registrationOpen ?? false} className="size-4 accent-primary" />Ilmoittautuminen avoinna</label></div><div><Label htmlFor="locationDescription">Sijainnin kuvaus (vapaaehtoinen)</Label><Textarea id="locationDescription" name="locationDescription" className="mt-2" rows={2} defaultValue={item?.locationDescription ?? ""} placeholder="Esim. kokoontumispaikka, opastus tai pysäköintiohjeet" /></div><div><Label>Sijainti kartalla</Label><p className="mt-1 mb-2 text-xs text-muted-foreground">Kartta seuraa Paikka- ja Osoite-kenttiä automaattisesti. Raahaa merkkiä tai klikkaa karttaa hienosäätääksesi sijaintia.</p><input type="hidden" name="latitude" value={latitude ?? ""} /><input type="hidden" name="longitude" value={longitude ?? ""} /><LocationMapPicker latitude={latitude} longitude={longitude} onChange={(lat, lng) => { hasManuallyMovedRef.current = true; setLatitude(lat); setLongitude(lng); }} /><p className="mt-2 text-xs text-muted-foreground">{geocoding ? "Haetaan sijaintia…" : geocodeNotFound ? "Sijaintia ei löytynyt osoitteen perusteella — aseta se kartalta." : latitude != null && longitude != null ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : "Ei sijaintia asetettu."}</p></div><div><Label htmlFor="paymentMethods">Maksutavat (pilkulla eroteltuna)</Label><Textarea id="paymentMethods" name="paymentMethods" className="mt-2" rows={4} defaultValue={(item?.paymentMethods.length ? item.paymentMethods : DEFAULT_PAYMENT_METHODS).join(", ")} /><p className="mt-1.5 text-xs text-muted-foreground">Nämä näkyvät ilmoittautumislomakkeen Maksutapa-valikossa tälle tapahtumalle.</p></div>{error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={onCancel}>Peruuta</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}{item ? "Tallenna muutokset" : "Lisää tapahtuma"}</Button></DialogFooter></form>;
}

function Field({ label, name, type = "text", defaultValue, required = true, autoComplete, min, step, onChange }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean; autoComplete?: string; min?: string; step?: string; onChange?: ChangeEventHandler<HTMLInputElement> }) { return <div><Label>{label}</Label><Input className="mt-2" name={name} type={type} defaultValue={defaultValue} required={required} autoComplete={autoComplete} min={min} step={step} onChange={onChange} /></div>; }
function toLocalInput(value?: string) { if (!value) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function formatDate(value: string) { return new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
