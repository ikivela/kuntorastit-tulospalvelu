"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Award, CalendarDays, CalendarRange, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";

const apiBase = API_BASE;
type Reward = { id: string; name: string; requiredAttendances: number };
type Season = { id: string; name: string; year: number; startsAt: string; endsAt: string; eventCount: number; rewards: Reward[] };
type Series = { id: string; name: string; description: string | null; seasons: Season[] };
type RewardRow = { key: number; id?: string; name: string; requiredAttendances: string };
type SeasonDialog = { series: Series; season: Season | null };
type Request = (path: string, method: string, body?: unknown) => Promise<unknown>;

export default function SeasonsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem("kuntorastit-admin-token");
    if (!stored) { window.location.href = withBasePath("/admin"); return; }
    fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${stored}` } })
      .then((response) => { if (!response.ok) throw new Error(); setToken(stored); })
      .catch(() => { window.localStorage.removeItem("kuntorastit-admin-token"); window.location.href = withBasePath("/admin"); })
      .finally(() => setChecking(false));
  }, []);

  function onSessionExpired() {
    window.localStorage.removeItem("kuntorastit-admin-token");
    window.location.href = withBasePath("/admin");
  }

  if (checking || !token) return <main className="grid min-h-screen place-items-center bg-muted/30"><Loader2 className="size-6 animate-spin text-primary" /></main>;

  return <main className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><div><b className="block">{SITE_NAME}</b><span className="text-xs text-muted-foreground">Ylläpito</span></div></div><div className="flex gap-2"><Button asChild variant="outline" className="rounded-full"><a href={withBasePath("/admin/osallistumiskerrat")}><Award className="mr-2 size-4" />Osallistumiskerrat</a></Button><Button asChild variant="ghost" className="rounded-full"><a href={withBasePath("/admin")}><ArrowLeft className="mr-2 size-4" />Tapahtumat</a></Button></div></div></header>
    <SeriesManager token={token} onSessionExpired={onSessionExpired} />
  </main>;
}

function SeriesManager({ token, onSessionExpired }: { token: string; onSessionExpired: () => void }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seriesDialog, setSeriesDialog] = useState<Series | "new" | null>(null);
  const [seasonDialog, setSeasonDialog] = useState<SeasonDialog | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const request = useCallback<Request>(async (path, method, body) => {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 401) { onSessionExpired(); throw new Error("Istunto on vanhentunut. Kirjaudu uudelleen."); }
    const result = await response.json().catch(() => null) as { message?: string | string[] } | null;
    if (!response.ok) throw new Error((Array.isArray(result?.message) ? result.message.join(" ") : result?.message) || "Pyyntö epäonnistui.");
    return result;
  }, [token, onSessionExpired]);

  const load = useCallback(() => request("/series", "GET")
    .then((items) => setSeries(items as Series[]))
    .catch((cause) => setError(cause instanceof Error ? cause.message : "Kausien lataaminen epäonnistui."))
    .finally(() => setLoading(false)), [request]);
  useEffect(() => { void load(); }, [load]);

  function openSeries(item: Series | "new") { setFormError(""); setSeriesDialog(item); }
  function openSeason(item: SeasonDialog) { setFormError(""); setSeasonDialog(item); }
  async function submit(path: string, method: string, body: unknown, close: () => void) {
    setSaving(true); setFormError("");
    try { await request(path, method, body); close(); setError(""); await load(); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : "Tallentaminen epäonnistui."); }
    finally { setSaving(false); }
  }
  async function remove(path: string) {
    setError("");
    try { await request(path, "DELETE"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Poistaminen epäonnistui."); }
  }

  return <div className="mx-auto max-w-6xl px-5 py-10"><div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold uppercase tracking-wider text-primary">Hallinta</p><h1 className="mt-2 text-3xl font-black tracking-tight">Kaudet</h1><p className="mt-2 text-muted-foreground">Tapahtumasarjat, niiden kaudet ja kausien palkintorajat. Tapahtumat liitetään kauteen, ja Excel-tuonnin Kausi-sarake viittaa kauden vuoteen.</p></div><Button variant="outline" className="rounded-full" onClick={() => openSeries("new")}><Plus className="mr-2 size-4" />Lisää sarja</Button></div>
    {error && <p role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
    {loading ? <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : series.length === 0 ? <Card className="rounded-3xl border-dashed"><CardContent className="grid place-items-center py-16 text-center"><CalendarRange className="mb-4 size-9 text-muted-foreground" /><p className="font-bold">Ei tapahtumasarjoja</p><p className="mt-1 text-sm text-muted-foreground">Lisää sarja, jotta voit luoda sille kausia.</p></CardContent></Card> : <div className="grid gap-6">{series.map((item) => <SeriesCard key={item.id} series={item} onEdit={() => openSeries(item)} onDelete={() => void remove(`/series/${item.id}`)} onAddSeason={() => openSeason({ series: item, season: null })} onEditSeason={(season) => openSeason({ series: item, season })} onDeleteSeason={(season) => void remove(`/seasons/${season.id}`)} />)}</div>}
    <Dialog open={seriesDialog !== null} onOpenChange={(open) => { if (!open) setSeriesDialog(null); }}><DialogContent className="rounded-3xl sm:max-w-md">{seriesDialog && <SeriesForm item={seriesDialog === "new" ? null : seriesDialog} saving={saving} error={formError} onCancel={() => setSeriesDialog(null)} onSubmit={(body) => void submit(seriesDialog === "new" ? "/series" : `/series/${seriesDialog.id}`, seriesDialog === "new" ? "POST" : "PATCH", body, () => setSeriesDialog(null))} />}</DialogContent></Dialog>
    <Dialog open={seasonDialog !== null} onOpenChange={(open) => { if (!open) setSeasonDialog(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">{seasonDialog && <SeasonForm key={seasonDialog.season?.id ?? "new"} {...seasonDialog} saving={saving} error={formError} onCancel={() => setSeasonDialog(null)} onSubmit={(body) => void submit(seasonDialog.season ? `/seasons/${seasonDialog.season.id}` : "/seasons", seasonDialog.season ? "PATCH" : "POST", seasonDialog.season ? body : { ...body, eventSeriesId: seasonDialog.series.id }, () => setSeasonDialog(null))} />}</DialogContent></Dialog>
  </div>;
}

function SeriesCard({ series, onEdit, onDelete, onAddSeason, onEditSeason, onDeleteSeason }: { series: Series; onEdit: () => void; onDelete: () => void; onAddSeason: () => void; onEditSeason: (season: Season) => void; onDeleteSeason: (season: Season) => void }) {
  return <Card className="rounded-2xl"><CardContent className="p-5">
    <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h2 className="text-lg font-extrabold">{series.name}</h2>{series.description && <p className="mt-1 text-sm text-muted-foreground">{series.description}</p>}</div><div className="flex shrink-0 flex-wrap gap-2"><Button className="rounded-full" onClick={onAddSeason}><Plus className="mr-2 size-4" />Lisää kausi</Button><Button variant="outline" size="icon" className="rounded-full" aria-label={`Muokkaa ${series.name}`} onClick={onEdit}><Pencil className="size-4" /></Button><ConfirmDelete label={`Poista ${series.name}`} disabledReason={series.seasons.length > 0 ? "Sarjalla on kausia. Poista kaudet ensin." : ""} title="Poistetaanko sarja?" description={`Tapahtumasarja “${series.name}” poistetaan pysyvästi.`} action="Poista sarja" onConfirm={onDelete} /></div></div>
    {series.seasons.length === 0 ? <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Sarjalla ei ole vielä kausia.</p> : <div className="overflow-hidden rounded-2xl border"><Table><TableHeader><TableRow><TableHead>Kausi</TableHead><TableHead>Ajanjakso</TableHead><TableHead className="text-right">Tapahtumia</TableHead><TableHead>Palkintorajat</TableHead><TableHead className="w-0" /></TableRow></TableHeader><TableBody>{series.seasons.map((season) => <TableRow key={season.id}><TableCell className="font-semibold">{season.name}<div className="text-xs font-normal text-muted-foreground">Vuosi {season.year}</div></TableCell><TableCell><span className="flex items-center gap-2 whitespace-nowrap"><CalendarDays className="size-4 text-muted-foreground" />{formatDay(season.startsAt)}–{formatDay(season.endsAt)}</span></TableCell><TableCell className="text-right">{season.eventCount}</TableCell><TableCell className="text-sm">{season.rewards.length === 0 ? <span className="text-muted-foreground">—</span> : season.rewards.map((reward) => `${reward.name} (${reward.requiredAttendances})`).join(", ")}</TableCell><TableCell><div className="flex justify-end gap-2"><Button variant="outline" size="icon" className="rounded-full" aria-label={`Muokkaa ${season.name}`} onClick={() => onEditSeason(season)}><Pencil className="size-4" /></Button><ConfirmDelete label={`Poista ${season.name}`} disabledReason={season.eventCount > 0 ? "Kaudella on tapahtumia. Siirrä tai poista ne ensin." : ""} title="Poistetaanko kausi?" description={`Kausi “${season.name}” ja sen palkintorajat poistetaan pysyvästi.`} action="Poista kausi" onConfirm={() => onDeleteSeason(season)} /></div></TableCell></TableRow>)}</TableBody></Table></div>}
  </CardContent></Card>;
}

function ConfirmDelete({ label, disabledReason, title, description, action, onConfirm }: { label: string; disabledReason: string; title: string; description: string; action: string; onConfirm: () => void }) {
  // A disabled button swallows hover, so the reason sits on a wrapper.
  if (disabledReason) return <span title={disabledReason}><Button variant="outline" size="icon" className="rounded-full text-destructive" aria-label={label} disabled><Trash2 className="size-4" /></Button></span>;
  return <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="icon" className="rounded-full text-destructive" aria-label={label}><Trash2 className="size-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description} Toimintoa ei voi perua.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Peruuta</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onConfirm}>{action}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function SeriesForm({ item, saving, error, onSubmit, onCancel }: { item: Series | null; saving: boolean; error: string; onSubmit: (body: { name: string; description: string }) => void; onCancel: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({ name: String(data.get("name") ?? ""), description: String(data.get("description") ?? "") });
  }
  return <><DialogHeader><DialogTitle>{item ? "Muokkaa sarjaa" : "Lisää sarja"}</DialogTitle><DialogDescription>Tapahtumasarjan nimi näkyy julkisessa kalenterissa kauden yläpuolella.</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={submit}><div><Label htmlFor="name">Nimi</Label><Input id="name" name="name" required maxLength={200} defaultValue={item?.name ?? ""} className="mt-2" /></div><div><Label htmlFor="description">Kuvaus (vapaaehtoinen)</Label><Textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={item?.description ?? ""} className="mt-2" /></div>
      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>Peruuta</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}{item ? "Tallenna muutokset" : "Lisää sarja"}</Button></DialogFooter></form></>;
}

type SeasonBody = { name: string; year: number; startsAt: string; endsAt: string; rewards: { id?: string; name: string; requiredAttendances: number }[] };

function SeasonForm({ series, season, saving, error, onSubmit, onCancel }: SeasonDialog & { saving: boolean; error: string; onSubmit: (body: SeasonBody) => void; onCancel: () => void }) {
  const initial = season ?? nextSeasonDefaults(series);
  const [rewards, setRewards] = useState<RewardRow[]>(() => initial.rewards.map((reward, index) => ({ key: index, id: season ? reward.id : undefined, name: reward.name, requiredAttendances: String(reward.requiredAttendances) })));
  const [localError, setLocalError] = useState("");
  function updateReward(key: number, change: Partial<RewardRow>) { setRewards((rows) => rows.map((row) => row.key === key ? { ...row, ...change } : row)); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError("");
    const data = new FormData(event.currentTarget);
    const startsAt = String(data.get("startsAt") ?? "");
    const endsAt = String(data.get("endsAt") ?? "");
    if (endsAt <= startsAt) { setLocalError("Päättymispäivän pitää olla alkamispäivän jälkeen."); return; }
    onSubmit({ name: String(data.get("name") ?? ""), year: Number(data.get("year")), startsAt, endsAt, rewards: rewards.map((row) => ({ id: row.id, name: row.name, requiredAttendances: Number(row.requiredAttendances) })) });
  }
  const shownError = localError || error;
  return <><DialogHeader><DialogTitle>{season ? "Muokkaa kautta" : "Lisää kausi"}</DialogTitle><DialogDescription>{series.name}. Vuosi on sarjan sisällä yksilöllinen, ja Excel-tuonti tunnistaa kauden sen perusteella.</DialogDescription></DialogHeader>
    <form className="grid gap-5" onSubmit={submit}><div className="grid gap-5 sm:grid-cols-2"><div><Label htmlFor="season-name">Nimi</Label><Input id="season-name" name="name" required maxLength={200} defaultValue={initial.name} className="mt-2" /></div><div><Label htmlFor="season-year">Vuosi</Label><Input id="season-year" name="year" type="number" required min={2000} max={2100} step={1} defaultValue={initial.year} className="mt-2" /></div><div><Label htmlFor="season-starts">Alkaa</Label><Input id="season-starts" name="startsAt" type="date" required defaultValue={initial.startsAt.slice(0, 10)} className="mt-2" /></div><div><Label htmlFor="season-ends">Päättyy</Label><Input id="season-ends" name="endsAt" type="date" required defaultValue={initial.endsAt.slice(0, 10)} className="mt-2" /></div></div>
      <div><div className="flex items-center justify-between gap-3"><div><Label>Palkintorajat</Label><p className="mt-1 text-xs text-muted-foreground">Osallistumiskerrat, joilla kauden palkinnon saa. Näkyvät kalenterissa ja osallistumiskertasivulla.</p></div><Button type="button" variant="outline" size="sm" className="shrink-0 rounded-full" onClick={() => setRewards((rows) => [...rows, { key: Math.max(-1, ...rows.map((row) => row.key)) + 1, name: "Tavoitepalkinto", requiredAttendances: "" }])}><Plus className="mr-1 size-4" />Lisää raja</Button></div>
        {rewards.length === 0 ? <p className="mt-3 rounded-xl border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">Ei palkintorajoja.</p> : <div className="mt-3 grid gap-2">{rewards.map((row, index) => <div key={row.key} className="flex items-center gap-2"><Input aria-label={`Palkintorajan ${index + 1} nimi`} required maxLength={200} value={row.name} onChange={(event) => updateReward(row.key, { name: event.target.value })} placeholder="Nimi" /><Input aria-label={`Palkintorajan ${index + 1} osallistumiskerrat`} type="number" required min={1} step={1} value={row.requiredAttendances} onChange={(event) => updateReward(row.key, { requiredAttendances: event.target.value })} placeholder="Kertaa" className="w-28 shrink-0" /><Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full text-destructive" aria-label={`Poista palkintoraja ${index + 1}`} onClick={() => setRewards((rows) => rows.filter((item) => item.key !== row.key))}><Trash2 className="size-4" /></Button></div>)}</div>}</div>
      {shownError && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{shownError}</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>Peruuta</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}{season ? "Tallenna muutokset" : "Lisää kausi"}</Button></DialogFooter></form></>;
}

// A new season continues from the series' latest one: next year, same
// calendar dates and reward thresholds.
function nextSeasonDefaults(series: Series): Omit<Season, "id" | "eventCount"> {
  const latest = series.seasons.reduce<Season | null>((best, season) => !best || season.year > best.year ? season : best, null);
  const year = latest ? latest.year + 1 : new Date().getFullYear();
  const shift = (value: string | undefined, fallback: string) => value ? `${Number(value.slice(0, 4)) + 1}${value.slice(4, 10)}` : `${year}-${fallback}`;
  return { name: `Kausi ${year}`, year, startsAt: shift(latest?.startsAt, "04-01"), endsAt: shift(latest?.endsAt, "10-31"), rewards: latest?.rewards ?? [] };
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}
