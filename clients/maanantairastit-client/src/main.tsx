import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";

declare const __BUILD_DATE__: string;
const API_BASE = "http://localhost:3001/api/v1";
let installationIdPromise: Promise<string> | undefined;
const syncingReadIds = new Set<number>();

type SerialDevice = {
  portName: string;
  portType: string;
  vid?: number;
  pid?: number;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
};

type ProbeResult = {
  portName: string;
  bytesReceived: number;
  frameFound: boolean;
  cardNumber?: number;
  rawHex: string;
  productionWeek?: number;
  productionYear?: number;
  punches: { controlCode: number; timeSeconds: number }[];
};
type StoredCardRead = {
  id: number;
  eventId: string;
  courseId?: string;
  cardNumber?: number;
  portName: string;
  readAtMs: number;
  productionWeek?: number;
  productionYear?: number;
  punches: { controlCode: number; timeSeconds: number }[];
  participantId: number;
  firstName: string;
  lastName: string;
  participantName: string;
  club?: string;
  resultStatus: "OK" | "NO_TIME" | "DISQUALIFIED" | "MISSING_CONTROL";
  syncStatus: "PENDING" | "SYNCED" | "ERROR";
  syncError?: string;
  source: "EMIT" | "MANUAL";
  personId?: string;
};
type Participant = { id: number; cardNumber: number; firstName: string; lastName: string; club?: string; apiPersonId?: string };
type CourseControl = { sequenceNumber: number; type: string; controlCodes: string[]; control: { code: string } };
type Course = { id: string; name: string; lengthMeters: number; climbMeters?: number; controls?: CourseControl[] };
type CalendarEvent = { id: string; name: string; locationName?: string; startsAt: string; endsAt: string; status: string; courses: Course[] };
type CalendarSeason = { id: string; name: string; events: CalendarEvent[] };
type ApiRegistration = { registrationId: string; personId: string; firstName: string; lastName: string; clubName?: string; cardNumber: string; courseId?: string; courseName?: string; registeredAt: string };

function App() {
  const [devices, setDevices] = useState<SerialDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [status, setStatus] = useState("Haetaan sarjaportteja...");
  const [reading, setReading] = useState(false);
  const [history, setHistory] = useState<StoredCardRead[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [pendingCard, setPendingCard] = useState<ProbeResult | null>(null);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [pendingParticipant, setPendingParticipant] = useState<Participant | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [club, setClub] = useState("");
  const [formError, setFormError] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [editingReadId, setEditingReadId] = useState<number | null>(null);
  const [resumeAfterEdit, setResumeAfterEdit] = useState(false);
  const [registrationSyncStatus, setRegistrationSyncStatus] = useState("");
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualClub, setManualClub] = useState("");
  const [manualCourseId, setManualCourseId] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualPersonId, setManualPersonId] = useState<string | null>(null);
  const [manualSuggestions, setManualSuggestions] = useState<Participant[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlistenRead: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenStopped: (() => void) | undefined;
    void (async () => {
      const listeners = await Promise.all([
        listen<ProbeResult>("emit250://read", () => undefined),
        listen<string>("emit250://error", (event) => { if (!disposed) { setReading(false); setStatus(event.payload); } }),
        listen("emit250://stopped", () => { if (!disposed) { setReading(false); setStatus("Kuuntelu lopetettu."); } }),
      ]);
      [unlistenRead, unlistenError, unlistenStopped] = listeners;
    })();
    return () => { disposed = true; unlistenRead?.(); unlistenError?.(); unlistenStopped?.(); void invoke("stop_emit250"); };
  }, []);

  async function refresh() {
    try {
      const found = await invoke<SerialDevice[]>("list_serial_devices");
      setDevices(found);
      setSelected((current) => current || found[0]?.portName || "");
      setStatus(found.length ? `Löytyi ${found.length} sarjaporttia.` : "Sarjaportteja ei löytynyt.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function startListening() {
    if (!selected) return false;
    setReading(true);
    setResult(null);
    setStatus("Avataan porttia…");
    try {
      await invoke("start_emit250", { portName: selected });
      await invoke("set_reader_port_setting", { portName: selected }).catch(() => undefined);
      setStatus("");
      return true;
    } catch (error) {
      setReading(false);
      setStatus(String(error));
      return false;
    }
  }

  async function loadCalendar() {
    setCalendarLoading(true); setCalendarError("");
    try {
      const response = await fetch(`${API_BASE}/public/calendar?year=${new Date().getFullYear()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const seasons = await response.json() as CalendarSeason[];
      const found = seasons.flatMap((season) => season.events).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setEvents(found);
      const nearest = nearestEventToNow(found);
      setSelectedEventId((current) => found.some((event) => event.id === current) ? current : nearest?.id || "");
    } catch {
      setCalendarError("Tapahtumien haku backendistä epäonnistui.");
    } finally { setCalendarLoading(false); }
  }

  async function startEvent() {
    const event = events.find((item) => item.id === selectedEventId);
    if (!event) return;
    if (!selected) { setSettingsOpen(true); setStatus("Valitse ensin lukijan sarjaportti."); return; }
    setHistorySearch("");
    setActiveEvent(event);
    await syncRegistrations(event.id);
    if (await startListening()) {
      await refreshHistory(event.id);
    } else {
      setActiveEvent(null);
    }
  }

  function authHeaders(extra?: Record<string, string>) {
    return apiKey ? { ...extra, authorization: `Bearer ${apiKey}` } : extra ?? {};
  }

  async function saveApiKey() {
    const value = apiKeyInput.trim();
    if (!value) return;
    try {
      await invoke("set_setting_value", { key: "reader.api_key", value });
      setApiKey(value);
      setApiKeySaved(true);
      window.setTimeout(() => setApiKeySaved(false), 2000);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function syncRegistrations(eventId: string) {
    setRegistrationSyncStatus("Päivitetään ilmoittautuneita…");
    try {
      const response = await fetch(`${API_BASE}/public/events/${eventId}/reader-registrations`, { cache: "no-store", headers: authHeaders() });
      if (response.status === 401) throw new Error("API-avain puuttuu tai on virheellinen");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const registrations = await response.json() as ApiRegistration[];
      const count = await invoke<number>("sync_event_registrations", { eventId, registrations });
      setRegistrationSyncStatus(`${count} ilmoittautunutta synkronoitu`);
    } catch {
      setRegistrationSyncStatus("Ei API-yhteyttä · käytetään paikallisia tietoja");
    }
  }

  async function stopEvent() {
    await stopListening();
    setActiveEvent(null);
    setPendingEventId(null);
    setHistory([]);
    setHistorySearch("");
  }

  async function stopListening() {
    await invoke("stop_emit250");
    setReading(false);
    setStatus("Kuuntelu lopetettu.");
  }

  async function refreshHistory(eventId = activeEvent?.id) {
    if (!eventId) { setHistory([]); return; }
    const reads = await invoke<StoredCardRead[]>("recent_card_reads", { eventId, limit: 300 });
    setHistory(reads);
    void syncPendingReads(reads);
  }

  async function installationId() {
    installationIdPromise ??= (async () => {
      const existing = await invoke<string | null>("setting_value", { key: "reader.installation_id" });
      if (existing) return existing;
      const created = crypto.randomUUID();
      await invoke("set_setting_value", { key: "reader.installation_id", value: created });
      return created;
    })().catch((error) => {
      installationIdPromise = undefined;
      throw error;
    });
    return installationIdPromise;
  }

  async function syncPendingReads(reads: StoredCardRead[]) {
    const pending = reads.filter((read) => read.syncStatus !== "SYNCED" && !syncingReadIds.has(read.id));
    if (!pending.length) return;
    const clientId = await installationId();
    for (const read of pending) {
      syncingReadIds.add(read.id);
      if (!read.courseId || (read.source === "EMIT" && !read.cardNumber)) {
        await invoke("mark_card_read_sync", { readId: read.id, synced: false, error: "Ratatieto puuttuu." });
        syncingReadIds.delete(read.id);
        continue;
      }
      try {
        const url = read.source === "MANUAL"
          ? `${API_BASE}/public/events/${read.eventId}/manual-results`
          : `${API_BASE}/public/events/${read.eventId}/reader-results`;
        const body = read.source === "MANUAL"
          ? {
              courseId: read.courseId,
              personId: read.personId || undefined,
              firstName: read.firstName,
              lastName: read.lastName,
              clubName: read.club || undefined,
            }
          : {
              clientReference: `${clientId}:${read.id}`,
              courseId: read.courseId,
              resultStatus: read.resultStatus,
              cardNumber: String(read.cardNumber),
              firstName: read.firstName,
              lastName: read.lastName,
              clubName: read.club || undefined,
              readAt: new Date(read.readAtMs).toISOString(),
              readerSerial: read.portName,
              punches: read.punches,
            };
        const response = await fetch(url, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(body),
        });
        if (response.status === 401) throw new Error("API-avain puuttuu tai on virheellinen. Aseta se asetuksista.");
        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
        await invoke("mark_card_read_sync", { readId: read.id, synced: true, error: null });
        setHistory((current) => current.map((item) => item.id === read.id ? { ...item, syncStatus: "SYNCED", syncError: undefined } : item));
      } catch (error) {
        const message = String(error);
        await invoke("mark_card_read_sync", { readId: read.id, synced: false, error: message });
        setHistory((current) => current.map((item) => item.id === read.id ? { ...item, syncStatus: "ERROR", syncError: message } : item));
      } finally {
        syncingReadIds.delete(read.id);
      }
    }
  }

  async function saveManualResult(event: React.FormEvent) {
    event.preventDefault();
    if (!activeEvent) return;
    setManualError("");
    try {
      await invoke("add_manual_result", {
        eventId: activeEvent.id,
        courseId: manualCourseId || null,
        firstName: manualFirstName,
        lastName: manualLastName,
        club: manualClub || null,
        personId: manualPersonId,
      });
      const name = `${manualFirstName} ${manualLastName}`;
      closeManualEntry();
      await refreshHistory();
      setStatus(`${name} lisätty tuloksiin ilman aikaa.`);
    } catch (error) {
      setManualError(String(error));
    }
  }

  function closeManualEntry() {
    setManualEntryOpen(false);
    setManualQuery(""); setManualFirstName(""); setManualLastName(""); setManualClub(""); setManualCourseId("");
    setManualPersonId(null); setManualSuggestions([]); setManualError("");
  }

  function openManualEntry() {
    closeManualEntry();
    setManualCourseId(activeEvent?.courses[0]?.id ?? "");
    setManualEntryOpen(true);
  }

  function pickManualSuggestion(person: Participant) {
    setManualFirstName(person.firstName);
    setManualLastName(person.lastName);
    setManualClub(person.club || "");
    setManualPersonId(person.apiPersonId ?? null);
    setManualQuery(""); setManualSuggestions([]);
  }

  function editManualName(setter: (value: string) => void, value: string) {
    setter(value);
    setManualPersonId(null);
  }

  async function saveParticipant(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingCard?.cardNumber) return;
    setFormError("");
    try {
      const participant = await invoke<Participant>("register_participant", {
        cardNumber: pendingCard.cardNumber,
        firstName,
        lastName,
        club: club || null,
        eventId: pendingEventId ?? activeEvent?.id ?? null,
        courseId: cardValidation?.courseId ?? null,
      });
      setFirstName(""); setLastName(""); setClub("");
      setPendingParticipant(participant);
      setStatus(`Osallistuja ${participant.firstName} ${participant.lastName} tallennettu. Kuittaa lukutulos.`);
    } catch (error) {
      setFormError(String(error));
    }
  }

  async function confirmResult(resultStatus: "OK" | "NO_TIME" | "DISQUALIFIED" | "MISSING_CONTROL") {
    if (!pendingParticipant || !pendingCard) return;
    setFormError("");
    try {
      if (editingReadId != null) {
        await invoke("update_card_read_status", { readId: editingReadId, resultStatus });
      } else {
        const eventId = pendingEventId ?? activeEvent?.id;
        if (!eventId) throw new Error("Korttiluku ei ole sidottu tapahtumaan. Käynnistä tapahtuma uudelleen.");
        if (!cardValidation?.courseId) throw new Error("Tulokselle ei löytynyt rataa, joten sitä ei voida synkronoida.");
        await invoke("confirm_latest_emit250_read", {
          participantId: pendingParticipant.id,
          eventId,
          courseId: cardValidation.courseId,
          resultStatus,
        });
      }
      const name = `${pendingParticipant.firstName} ${pendingParticipant.lastName}`;
      const shouldResume = editingReadId == null ? Boolean(activeEvent) : resumeAfterEdit;
      setPendingCard(null); setPendingParticipant(null); setResult(null);
      setPendingEventId(null);
      setEditingReadId(null); setResumeAfterEdit(false);
      await refreshHistory();
      setStatus(`${name}: ${resultStatus === "OK" ? "OK" : resultStatus === "DISQUALIFIED" ? "hylätty" : resultStatus === "MISSING_CONTROL" ? "rasti puuttuu" : "ilman aikaa"}.`);
      if (shouldResume && activeEvent) await startListening();
    } catch (error) {
      setFormError(String(error));
    }
  }

  async function openHistoryRead(item: StoredCardRead) {
    const wasReading = reading;
    if (wasReading) await invoke("stop_emit250");
    setReading(false);
    setResumeAfterEdit(wasReading);
    setEditingReadId(item.id);
    setPendingEventId(activeEvent?.id || selectedEventId || null);
    setFormError("");
    setPendingParticipant({ id: item.participantId, cardNumber: item.cardNumber ?? 0, firstName: item.firstName, lastName: item.lastName, club: item.club });
    const storedResult: ProbeResult = { portName: item.portName, bytesReceived: 0, frameFound: true, cardNumber: item.cardNumber, rawHex: "", productionWeek: item.productionWeek, productionYear: item.productionYear, punches: item.punches };
    setPendingCard(storedResult);
    setResult(storedResult);
    setStatus(`${item.participantName}: muokataan tallennettua lukutulosta.`);
  }

  useEffect(() => {
    void refresh();
    void loadCalendar();
    void invoke<string | null>("reader_port_setting").then((port) => {
      if (port) setSelected(port);
    }).catch(() => undefined);
    void invoke<string | null>("setting_value", { key: "reader.api_key" }).then((key) => {
      if (key) { setApiKey(key); setApiKeyInput(key); }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!activeEvent) return;
    const interval = window.setInterval(() => void syncRegistrations(activeEvent.id), 30_000);
    return () => window.clearInterval(interval);
  }, [activeEvent?.id]);

  useEffect(() => {
    if (!manualEntryOpen) { setManualSuggestions([]); return; }
    const query = manualQuery.trim();
    if (query.length < 3) { setManualSuggestions([]); return; }
    let disposed = false;
    const timeout = window.setTimeout(async () => {
      try {
        const matches = await invoke<Participant[]>("search_participants", { query, limit: 10 });
        if (!disposed) setManualSuggestions(matches);
      } catch {
        if (!disposed) setManualSuggestions([]);
      }
    }, 250);
    return () => { disposed = true; window.clearTimeout(timeout); };
  }, [manualQuery, manualEntryOpen]);

  useEffect(() => {
    if (!reading || !activeEvent) return;
    let disposed = false;
    const poll = async () => {
      try {
        const latest = await invoke<ProbeResult | null>("latest_emit250_read");
        if (!disposed && latest) {
          if (result?.bytesReceived === latest.bytesReceived) return;
          setResult(latest);
          if (latest.cardNumber) {
            const participant = await invoke<Participant | null>("participant_by_card_for_event", { eventId: activeEvent.id, cardNumber: latest.cardNumber });
            setPendingCard(latest);
            setPendingEventId(activeEvent.id);
            setPendingParticipant(participant);
            await invoke("stop_emit250");
            setReading(false);
            if (participant) {
              setStatus(`Kortti ${latest.cardNumber} · ${participant.firstName} ${participant.lastName}. Kuittaa lukutulos.`);
            } else {
              setStatus(`Korttia ${latest.cardNumber} ei tunneta. Täytä osallistujan tiedot.`);
            }
          }
        }
      } catch (error) {
        if (!disposed) setStatus(String(error));
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 250);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [reading, activeEvent?.id, result?.bytesReceived]);

  useEffect(() => {
    if (!result || !activeEvent) return;
    void refreshHistory(activeEvent.id);
  }, [result?.bytesReceived, activeEvent?.id]);

  const cardValidation = pendingCard && activeEvent ? validateCourse(pendingCard.punches, activeEvent.courses) : null;
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase("fi-FI");
    if (!query) return history;
    return history.filter((item) => [
      item.participantName,
      item.club ?? "",
      String(item.cardNumber ?? ""),
      resultStatusLabel(item.resultStatus),
    ].some((value) => value.toLocaleLowerCase("fi-FI").includes(query)));
  }, [history, historySearch]);

  return (
    <main>
      <h4>Maanantairastit client</h4>
      <p className="build-version">Build: {new Date(__BUILD_DATE__).toLocaleString("fi-FI")}</p>

      <section>
        {activeEvent ? <><div className="event-running"><div><span className="eyebrow">Tapahtuma käynnissä</span><h2>{activeEvent.name}</h2><p>{new Date(activeEvent.startsAt).toLocaleString("fi-FI")} · {activeEvent.locationName || "Paikka ei tiedossa"}</p><small>{registrationSyncStatus}</small></div><div className={`reader-badge ${reading ? "ok" : "error"}`}><span />{pendingCard ? "Kuittaus odottaa" : reading ? "Lukija OK" : "Lukija ei yhteydessä"}</div><button onClick={() => void stopEvent()}>Lopeta tapahtuma</button></div><div className="course-list"><strong>Radat</strong>{activeEvent.courses.length ? activeEvent.courses.map((course) => <span key={course.id}>{course.name} · {(course.lengthMeters / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} km</span>) : <span>Ei julkaistuja ratoja</span>}</div></> : <div className="event-start"><div><span className="eyebrow">Valitse tapahtuma</span></div>{calendarLoading ? <p>Haetaan tapahtumia…</p> : calendarError ? <div><p className="error">{calendarError}</p><button onClick={() => void loadCalendar()}>Yritä uudelleen</button></div> : <><select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}><option value="">Valitse tapahtuma</option>{events.map((event) => <option key={event.id} value={event.id}>{new Date(event.startsAt).toLocaleDateString("fi-FI")} · {event.name}</option>)}</select><button className="primary" onClick={() => void startEvent()} disabled={!selectedEventId}>Valitse tapahtuma</button></>}</div>}
        {status && <p className="status">{status}</p>}
        <button className="settings-toggle" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}>{settingsOpen ? "⚙ Sulje" : "⚙ Asetukset"}</button>
        {settingsOpen && <div className="reader-settings"><select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={reading}><option value="">Valitse sarjaportti</option>{devices.map((device) => <option key={device.portName} value={device.portName}>{device.portName} – {device.product || device.manufacturer || device.portType}</option>)}</select><input className="port-input" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={reading} placeholder="Sarjaportin polku" aria-label="Sarjaportin polku" /><button onClick={() => void refresh()} disabled={reading}>Päivitä portit</button><div className="api-key-row"><input type={apiKeyVisible ? "text" : "password"} className="api-key-input" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="Lukijan API-avain" aria-label="Lukijan API-avain" autoComplete="off" /><button type="button" onClick={() => setApiKeyVisible((value) => !value)}>{apiKeyVisible ? "Piilota" : "Näytä"}</button><button onClick={() => void saveApiKey()} disabled={!apiKeyInput.trim() || apiKeyInput.trim() === apiKey}>{apiKeySaved ? "Tallennettu ✓" : "Tallenna avain"}</button></div></div>}
      </section>

      {result && (
        <section>
          <h2>Lukutulos</h2>
          <dl>
            <dt>Portti</dt><dd>{result.portName}</dd>
            <dt>Tavuja</dt><dd>{result.bytesReceived}</dd>
            <dt>Mahdollinen EMIT-kehys</dt><dd>{result.frameFound ? "Kyllä" : "Ei"}</dd>
            <dt>Kortin numero</dt><dd>{result.cardNumber ?? "–"}</dd>
            <dt>Rastileimoja</dt><dd>{result.punches.length}</dd>
          </dl>
          {result.punches.length > 0 && <p>Rastit: {result.punches.map((punch) => `${punch.controlCode} (${punch.timeSeconds} s)`).join(" → ")}</p>}
          <details><summary>Raakadata</summary><pre>{result.rawHex || "Ei dataa"}</pre></details>
        </section>
      )}

      <section>
        <div className="log-heading"><div><h2>Tulokset</h2><p>{history.length} viimeisintä tulosta</p></div><div className="log-heading-actions"><label className="log-search"><span className="sr-only">Hae tuloksista</span><input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Hae nimellä, seuralla tai kortilla…" /></label><button onClick={openManualEntry} disabled={!activeEvent}>+ Lisää kilpailija ilman aikaa</button></div></div>
        {history.length === 0 ? <p>Ei tallennettuja tuloksia.</p> : filteredHistory.length === 0 ? <p className="log-empty">Haulla ei löytynyt tuloksia.</p> : <><div className="log-result-count">Näytetään {filteredHistory.length} / {history.length}</div><div className="log-table-wrap"><table className="log-table"><thead><tr><th>Lukuhetki</th><th>Nimi</th><th>Seura</th><th>Kortti</th><th>Tulos</th><th>Aika</th></tr></thead><tbody>{filteredHistory.map((item) => <tr key={item.id}><td><time>{new Date(item.readAtMs).toLocaleString("fi-FI")}</time></td><td><button className="log-name" onClick={() => void openHistoryRead(item)}>{item.participantName}</button></td><td className="log-club">{item.club || "–"}</td><td className="card-number">{item.source === "MANUAL" ? "–" : item.cardNumber ?? "–"}</td><td><span className={`log-status ${item.resultStatus.toLowerCase()}`} title={item.syncStatus === "SYNCED" ? "Synkronoitu API:in" : item.syncError || "Odottaa synkronointia"}>{item.resultStatus === "OK" ? <><span aria-hidden="true">✓</span><span className="sr-only">OK</span></> : resultStatusLabel(item.resultStatus)} {item.syncStatus === "SYNCED" ? "☁" : "↻"}</span></td><td className="log-time">{item.resultStatus === "NO_TIME" ? "–" : formatDuration(totalTime(item.punches))}</td></tr>)}</tbody></table></div></>}
      </section>

      {pendingCard && (
        <div className="modal-backdrop" role="presentation">
          <section className={`modal ${pendingParticipant ? "result-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="participant-title">
            <h2 id="participant-title">{editingReadId != null ? "Muokkaa lukutulosta" : pendingParticipant ? "Kuittaa lukutulos" : "Uusi osallistuja"}</h2>
            {pendingParticipant ? <div className="result-confirm"><aside className={`result-person ${cardValidation?.status === "DISQUALIFIED" || cardValidation?.status === "MISSING_CONTROL" ? "disqualified" : ""}`}><span className="eyebrow">Osallistuja</span><h3>{pendingParticipant.firstName} {pendingParticipant.lastName}</h3><p>{pendingParticipant.club || "Ei seuraa"}</p>{cardValidation && <div className={`validation-badge ${cardValidation.status.toLowerCase()}`}>{cardValidation.status === "ACCEPTED" ? `Hyväksytty · ${cardValidation.courseName}` : cardValidation.status === "MISSING_CONTROL" ? `Rasti puuttuu · rata ${cardValidation.courseName}` : cardValidation.status === "DISQUALIFIED" ? `Hylätty · ei vastaa rataa ${cardValidation.courseName}` : "Ratadata puuttuu · käynnistä tapahtuma uudelleen"}</div>}<dl><dt>EMIT-kortti</dt><dd>{pendingCard.cardNumber}</dd><dt>Rasteja</dt><dd>{pendingCard.punches.length}</dd><dt>Tulos</dt><dd className="result-time">{cardValidation?.status === "DISQUALIFIED" ? "Hylätty" : cardValidation?.status === "MISSING_CONTROL" ? "Rasti puuttuu" : formatDuration(totalTime(pendingCard.punches))}</dd></dl></aside><div className="punch-panel"><table className="punch-table"><thead><tr><th>Rasti</th><th>Koodi</th><th>Väliaika</th><th>Lähdöstä</th><th>Huomio</th></tr></thead><tbody>{pendingCard.punches.map((punch, index) => { const elapsed = totalTime(pendingCard.punches.slice(0, index + 1)); const invalid = cardValidation?.invalidIndices.includes(index); return <tr className={invalid ? "invalid-punch" : ""} key={`${index}-${punch.controlCode}`}><td>{index + 1}</td><td>{punch.controlCode}</td><td>{formatDuration(punch.timeSeconds)}</td><td>{formatDuration(elapsed)}</td><td>{invalid ? `Odotettu ${cardValidation?.expectedCodes[index] ?? "–"}` : ""}</td></tr>; })}</tbody></table></div>{formError && <p className="error result-error">{formError}</p>}<div className="confirm-actions">{cardValidation?.status === "DISQUALIFIED" ? <button className="danger" onClick={() => void confirmResult("DISQUALIFIED")}>Kuittaa hylätty</button> : cardValidation?.status === "MISSING_CONTROL" ? <button className="danger" onClick={() => void confirmResult("MISSING_CONTROL")}>Kuittaa: rasti puuttuu</button> : <button className="primary" onClick={() => void confirmResult("OK")}>Tulos OK</button>}<button onClick={() => void confirmResult("NO_TIME")}>Ilman aikaa</button></div></div> : <><p>EMIT-korttia <strong>{pendingCard.cardNumber}</strong> ei löydy tietokannasta.</p><form onSubmit={(event) => void saveParticipant(event)}>
              <label>Etunimi<input autoFocus required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
              <label>Sukunimi<input required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
              <label>Seura<input value={club} onChange={(event) => setClub(event.target.value)} /></label>
              {formError && <p className="error">{formError}</p>}
              <button className="primary" type="submit">Tallenna osallistuja</button>
            </form></>}
          </section>
        </div>
      )}

      {manualEntryOpen && activeEvent && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-title">
            <h2 id="manual-title">Lisää kilpailija ilman aikaa</h2>
            <form onSubmit={(event) => void saveManualResult(event)}>
              <div className="manual-search-field">
                <label>Hae henkilöä<input autoFocus type="search" value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="Kirjoita vähintään 3 merkkiä…" autoComplete="off" /></label>
                {manualSuggestions.length > 0 && (
                  <ul className="manual-suggestions">
                    {manualSuggestions.map((person) => (
                      <li key={person.id}>
                        <button type="button" onClick={() => pickManualSuggestion(person)}>
                          {person.firstName} {person.lastName}{person.club ? ` · ${person.club}` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label>Etunimi<input required value={manualFirstName} onChange={(event) => editManualName(setManualFirstName, event.target.value)} autoComplete="off" /></label>
              <label>Sukunimi<input required value={manualLastName} onChange={(event) => editManualName(setManualLastName, event.target.value)} autoComplete="off" /></label>
              <label>Seura<input value={manualClub} onChange={(event) => setManualClub(event.target.value)} disabled={manualPersonId != null} /></label>
              <label>Rata<select required value={manualCourseId} onChange={(event) => setManualCourseId(event.target.value)}><option value="">Valitse rata</option>{activeEvent.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
              {manualError && <p className="error">{manualError}</p>}
              <div className="confirm-actions">
                <button className="primary" type="submit">Tallenna ilman aikaa</button>
                <button type="button" onClick={closeManualEntry}>Peruuta</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

// Tauri event listeners are asynchronous; StrictMode's development-only
// double effect invocation can leave the first listener set in a race.
createRoot(document.getElementById("root")!).render(<App />);

function formatDuration(seconds?: number) {
  if (seconds == null) return "–";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function totalTime(punches: ProbeResult["punches"]) {
  return punches.reduce((total, punch) => total + punch.timeSeconds, 0);
}

function nearestEventToNow(events: CalendarEvent[], now = Date.now()) {
  return events.reduce<CalendarEvent | undefined>((nearest, event) => {
    if (!nearest) return event;
    return distanceFromEvent(event, now) < distanceFromEvent(nearest, now) ? event : nearest;
  }, undefined);
}

function distanceFromEvent(event: CalendarEvent, now: number) {
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt).getTime();
  if (now >= startsAt && now <= endsAt) return 0;
  return Math.min(Math.abs(now - startsAt), Math.abs(now - endsAt));
}

function resultStatusLabel(status: StoredCardRead["resultStatus"]) {
  if (status === "DISQUALIFIED") return "Hylätty";
  if (status === "MISSING_CONTROL") return "Rasti puuttuu";
  if (status === "NO_TIME") return "Ilman aikaa";
  return "OK";
}

function validateCourse(punches: ProbeResult["punches"], courses: Course[]) {
  const candidates = courses
    .filter((course) => course.controls?.length)
    .map((course) => ({
      course,
      codes: course.controls!
        .filter((item) => item.type !== "START" && item.type !== "FINISH")
        .map((item) => Number(item.controlCodes[0] || item.control.code))
        .filter(Number.isFinite),
    }));
  if (candidates.length === 0) return { status: "UNAVAILABLE" as const, courseId: undefined, courseName: "–", expectedCodes: [] as number[], invalidIndices: [] as number[] };
  const actual = punches.map((punch) => punch.controlCode);
  const exact = candidates.find(({ codes }) => codes.length === actual.length && codes.every((code, index) => code === actual[index]));
  if (exact) return { status: "ACCEPTED" as const, courseId: exact.course.id, courseName: exact.course.name, expectedCodes: exact.codes, invalidIndices: [] as number[] };
  const missing = candidates.find(({ codes }) => actual.length < codes.length && isSubsequence(actual, codes));
  if (missing) return { status: "MISSING_CONTROL" as const, courseId: missing.course.id, courseName: missing.course.name, expectedCodes: missing.codes, invalidIndices: [] as number[] };
  const closest = candidates.reduce((best, candidate) => {
    const matches = candidate.codes.filter((code, index) => actual[index] === code).length;
    return matches > best.matches ? { course: candidate.course, matches } : best;
  }, { course: candidates[0].course, matches: -1 });
  const expectedCodes = candidates.find((candidate) => candidate.course.id === closest.course.id)?.codes ?? [];
  const invalidIndices = actual.flatMap((code, index) => code === expectedCodes[index] ? [] : [index]);
  return { status: "DISQUALIFIED" as const, courseId: closest.course.id, courseName: closest.course.name, expectedCodes, invalidIndices };
}

function isSubsequence(actual: number[], expected: number[]) {
  let actualIndex = 0;
  for (const code of expected) {
    if (actual[actualIndex] === code) actualIndex += 1;
  }
  return actualIndex === actual.length;
}
