"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Pencil, Trash2, UserPlus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddParticipantDialog } from "@/components/add-participant-dialog";
import { type AdminResult, outcomeLabels, outcomeOf, ResultEditDialog } from "@/components/result-edit-dialog";
import { AdminHeader } from "@/components/admin-header";
import { formatSeconds } from "@/lib/duration";
import type { CourseForValidation } from "@/lib/emit250";
import { API_BASE, withBasePath } from "@/lib/site";

type EventOption = { id: string; name: string; status: string; startsAt: string; endsAt: string };
type Course = CourseForValidation & { name: string };

// Results of one event for checking and correcting them:
// /admin/tulokset?tapahtuma=<event id>. Works for past events too, unlike the
// readers, so a mistake can be fixed afterwards.
export default function ResultsAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [eventId, setEventId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [results, setResults] = useState<AdminResult[] | null>(null);
  const [editing, setEditing] = useState<AdminResult | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const onSessionExpired = useCallback(() => {
    window.localStorage.removeItem("kuntorastit-admin-token");
    window.location.href = withBasePath("/admin");
  }, []);
  const authHeaders = useCallback((): Record<string, string> => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    const stored = window.localStorage.getItem("kuntorastit-admin-token");
    if (!stored) { window.location.href = withBasePath("/admin"); return; }
    fetch(`${API_BASE}/events`, { headers: { Authorization: `Bearer ${stored}` } })
      .then(async (response) => {
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok) throw new Error();
        const items = (await response.json() as EventOption[]).sort((left, right) => right.startsAt.localeCompare(left.startsAt));
        const requested = new URLSearchParams(window.location.search).get("tapahtuma");
        setToken(stored);
        setEvents(items);
        setEventId(items.some((item) => item.id === requested) ? requested! : items[0]?.id ?? "");
      })
      .catch(() => setError("Tapahtumien lataaminen epäonnistui."));
  }, [onSessionExpired]);

  // Bumped to reload after a correction, deletion or addition.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!eventId || !token) return;
    let disposed = false;
    Promise.all([
      fetch(`${API_BASE}/events/${eventId}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/events/${eventId}/results`, { headers: authHeaders() }),
    ])
      .then(async ([eventResponse, resultsResponse]) => {
        if (eventResponse.status === 401 || resultsResponse.status === 401) { onSessionExpired(); return; }
        if (!eventResponse.ok || !resultsResponse.ok) throw new Error();
        const eventData = await eventResponse.json() as { courses: Course[] };
        const resultData = await resultsResponse.json() as AdminResult[];
        if (disposed) return;
        setCourses(eventData.courses);
        setResults(resultData);
        setError("");
      })
      .catch(() => { if (!disposed) setError("Tulosten lataaminen epäonnistui."); });
    // Keep the chosen event in the URL so the page can be reloaded/bookmarked.
    const url = new URL(window.location.href);
    url.searchParams.set("tapahtuma", eventId);
    window.history.replaceState(null, "", url);
    return () => { disposed = true; };
  }, [eventId, token, reloadKey, authHeaders, onSessionExpired]);

  async function remove(result: AdminResult) {
    setError(""); setNotice("");
    const response = await fetch(`${API_BASE}/events/${eventId}/results/${result.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null);
    if (response?.status === 401) { onSessionExpired(); return; }
    if (!response?.ok) { setError("Tuloksen poistaminen epäonnistui."); return; }
    setNotice(`${result.firstName} ${result.lastName}: tulos poistettu radalta ${result.courseName}.`);
    load();
  }

  const event = events?.find((item) => item.id === eventId);
  const byCourse = courses.map((course) => ({ course, results: (results ?? []).filter((result) => result.courseId === course.id) }));
  return <main className="min-h-screen bg-muted/30">
    <AdminHeader items={[{ label: "Tapahtumat", icon: ArrowLeft, href: withBasePath("/admin"), variant: "ghost" }]} />
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-primary">Hallinta</p><h1 className="mt-2 text-3xl font-black tracking-tight">Tulokset</h1><p className="mt-2 text-muted-foreground">Tarkista ja korjaa tapahtuman tuloksia: vaihda rata, tila tai aika, poista virheellinen tulos tai lisää puuttuva osanottaja. Korjaukset näkyvät julkisella tulossivulla heti.</p></div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      {notice && <p className="mb-5 rounded-xl border bg-background px-4 py-3 text-sm">{notice}</p>}
      {!events ? !error && <div className="grid place-items-center py-20"><Loader2 className="size-7 animate-spin text-primary" /></div>
        : events.length === 0 ? <p className="text-muted-foreground">Ei tapahtumia.</p>
        : <>
          <div className="mb-6 flex flex-wrap items-end gap-3"><div className="min-w-64 max-w-md flex-1"><Label htmlFor="results-event">Tapahtuma</Label><NativeSelect id="results-event" className="mt-2 w-full" value={eventId} onChange={(changeEvent) => { setNotice(""); setResults(null); setEventId(changeEvent.target.value); }}>{events.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name} · {formatDate(item.startsAt)}</NativeSelectOption>)}</NativeSelect></div><Button variant="outline" className="rounded-full" disabled={courses.length === 0} onClick={() => setAddOpen(true)}><UserPlus className="mr-2 size-4" />Lisää osanottaja</Button>{event && <Button asChild variant="ghost" className="rounded-full"><a href={withBasePath(`/tulokset/${event.id}`)} target="_blank" rel="noreferrer">Julkinen tulossivu</a></Button>}</div>
          {results == null ? <div className="grid place-items-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
            : courses.length === 0 ? <p className="text-muted-foreground">Tapahtumalla ei ole ratoja.</p>
            : <div className="space-y-5">{byCourse.map(({ course, results: courseResults }) => <Card key={course.id} className="rounded-2xl"><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{course.name}</CardTitle><Badge variant="secondary">{courseResults.length} tulosta</Badge></CardHeader><CardContent>{courseResults.length === 0 ? <p className="text-sm text-muted-foreground">Ei tuloksia.</p> : <Table><TableHeader><TableRow><TableHead>Nimi</TableHead><TableHead>Seura</TableHead><TableHead>Kortti</TableHead><TableHead>Tulos</TableHead><TableHead className="text-right">Aika</TableHead><TableHead className="w-24" /></TableRow></TableHeader><TableBody>{courseResults.map((result) => <TableRow key={result.id}>
              <TableCell className="font-medium">{result.lastName} {result.firstName}</TableCell>
              <TableCell className="text-muted-foreground">{result.clubName ?? "–"}</TableCell>
              <TableCell className="font-mono text-muted-foreground">{result.cardNumber ?? "käsin"}</TableCell>
              <TableCell>{outcomeOf(result) === "ACCEPTED" ? outcomeLabels.ACCEPTED : <span className="font-semibold text-destructive">{outcomeLabels[outcomeOf(result)]}</span>}</TableCell>
              <TableCell className="text-right font-mono">{result.durationMs != null ? formatSeconds(Math.round(result.durationMs / 1000)) : "–"}</TableCell>
              <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="rounded-full" aria-label={`Korjaa ${result.firstName} ${result.lastName}`} onClick={() => { setNotice(""); setEditing(result); }}><Pencil className="size-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="rounded-full text-destructive" aria-label={`Poista ${result.firstName} ${result.lastName}`}><Trash2 className="size-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Poistetaanko tulos?</AlertDialogTitle><AlertDialogDescription>{result.firstName} {result.lastName}, {result.courseName}. Jos osallistujalla ei ole muita tuloksia tapahtumassa, myös osallistumiskerta poistuu. Korttiluennan raakadata säilyy.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Peruuta</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove(result)}>Poista tulos</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></TableCell>
            </TableRow>)}</TableBody></Table>}</CardContent></Card>)}</div>}
        </>}
    </div>
    <Dialog open={editing != null} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">{editing && <ResultEditDialog eventId={eventId} result={editing} courses={courses} authHeaders={authHeaders} onSessionExpired={onSessionExpired} onClose={() => setEditing(null)}
      onSaved={() => { setNotice(`${editing.firstName} ${editing.lastName}: tulos korjattu.`); setEditing(null); load(); }} />}</DialogContent></Dialog>
    <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent className="rounded-3xl sm:max-w-lg">{addOpen && <AddParticipantDialog eventId={eventId} courses={courses} authHeaders={authHeaders} onSessionExpired={onSessionExpired} onClose={() => setAddOpen(false)}
      onSaved={(participant) => { setAddOpen(false); setNotice(`${participant.name} lisätty radalle ${participant.courseName}.`); load(); }} />}</DialogContent></Dialog>
  </main>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(value));
}
