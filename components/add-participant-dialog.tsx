"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DURATION_FORMAT_HINT, parseDuration } from "@/lib/duration";
import { API_BASE } from "@/lib/site";

type PersonMatch = { id: string; firstName: string; lastName: string; clubName: string | null };
export type ManualParticipant = { name: string; courseName: string; durationSeconds: number | null };

/** Adds a participant to an event's results by hand (no EMIT card, or the
 * read failed), through the same endpoint as the pc-client's "Syötä
 * osanottoja" (POST .../manual-results). Without a time the result is
 * recorded "ilman aikaa". */
export function AddParticipantDialog({ eventId, courses, authHeaders, onSessionExpired, onSaved, onClose }: {
  eventId: string;
  courses: { id: string; name: string }[];
  authHeaders: () => Record<string, string>;
  onSessionExpired: () => void;
  onSaved: (participant: ManualParticipant) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PersonMatch[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [clubName, setClubName] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // One reference per dialog, so retrying a failed save updates instead of duplicating.
  const [clientReference] = useState(() => `web-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;
    let disposed = false;
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE}/public/persons/search?query=${encodeURIComponent(trimmed)}`, { headers: authHeaders() });
        if (response.status === 401) { onSessionExpired(); return; }
        if (!disposed) setMatches(response.ok ? await response.json() as PersonMatch[] : []);
      } catch {
        if (!disposed) setMatches([]);
      }
    }, 250);
    return () => { disposed = true; window.clearTimeout(timeout); };
  }, [query, authHeaders, onSessionExpired]);

  // Suggestions of an earlier, longer query are hidden once it is shortened.
  const visibleMatches = query.trim().length >= 3 ? matches : [];

  function pick(person: PersonMatch) {
    setPersonId(person.id);
    setFirstName(person.firstName); setLastName(person.lastName); setClubName(person.clubName ?? "");
    setQuery(""); setMatches([]);
  }

  // Typing a different name means a different (possibly new) person.
  function editName(setter: (value: string) => void, value: string) {
    setter(value);
    setPersonId(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (!firstName.trim() || !lastName.trim()) { setError("Etunimi ja sukunimi ovat pakollisia."); return; }
    if (!courseId) { setError("Valitse rata."); return; }
    let durationSeconds: number | null = null;
    if (duration.trim()) {
      durationSeconds = parseDuration(duration);
      if (durationSeconds == null) { setError(DURATION_FORMAT_HINT); return; }
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/public/events/${eventId}/manual-results`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          clientReference, courseId, personId: personId ?? undefined,
          firstName: firstName.trim(), lastName: lastName.trim(), clubName: clubName.trim() || undefined,
          durationSeconds: durationSeconds ?? undefined, readAt: new Date().toISOString(),
        }),
      });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new Error((Array.isArray(body?.message) ? body.message.join(" ") : body?.message) || "Osanottajan tallentaminen epäonnistui.");
      }
      onSaved({ name: `${firstName.trim()} ${lastName.trim()}`, courseName: courses.find((course) => course.id === courseId)?.name ?? "", durationSeconds });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Osanottajan tallentaminen epäonnistui."); }
    finally { setSaving(false); }
  }

  return <><DialogHeader><DialogTitle>Lisää osanottaja</DialogTitle><DialogDescription>Osallistuja ilman EMIT-korttia tai epäonnistunut luenta. Ilman aikaa tulos kirjataan &quot;ilman aikaa&quot;.</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={submit}>
      <div className="relative"><Label htmlFor="manual-search">Hae henkilöä</Label><Input id="manual-search" type="search" autoFocus autoComplete="off" className="mt-2" placeholder="Kirjoita vähintään 3 merkkiä…" value={query} onChange={(changeEvent) => setQuery(changeEvent.target.value)} />
        {visibleMatches.length > 0 && <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-xl border bg-popover p-1 shadow-lg">{visibleMatches.map((person) => <li key={person.id}><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => pick(person)}>{person.firstName} {person.lastName}{person.clubName ? <span className="text-muted-foreground"> · {person.clubName}</span> : null}</button></li>)}</ul>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="manual-first">Etunimi</Label><Input id="manual-first" required autoComplete="off" className="mt-2" value={firstName} onChange={(changeEvent) => editName(setFirstName, changeEvent.target.value)} /></div><div><Label htmlFor="manual-last">Sukunimi</Label><Input id="manual-last" required autoComplete="off" className="mt-2" value={lastName} onChange={(changeEvent) => editName(setLastName, changeEvent.target.value)} /></div></div>
      <div><Label htmlFor="manual-club">Seura</Label><Input id="manual-club" autoComplete="off" className="mt-2" value={clubName} disabled={personId != null} onChange={(changeEvent) => setClubName(changeEvent.target.value)} /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="manual-course">Rata</Label><NativeSelect id="manual-course" className="mt-2 w-full" value={courseId} onChange={(changeEvent) => setCourseId(changeEvent.target.value)}>{courses.length === 0 && <NativeSelectOption value="">Tapahtumalla ei ole ratoja</NativeSelectOption>}{courses.map((course) => <NativeSelectOption key={course.id} value={course.id}>{course.name}</NativeSelectOption>)}</NativeSelect></div><div><Label htmlFor="manual-duration">Aika (valinnainen)</Label><Input id="manual-duration" autoComplete="off" className="mt-2" placeholder="esim. 38:42" value={duration} onChange={(changeEvent) => setDuration(changeEvent.target.value)} /></div></div>
      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="ghost" className="rounded-full" onClick={onClose}>Peruuta</Button><Button type="submit" className="rounded-full" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UserPlus className="mr-2 size-4" />}{duration.trim() ? "Tallenna tulos" : "Tallenna ilman aikaa"}</Button></DialogFooter>
    </form>
  </>;
}
