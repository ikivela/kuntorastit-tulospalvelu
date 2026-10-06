"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Unplug, Usb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type CourseForValidation, type EmitCard, startEmitReader, validateAgainstCourse, validateCourse, webSerialSupport } from "@/lib/emit250";
import { API_BASE } from "@/lib/site";

type ResultStatus = "OK" | "MISSING_CONTROL" | "DISQUALIFIED" | "NO_TIME";
type Course = CourseForValidation & { lengthMeters: number };
type PendingCard = EmitCard & { readAt: string; person: { firstName: string; lastName: string; clubName: string } | null };
type SavedRead = { key: string; cardNumber: number; name: string; status: ResultStatus; seconds: number; courseName: string };

const statusLabels: Record<ResultStatus, string> = { OK: "Tulos OK", MISSING_CONTROL: "Rasti puuttuu", DISQUALIFIED: "Hylätty", NO_TIME: "Ilman aikaa" };
const validationToStatus = { ACCEPTED: "OK", MISSING_CONTROL: "MISSING_CONTROL", DISQUALIFIED: "DISQUALIFIED", UNAVAILABLE: "OK" } as const;

/** Admin-side EMIT 250 reader: reads cards over Web Serial and saves them
 * through the same endpoint as the pc-client (POST .../reader-results). */
export function EmitReaderDialog({ event, token, onSessionExpired }: { event: { id: string; name: string; status: string }; token: string; onSessionExpired: () => void }) {
  const support = webSerialSupport();
  const [courses, setCourses] = useState<Course[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [queue, setQueue] = useState<PendingCard[]>([]);
  const [saved, setSaved] = useState<SavedRead[]>([]);
  const [error, setError] = useState("");
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    fetch(`${API_BASE}/events/${event.id}`, { headers: authHeaders() })
      .then(async (response) => {
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok) throw new Error();
        setCourses(((await response.json()) as { courses: Course[] }).courses);
      })
      .catch(() => setError("Tapahtuman ratojen lataaminen epäonnistui."));
  }, [event.id, authHeaders, onSessionExpired]);

  // Release the serial port when the dialog closes.
  useEffect(() => () => { void stopRef.current?.(); }, []);

  async function lookupPerson(cardNumber: number) {
    const response = await fetch(`${API_BASE}/public/persons/by-card/${cardNumber}`, { headers: authHeaders() });
    if (!response.ok) return null;
    const person = await response.json().catch(() => null) as { firstName: string; lastName: string; clubName: string | null } | null;
    return person ? { firstName: person.firstName, lastName: person.lastName, clubName: person.clubName ?? "" } : null;
  }

  async function connect() {
    setError(""); setConnecting(true);
    try {
      stopRef.current = await startEmitReader(
        (card) => {
          const readAt = new Date().toISOString();
          void lookupPerson(card.cardNumber).catch(() => null).then((person) => setQueue((items) => [...items, { ...card, readAt, person }]));
        },
        (message) => { setError(message); setConnected(false); stopRef.current = null; },
      );
      setConnected(true);
    } catch (cause) {
      // Closing the port picker without choosing is not an error.
      if (!(cause instanceof DOMException && cause.name === "NotFoundError")) setError(`Lukijaa ei voitu avata: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { setConnecting(false); }
  }

  async function disconnect() {
    await stopRef.current?.(); stopRef.current = null; setConnected(false);
  }

  const current = queue[0];
  return <>
    <DialogHeader><DialogTitle>EMIT-luenta · {event.name}</DialogTitle><DialogDescription>Liitä EMIT 250 -lukija tähän koneeseen ja yhdistä. Luetut kortit tallentuvat tapahtuman tuloksiin samoin kuin lukijaohjelmalla.</DialogDescription></DialogHeader>
    {support !== "ok" ? <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{support === "insecure" ? "Web Serial toimii vain suojatulla yhteydellä (https:// tai localhost). Avaa ylläpito https-osoitteesta." : "Tämä selain ei tue Web Serialia. Käytä Chromea tai Edgeä tietokoneella."}</p>
      : <div className="flex flex-wrap items-center gap-3">
        {connected ? <><Badge variant="outline" className="gap-1.5 py-1"><span className="size-2 animate-pulse rounded-full bg-primary" />Yhdistetty · odotetaan korttia</Badge><Button variant="ghost" className="rounded-full" onClick={() => void disconnect()}><Unplug className="mr-2 size-4" />Katkaise</Button></>
          : <Button className="rounded-full" disabled={connecting} onClick={() => void connect()}>{connecting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Usb className="mr-2 size-4" />}Yhdistä lukijaan</Button>}
        {queue.length > 1 && <span className="text-sm text-muted-foreground">{queue.length - 1} korttia jonossa</span>}
      </div>}
    {event.status === "DRAFT" && <p className="flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm"><AlertCircle className="size-4 text-amber-600" />Tapahtuma on luonnos: tuloksia ei voi tallentaa ennen kuin tapahtuma julkaistaan.</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {current && <CardConfirm key={`${current.signature}-${current.readAt}`} card={current} courses={courses} eventId={event.id} authHeaders={authHeaders} onSessionExpired={onSessionExpired}
      onDone={(result) => { setQueue((items) => items.slice(1)); if (result) setSaved((items) => [result, ...items]); }} />}
    {saved.length > 0 && <div><p className="mb-2 text-sm font-bold">Tallennetut tällä kertaa ({saved.length})</p><Table><TableHeader><TableRow><TableHead>Nimi</TableHead><TableHead>Kortti</TableHead><TableHead>Rata</TableHead><TableHead>Aika</TableHead><TableHead>Tila</TableHead></TableRow></TableHeader><TableBody>{saved.map((item) => <TableRow key={item.key}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.cardNumber}</TableCell><TableCell>{item.courseName}</TableCell><TableCell>{item.status === "NO_TIME" ? "–" : formatSeconds(item.seconds)}</TableCell><TableCell>{statusLabels[item.status]}</TableCell></TableRow>)}</TableBody></Table></div>}
  </>;
}

function CardConfirm({ card, courses, eventId, authHeaders, onSessionExpired, onDone }: { card: PendingCard; courses: Course[]; eventId: string; authHeaders: () => Record<string, string>; onSessionExpired: () => void; onDone: (result: SavedRead | null) => void }) {
  const auto = validateCourse(card.punches, courses);
  const [courseId, setCourseId] = useState(auto.courseId ?? courses[0]?.id ?? "");
  const validation = courseId === auto.courseId ? auto : validateAgainstCourse(card.punches, courses.find((course) => course.id === courseId));
  const [status, setStatus] = useState<ResultStatus>(validationToStatus[auto.status]);
  const [firstName, setFirstName] = useState(card.person?.firstName ?? "");
  const [lastName, setLastName] = useState(card.person?.lastName ?? "");
  const [clubName, setClubName] = useState(card.person?.clubName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const totalSeconds = card.punches.reduce((sum, punch) => sum + punch.timeSeconds, 0);

  function chooseCourse(id: string) {
    setCourseId(id);
    setStatus(validationToStatus[validateAgainstCourse(card.punches, courses.find((course) => course.id === id)).status]);
  }

  async function save() {
    setError("");
    if (!firstName.trim() || !lastName.trim()) { setError("Etunimi ja sukunimi ovat pakollisia."); return; }
    if (!courseId) { setError("Valitse rata."); return; }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/public/events/${eventId}/reader-results`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          // Stable per physical read, so a retry updates instead of duplicating.
          clientReference: `web-${card.cardNumber}-${hash(card.signature)}`,
          courseId, resultStatus: status, cardNumber: String(card.cardNumber),
          firstName: firstName.trim(), lastName: lastName.trim(), clubName: clubName.trim() || undefined,
          readAt: card.readAt, readerSerial: "web-serial", punches: card.punches,
        }),
      });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new Error((Array.isArray(body?.message) ? body.message.join(" ") : body?.message) || "Tuloksen tallentaminen epäonnistui.");
      }
      onDone({ key: `${card.signature}-${card.readAt}`, cardNumber: card.cardNumber, name: `${firstName.trim()} ${lastName.trim()}`, status, seconds: totalSeconds, courseName: courses.find((course) => course.id === courseId)?.name ?? "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tuloksen tallentaminen epäonnistui."); }
    finally { setSaving(false); }
  }

  const cumulative = card.punches.map((_, index) => card.punches.slice(0, index + 1).reduce((sum, punch) => sum + punch.timeSeconds, 0));
  return <div className="space-y-4 rounded-2xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-lg font-extrabold">Kortti {card.cardNumber}</p><div className="flex items-center gap-2"><Badge variant={validation.status === "ACCEPTED" ? "default" : "secondary"}>{validation.status === "ACCEPTED" ? "Leimat OK" : validation.status === "MISSING_CONTROL" ? "Rasti puuttuu" : validation.status === "DISQUALIFIED" ? "Väärä rasti" : "Ei rataa tarkistettavaksi"}</Badge><span className="font-mono text-lg font-bold">{formatSeconds(totalSeconds)}</span></div></div>
    {!card.person && <p className="text-sm text-muted-foreground">Korttia ei tunneta: täytä osallistujan tiedot.</p>}
    <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="emit-first">Etunimi</Label><Input id="emit-first" className="mt-1.5" value={firstName} onChange={(changeEvent) => setFirstName(changeEvent.target.value)} /></div><div><Label htmlFor="emit-last">Sukunimi</Label><Input id="emit-last" className="mt-1.5" value={lastName} onChange={(changeEvent) => setLastName(changeEvent.target.value)} /></div><div><Label htmlFor="emit-club">Seura</Label><Input id="emit-club" className="mt-1.5" value={clubName} onChange={(changeEvent) => setClubName(changeEvent.target.value)} /></div></div>
    <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="emit-course">Rata</Label><NativeSelect id="emit-course" className="mt-1.5 w-full" value={courseId} onChange={(changeEvent) => chooseCourse(changeEvent.target.value)}>{courses.length === 0 && <NativeSelectOption value="">Tapahtumalla ei ole ratoja</NativeSelectOption>}{courses.map((course) => <NativeSelectOption key={course.id} value={course.id}>{course.name}</NativeSelectOption>)}</NativeSelect></div><div><Label htmlFor="emit-status">Tulos</Label><NativeSelect id="emit-status" className="mt-1.5 w-full" value={status} onChange={(changeEvent) => setStatus(changeEvent.target.value as ResultStatus)}>{(Object.keys(statusLabels) as ResultStatus[]).map((key) => <NativeSelectOption key={key} value={key}>{statusLabels[key]}</NativeSelectOption>)}</NativeSelect></div></div>
    {card.punches.length > 0 && <div className="max-h-56 overflow-y-auto"><Table><TableHeader><TableRow><TableHead className="w-12">#</TableHead><TableHead>Rasti</TableHead><TableHead>Odotettu</TableHead><TableHead>Väliaika</TableHead><TableHead>Yhteensä</TableHead></TableRow></TableHeader><TableBody>{card.punches.map((punch, index) => { const wrong = validation.invalidIndices.includes(index); return <TableRow key={index} className={wrong ? "bg-destructive/5 text-destructive" : undefined}><TableCell>{index + 1}</TableCell><TableCell className="font-mono">{punch.controlCode}</TableCell><TableCell className="font-mono text-muted-foreground">{validation.expectedCodes[index] ?? "–"}</TableCell><TableCell className="font-mono">{formatSeconds(punch.timeSeconds)}</TableCell><TableCell className="font-mono">{formatSeconds(cumulative[index])}</TableCell></TableRow>; })}</TableBody></Table></div>}
    {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" className="rounded-full" disabled={saving} onClick={() => onDone(null)}>Ohita kortti</Button><Button className="rounded-full" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}Tallenna: {statusLabels[status]}</Button></div>
  </div>;
}

function formatSeconds(total: number) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${hours}:${mmss}` : mmss;
}

// FNV-1a, enough to make a short stable id from the frame bytes.
function hash(value: string) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { result ^= value.charCodeAt(index); result = Math.imul(result, 0x01000193); }
  return (result >>> 0).toString(16);
}
