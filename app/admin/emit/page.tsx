"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmitReader } from "@/components/emit-reader";
import { API_BASE, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";

type EventOption = { id: string; name: string; status: string; startsAt: string; endsAt: string };

// EMIT card reading in the browser (Web Serial) for one event:
// /admin/emit?tapahtuma=<event id>, defaulting to the event nearest to now.
export default function EmitReadingPage() {
  const [token, setToken] = useState<string | null>(null);
  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [eventId, setEventId] = useState("");
  const [readerState, setReaderState] = useState({ connected: false, pendingCards: 0 });
  const [error, setError] = useState("");

  const onSessionExpired = useCallback(() => {
    window.localStorage.removeItem("kuntorastit-admin-token");
    window.location.href = withBasePath("/admin");
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("kuntorastit-admin-token");
    if (!stored) { window.location.href = withBasePath("/admin"); return; }
    fetch(`${API_BASE}/events`, { headers: { Authorization: `Bearer ${stored}` } })
      .then(async (response) => {
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok) throw new Error();
        const items = await response.json() as EventOption[];
        const requested = new URLSearchParams(window.location.search).get("tapahtuma");
        setToken(stored);
        setEvents(items);
        setEventId(items.some((item) => item.id === requested) ? requested! : nearestEventToNow(items)?.id ?? "");
      })
      .catch(() => setError("Tapahtumien lataaminen epäonnistui."));
  }, [onSessionExpired]);

  // Keep the chosen event in the URL so the page can be reloaded/bookmarked.
  useEffect(() => {
    if (!eventId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tapahtuma", eventId);
    window.history.replaceState(null, "", url);
  }, [eventId]);

  // Unconfirmed cards would be lost on reload/close.
  useEffect(() => {
    if (readerState.pendingCards === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [readerState.pendingCards]);

  const event = events?.find((item) => item.id === eventId);
  return <main className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><div><b className="block">{SITE_NAME}</b><span className="text-xs text-muted-foreground">Ylläpito</span></div></div><Button asChild variant="ghost" className="rounded-full"><a href={withBasePath("/admin")}><ArrowLeft className="mr-2 size-4" />Tapahtumat</a></Button></div></header>
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-primary">Hallinta</p><h1 className="mt-2 text-3xl font-black tracking-tight">EMIT-luenta</h1><p className="mt-2 text-muted-foreground">Liitä EMIT 250 -lukija tähän koneeseen ja yhdistä. Luetut kortit tallentuvat tapahtuman tuloksiin samoin kuin lukijaohjelmalla.</p></div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      {!events ? !error && <div className="grid place-items-center py-20"><Loader2 className="size-7 animate-spin text-primary" /></div>
        : events.length === 0 ? <p className="text-muted-foreground">Ei tapahtumia. Luo tapahtuma ensin ylläpidossa.</p>
        : <>
          <div className="mb-6 max-w-md"><Label htmlFor="emit-event">Tapahtuma</Label><NativeSelect id="emit-event" className="mt-2 w-full" value={eventId} disabled={readerState.connected} onChange={(changeEvent) => setEventId(changeEvent.target.value)}>{events.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name} · {formatDate(item.startsAt)}</NativeSelectOption>)}</NativeSelect>{readerState.connected && <p className="mt-1.5 text-xs text-muted-foreground">Katkaise lukijayhteys vaihtaaksesi tapahtumaa.</p>}</div>
          {event && token && <EmitReader key={event.id} event={event} token={token} onSessionExpired={onSessionExpired} onStateChange={setReaderState} />}
        </>}
    </div>
  </main>;
}

function nearestEventToNow(events: EventOption[], now = Date.now()) {
  const distance = (item: EventOption) => {
    const startsAt = new Date(item.startsAt).getTime();
    const endsAt = new Date(item.endsAt).getTime();
    return now >= startsAt && now <= endsAt ? 0 : Math.min(Math.abs(now - startsAt), Math.abs(now - endsAt));
  };
  return events.reduce<EventOption | undefined>((nearest, item) => !nearest || distance(item) < distance(nearest) ? item : nearest, undefined);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(value));
}
