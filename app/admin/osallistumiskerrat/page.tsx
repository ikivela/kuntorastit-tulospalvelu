"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Award, Copy, Loader2, UserRound, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SITE_NAME } from "@/lib/site";

const apiBase = "http://localhost:3001/api/v1";
type Season = { id: string; name: string; year: number };
type RewardThreshold = { id: string; name: string; requiredAttendances: number };
type AttendanceSummaryRow = { personId: string; firstName: string; lastName: string; clubName: string | null; attendanceCount: number };
type AttendanceSummary = { seasonId: string; seasonName: string; year: number; eventCount: number; rewardThresholds: RewardThreshold[]; rows: AttendanceSummaryRow[] };
type DuplicateCandidate = { id: string; firstName: string; lastName: string; clubName: string | null; registrationCount: number; attendanceCount: number };
type DuplicateGroup = { confidence: "exact" | "similar"; persons: DuplicateCandidate[] };
type PerformanceStatus = "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
type PersonPerformanceRow = { eventId: string; eventName: string; eventStartsAt: string; courseName: string | null; status: PerformanceStatus | null; durationMs: number | null; rank: number | null };

export default function AttendanceSummaryPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("kuntorastit-admin-token");
    if (!stored) { window.location.href = "/admin"; return; }
    fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${stored}` } })
      .then((response) => { if (!response.ok) throw new Error(); setToken(stored); })
      .catch(() => { window.localStorage.removeItem("kuntorastit-admin-token"); window.location.href = "/admin"; })
      .finally(() => setChecking(false));
  }, []);

  function onSessionExpired() {
    window.localStorage.removeItem("kuntorastit-admin-token");
    window.location.href = "/admin";
  }

  if (checking || !token) return <main className="grid min-h-screen place-items-center bg-muted/30"><Loader2 className="size-6 animate-spin text-primary" /></main>;

  return <main className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src="/kos-logo.png" alt="" className="size-8 object-contain" /></span><div><b className="block">{SITE_NAME}</b><span className="text-xs text-muted-foreground">Ylläpito</span></div></div><div className="flex gap-2"><Button variant="outline" className="rounded-full" onClick={() => setDuplicatesOpen(true)}><Copy className="mr-2 size-4" />Epäselvät merkinnät</Button><Button asChild variant="ghost" className="rounded-full"><a href="/admin"><ArrowLeft className="mr-2 size-4" />Tapahtumat</a></Button></div></div></header>
    <div className="mx-auto max-w-4xl px-5 py-10"><div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-primary">Hallinta</p><h1 className="mt-2 text-3xl font-black tracking-tight">Osallistumiskerrat</h1><p className="mt-2 text-muted-foreground">Kauden osallistumiskerrat henkilöä kohti. Selvitä ensin mahdolliset epäselvät merkinnät, jotta laskenta pitää paikkansa. Klikkaa nimeä nähdäksesi henkilön tulokset tapahtumittain.</p></div>
      <AttendanceSummaryTable token={token} onSessionExpired={onSessionExpired} />
    </div>
    <Dialog open={duplicatesOpen} onOpenChange={setDuplicatesOpen}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">{duplicatesOpen && <DuplicatePersonsManager token={token} onSessionExpired={onSessionExpired} />}</DialogContent></Dialog>
  </main>;
}

function AttendanceSummaryTable({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<{ id: string; name: string } | null>(null);
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  useEffect(() => {
    fetch(`${apiBase}/events/seasons`, { headers: headers() })
      .then(async (response) => { if (response.status === 401) { onSessionExpired(); throw new Error(); } if (!response.ok) throw new Error(); return response.json() as Promise<Season[]>; })
      .then((items) => { setSeasons(items); setSeasonId((current) => current || items[0]?.id || ""); })
      .catch(() => setError("Kausien lataaminen epäonnistui."));
  }, [headers, onSessionExpired]);
  useEffect(() => {
    if (!seasonId) { setLoading(false); return; }
    setLoading(true); setError("");
    fetch(`${apiBase}/events/seasons/${seasonId}/attendance-summary`, { headers: headers() })
      .then(async (response) => { if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); } if (!response.ok) throw new Error("Osallistumiskertojen lataaminen epäonnistui."); return response.json() as Promise<AttendanceSummary>; })
      .then(setSummary)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Osallistumiskertojen lataaminen epäonnistui."))
      .finally(() => setLoading(false));
  }, [seasonId, headers, onSessionExpired]);
  return <>
    <div className="mb-5 flex items-center gap-3"><Label className="shrink-0">Kausi</Label><NativeSelect value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>{seasons.map((season) => <NativeSelectOption key={season.id} value={season.id}>{season.name} ({season.year})</NativeSelectOption>)}</NativeSelect></div>
    {summary && summary.rewardThresholds.length > 0 && <p className="mb-5 text-sm text-muted-foreground">Tavoitepalkinto: {summary.rewardThresholds.map((threshold) => `${threshold.name} (${threshold.requiredAttendances} kertaa)`).join(", ")}</p>}
    {error && <p role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : !summary || summary.rows.length === 0 ? <Card className="rounded-3xl border-dashed"><CardContent className="grid place-items-center py-16 text-center"><Users className="mb-4 size-9 text-muted-foreground" /><p className="font-bold">Ei osallistumisia</p><p className="mt-1 text-sm text-muted-foreground">Tällä kaudella ei ole vielä kirjattuja osallistumisia.</p></CardContent></Card> : <div className="overflow-hidden rounded-2xl border bg-background"><Table><TableHeader><TableRow><TableHead>Nimi</TableHead><TableHead>Seura</TableHead><TableHead className="text-right">Osallistumiskertoja</TableHead></TableRow></TableHeader><TableBody>{summary.rows.map((row) => <TableRow key={row.personId}><TableCell className="font-semibold"><button type="button" className="underline-offset-4 hover:underline" onClick={() => setSelectedPerson({ id: row.personId, name: `${row.lastName}, ${row.firstName}` })}>{row.lastName}, {row.firstName}</button></TableCell><TableCell>{row.clubName ?? "—"}</TableCell><TableCell className="text-right"><span className="inline-flex items-center gap-2">{row.attendanceCount}{summary.rewardThresholds.some((threshold) => row.attendanceCount >= threshold.requiredAttendances) && <Award className="size-4 text-primary" aria-label="Tavoitepalkinto saavutettu" />}</span></TableCell></TableRow>)}</TableBody></Table></div>}
    <Dialog open={Boolean(selectedPerson)} onOpenChange={(open) => { if (!open) setSelectedPerson(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">{selectedPerson && <PersonHistory personId={selectedPerson.id} personName={selectedPerson.name} token={token} onSessionExpired={onSessionExpired} />}</DialogContent></Dialog>
  </>;
}

function PersonHistory({ personId, personName, token, onSessionExpired }: { personId: string; personName: string; token: string; onSessionExpired: () => void }) {
  const [rows, setRows] = useState<PersonPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true); setError("");
    fetch(`${apiBase}/persons/${personId}/performances`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); } if (!response.ok) throw new Error("Tulosten lataaminen epäonnistui."); return response.json() as Promise<PersonPerformanceRow[]>; })
      .then(setRows)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Tulosten lataaminen epäonnistui."))
      .finally(() => setLoading(false));
  }, [personId, token, onSessionExpired]);
  return <><DialogHeader><DialogTitle>{personName}</DialogTitle><DialogDescription>Osallistumishistoria tapahtumittain.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Ei osallistumisia.</p> : <div className="overflow-hidden rounded-2xl border"><Table><TableHeader><TableRow><TableHead>Tapahtuma</TableHead><TableHead>Rata</TableHead><TableHead className="text-right">Sija</TableHead><TableHead className="text-right">Aika</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.eventId}><TableCell className="font-semibold">{row.eventName}<div className="text-xs font-normal text-muted-foreground">{formatEventDate(row.eventStartsAt)}</div></TableCell><TableCell>{row.courseName ?? "—"}</TableCell><TableCell className="text-right">{row.rank ?? (row.status ? performanceStatusLabel(row.status) : "—")}</TableCell><TableCell className="text-right">{formatPerformanceDuration(row.durationMs)}</TableCell></TableRow>)}</TableBody></Table></div>}</>;
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(value));
}

function performanceStatusLabel(status: PerformanceStatus) {
  return ({ ACCEPTED: "—", PENDING: "Kesken", DISQUALIFIED: "Hylätty", NO_TIME: "Ilman aikaa", DID_NOT_FINISH: "Ei maalissa" } as const)[status];
}

function formatPerformanceDuration(ms: number | null) {
  if (ms == null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function DuplicatePersonsManager({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [groups, setGroups] = useState<{ exact: DuplicateGroup[]; similar: DuplicateGroup[] }>({ exact: [], similar: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${apiBase}/persons/duplicates`, { headers: headers() });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) throw new Error("Epäselvien merkintöjen lataaminen epäonnistui.");
      setGroups(await response.json() as { exact: DuplicateGroup[]; similar: DuplicateGroup[] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Epäselvien merkintöjen lataaminen epäonnistui."); }
    finally { setLoading(false); }
  }, [headers, onSessionExpired]);
  useEffect(() => { void load(); }, [load]);
  async function merge(key: string, keepPersonId: string, mergePersonIds: string[]) {
    setMergingKey(key); setError("");
    try {
      const response = await fetch(`${apiBase}/persons/merge`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ keepPersonId, mergePersonIds }) });
      if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
      if (!response.ok) throw new Error("Yhdistäminen epäonnistui.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Yhdistäminen epäonnistui."); }
    finally { setMergingKey(null); }
  }
  const allGroups = [...groups.exact, ...groups.similar];
  return <><DialogHeader><DialogTitle>Epäselvät merkinnät</DialogTitle><DialogDescription>Samannäköiset henkilöt, jotka voivat olla sama kilpailija eri kirjoitusasulla. Valitse säilytettävä ja yhdistä loput siihen ennen kauden osallistumiskertojen laskemista.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : allGroups.length === 0 ? <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed text-center text-muted-foreground"><div><UserRound className="mx-auto mb-3 size-8" /><p>Ei epäselviä merkintöjä.</p></div></div> : <div className="space-y-4">{allGroups.map((group, index) => <DuplicateGroupCard key={index} group={group} merging={mergingKey === String(index)} onMerge={(keepId, mergeIds) => void merge(String(index), keepId, mergeIds)} />)}</div>}</>;
}

function DuplicateGroupCard({ group, merging, onMerge }: { group: DuplicateGroup; merging: boolean; onMerge: (keepPersonId: string, mergePersonIds: string[]) => void }) {
  const [keepId, setKeepId] = useState(group.persons[0]?.id ?? "");
  return <Card className="rounded-2xl"><CardContent className="p-5">
    <Badge variant={group.confidence === "exact" ? "default" : "secondary"} className="mb-3">{group.confidence === "exact" ? "Todennäköinen tupla" : "Samankaltainen — tarkista"}</Badge>
    <RadioGroup value={keepId} onValueChange={setKeepId} className="gap-2">{group.persons.map((person) => <label key={person.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm"><RadioGroupItem value={person.id} /><span className="font-semibold">{person.lastName}, {person.firstName}</span><span className="text-muted-foreground">{person.clubName ?? "Ei seuraa"}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{person.attendanceCount} osallistumista · {person.registrationCount} ilmoittautumista</span></label>)}</RadioGroup>
    <Button className="mt-4 rounded-full" size="sm" disabled={merging} onClick={() => onMerge(keepId, group.persons.filter((person) => person.id !== keepId).map((person) => person.id))}>{merging ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Yhdistä valittuun</Button>
  </CardContent></Card>;
}
