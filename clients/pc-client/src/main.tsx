import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import "./style.css";

declare const __BUILD_DATE__: string;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api/v1";
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
  manualDurationSeconds?: number;
};
type Participant = { id: number; cardNumber: number; firstName: string; lastName: string; club?: string; apiPersonId?: string };
type CourseControl = { sequenceNumber: number; type: string; controlCodes: string[]; control: { code: string } };
type Course = { id: string; name: string; lengthMeters: number; climbMeters?: number; controls?: CourseControl[] };
type CalendarEvent = { id: string; name: string; locationName?: string; startsAt: string; endsAt: string; status: string; courses: Course[] };
type CalendarSeason = { id: string; name: string; events: CalendarEvent[] };

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
  const [personDbOpen, setPersonDbOpen] = useState(false);
  const [deviceToken, setDeviceToken] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [deviceNameInput, setDeviceNameInput] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<"unregistered" | "pending" | "approved" | "revoked">("unregistered");
  const [deviceError, setDeviceError] = useState("");
  const [editingReadId, setEditingReadId] = useState<number | null>(null);
  const [editingSource, setEditingSource] = useState<"EMIT" | "MANUAL" | null>(null);
  const [editingManualDurationSeconds, setEditingManualDurationSeconds] = useState<number | undefined>(undefined);
  const [resumeAfterEdit, setResumeAfterEdit] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualClub, setManualClub] = useState("");
  const [manualCourseId, setManualCourseId] = useState("");
  const [manualDuration, setManualDuration] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualPersonId, setManualPersonId] = useState<string | null>(null);
  const [manualSuggestions, setManualSuggestions] = useState<Participant[]>([]);
  const [personDb, setPersonDb] = useState<Participant[]>([]);
  const [personDbLoading, setPersonDbLoading] = useState(false);
  const [personDbError, setPersonDbError] = useState("");
  const [personDbQuery, setPersonDbQuery] = useState("");
  const [editingParticipantId, setEditingParticipantId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ firstName: string; lastName: string; club: string; cardNumber: string } | null>(null);
  const [savingPersonEdit, setSavingPersonEdit] = useState(false);
  const [personDbBusy, setPersonDbBusy] = useState(false);
  const [personDbStatus, setPersonDbStatus] = useState("");
  const personDbFileInputRef = useRef<HTMLInputElement | null>(null);

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
    if (await startListening()) {
      await refreshHistory(event.id);
    } else {
      setActiveEvent(null);
    }
  }

  function authHeaders(extra?: Record<string, string>) {
    return deviceToken ? { ...extra, authorization: `Bearer ${deviceToken}` } : extra ?? {};
  }

  async function checkDeviceStatus() {
    try {
      const id = await installationId();
      const response = await fetch(`${API_BASE}/public/reader-devices/${id}/status`, { cache: "no-store" });
      if (response.status === 404) { setDeviceStatus("unregistered"); return; }
      if (!response.ok) return;
      const data = await response.json() as { status: "PENDING" | "APPROVED" | "REVOKED"; token?: string };
      if (data.status === "APPROVED") {
        if (data.token) await invoke("set_setting_value", { key: "reader.device_token", value: data.token });
        setDeviceToken((current) => data.token || current);
        setDeviceStatus("approved");
      } else if (data.status === "REVOKED") {
        await invoke("clear_setting_value", { key: "reader.device_token" }).catch(() => undefined);
        setDeviceToken("");
        setDeviceStatus("revoked");
      } else {
        setDeviceStatus("pending");
      }
    } catch {
      // offline: keep whatever we last knew locally
    }
  }

  async function registerDevice() {
    const name = deviceNameInput.trim();
    if (!name) return;
    setDeviceError("");
    try {
      const id = await installationId();
      const response = await fetch(`${API_BASE}/public/reader-devices/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId: id, name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await invoke("set_setting_value", { key: "reader.device_name", value: name });
      setDeviceName(name);
      setDeviceStatus("pending");
      void checkDeviceStatus();
    } catch (error) {
      setDeviceError(String(error));
    }
  }

  async function forgetDevice() {
    await invoke("clear_setting_value", { key: "reader.device_token" }).catch(() => undefined);
    await invoke("clear_setting_value", { key: "reader.device_name" }).catch(() => undefined);
    setDeviceToken(""); setDeviceName(""); setDeviceNameInput(""); setDeviceError("");
    setDeviceStatus("unregistered");
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
              clientReference: `${clientId}:${read.id}`,
              courseId: read.courseId,
              personId: read.personId || undefined,
              firstName: read.firstName,
              lastName: read.lastName,
              clubName: read.club || undefined,
              durationSeconds: read.manualDurationSeconds,
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
        if (response.status === 401) throw new Error("Lukijaa ei ole hyväksytty tai pääsy on peruutettu. Tarkista Asetukset-paneelista.");
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
    let durationSeconds: number | null = null;
    if (manualDuration.trim()) {
      durationSeconds = parseDurationInput(manualDuration);
      if (durationSeconds == null) { setManualError("Anna aika muodossa mm:ss tai h:mm:ss, esim. 38:42."); return; }
    }
    try {
      await invoke("add_manual_result", {
        eventId: activeEvent.id,
        courseId: manualCourseId || null,
        firstName: manualFirstName,
        lastName: manualLastName,
        club: manualClub || null,
        personId: manualPersonId,
        durationSeconds,
      });
      const name = `${manualFirstName} ${manualLastName}`;
      closeManualEntry();
      await refreshHistory();
      setStatus(durationSeconds != null ? `${name}: tulos ${formatDuration(durationSeconds)} tallennettu.` : `${name} lisätty tuloksiin ilman aikaa.`);
    } catch (error) {
      setManualError(String(error));
    }
  }

  function closeManualEntry() {
    setManualEntryOpen(false);
    setManualQuery(""); setManualFirstName(""); setManualLastName(""); setManualClub(""); setManualCourseId(""); setManualDuration("");
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
    if (!pendingParticipant.firstName.trim() || !pendingParticipant.lastName.trim()) {
      setFormError("Etunimi ja sukunimi ovat pakollisia.");
      return;
    }
    try {
      await invoke("update_participant_details", {
        participantId: pendingParticipant.id,
        firstName: pendingParticipant.firstName,
        lastName: pendingParticipant.lastName,
        club: pendingParticipant.club || null,
      });
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
      setEditingReadId(null); setEditingSource(null); setEditingManualDurationSeconds(undefined); setResumeAfterEdit(false);
      await refreshHistory();
      setStatus(`${name}: ${resultStatus === "OK" ? "OK" : resultStatus === "DISQUALIFIED" ? "hylätty" : resultStatus === "MISSING_CONTROL" ? "rasti puuttuu" : "ilman aikaa"}.`);
      if (shouldResume && activeEvent) await startListening();
    } catch (error) {
      setFormError(String(error));
    }
  }

  /// Dismisses an unrecognised card read without registering anyone — e.g. a
  /// stray/foreign card, or a misread. Only offered for unknown cards; a
  /// matched card already has "Tulos OK"/"Ilman aikaa" as its way out.
  async function skipPendingCard() {
    const shouldResume = editingReadId == null ? Boolean(activeEvent) : resumeAfterEdit;
    const cardNumber = pendingCard?.cardNumber;
    setPendingCard(null); setPendingParticipant(null); setResult(null);
    setPendingEventId(null);
    setEditingReadId(null); setEditingSource(null); setEditingManualDurationSeconds(undefined); setResumeAfterEdit(false);
    setFirstName(""); setLastName(""); setClub(""); setFormError("");
    setStatus(cardNumber ? `Kortti ${cardNumber} ohitettu.` : "Ohitettu.");
    if (shouldResume && activeEvent) await startListening();
  }

  async function openHistoryRead(item: StoredCardRead) {
    const wasReading = reading;
    if (wasReading) await invoke("stop_emit250");
    setReading(false);
    setResumeAfterEdit(wasReading);
    setEditingReadId(item.id);
    setEditingSource(item.source);
    setEditingManualDurationSeconds(item.manualDurationSeconds);
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
    void (async () => {
      const [token, name] = await Promise.all([
        invoke<string | null>("setting_value", { key: "reader.device_token" }).catch(() => null),
        invoke<string | null>("setting_value", { key: "reader.device_name" }).catch(() => null),
      ]);
      if (token) { setDeviceToken(token); setDeviceStatus("approved"); }
      else if (name) { setDeviceStatus("pending"); }
      if (name) { setDeviceName(name); setDeviceNameInput(name); }
      void checkDeviceStatus();
    })();
  }, []);

  useEffect(() => {
    if (deviceStatus === "unregistered") return;
    const interval = window.setInterval(() => void checkDeviceStatus(), 2 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [deviceStatus]);

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
    if (!personDbOpen) return;
    let disposed = false;
    setPersonDbLoading(true); setPersonDbError(""); setPersonDbStatus("");
    invoke<Participant[]>("list_participants")
      .then((items) => { if (!disposed) setPersonDb(items); })
      .catch((error) => { if (!disposed) setPersonDbError(String(error)); })
      .finally(() => { if (!disposed) setPersonDbLoading(false); });
    return () => { disposed = true; };
  }, [personDbOpen]);

  const filteredPersonDb = useMemo(() => {
    const query = personDbQuery.trim().toLocaleLowerCase("fi-FI");
    if (!query) return personDb;
    const words = query.split(/\s+/);
    return personDb.filter((person) => {
      const first = person.firstName.toLocaleLowerCase("fi-FI");
      const last = person.lastName.toLocaleLowerCase("fi-FI");
      const club = (person.club ?? "").toLocaleLowerCase("fi-FI");
      return words.every((word) => first.includes(word) || last.includes(word) || club.includes(word) || String(person.cardNumber).includes(word));
    });
  }, [personDb, personDbQuery]);

  async function importPersonDbFile(file: File) {
    setPersonDbBusy(true); setPersonDbError(""); setPersonDbStatus("");
    try {
      const rows = parsePersonCsv(await file.text());
      const summary = await invoke<{ imported: number; skipped: number }>("import_participants", { rows });
      const items = await invoke<Participant[]>("list_participants");
      setPersonDb(items);
      setPersonDbStatus(`Tuotu ${summary.imported} henkilöä${summary.skipped ? `, ohitettu ${summary.skipped} virheellistä riviä` : ""}.`);
    } catch (error) {
      setPersonDbError(error instanceof Error ? error.message : String(error));
    } finally {
      setPersonDbBusy(false);
    }
  }

  function handlePersonDbFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importPersonDbFile(file);
  }

  async function exportPersonDb() {
    setPersonDbBusy(true); setPersonDbError(""); setPersonDbStatus("");
    try {
      const path = await save({
        defaultPath: `henkilodb-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      const count = await invoke<number>("export_participants_csv", { path });
      setPersonDbStatus(`Vietiin ${count} henkilöä tiedostoon ${path}.`);
    } catch (error) {
      setPersonDbError(error instanceof Error ? error.message : String(error));
    } finally {
      setPersonDbBusy(false);
    }
  }

  function startPersonEdit(person: Participant) {
    setPersonDbError("");
    setEditingParticipantId(person.id);
    setEditDraft({ firstName: person.firstName, lastName: person.lastName, club: person.club ?? "", cardNumber: String(person.cardNumber) });
  }

  function cancelPersonEdit() {
    setEditingParticipantId(null);
    setEditDraft(null);
  }

  async function savePersonEdit() {
    if (editingParticipantId == null || !editDraft) return;
    const firstName = editDraft.firstName.trim();
    const lastName = editDraft.lastName.trim();
    const cardNumber = Number(editDraft.cardNumber);
    if (!firstName || !lastName) { setPersonDbError("Etunimi ja sukunimi ovat pakollisia."); return; }
    if (!Number.isInteger(cardNumber) || cardNumber <= 0) { setPersonDbError("Anna kelvollinen kortin numero."); return; }
    setSavingPersonEdit(true); setPersonDbError("");
    try {
      await invoke("update_participant", { participantId: editingParticipantId, cardNumber, firstName, lastName, club: editDraft.club.trim() || null });
      setPersonDb((current) => current.map((person) => person.id === editingParticipantId ? { ...person, firstName, lastName, club: editDraft.club.trim() || undefined, cardNumber } : person));
      cancelPersonEdit();
    } catch (error) {
      setPersonDbError(String(error));
    } finally {
      setSavingPersonEdit(false);
    }
  }

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
            // Global lookup, not participant_by_card_for_event: registrations no
            // longer sync from the API (events can be attended "omatoimi" without
            // one), so most known people have no local event_registrations row —
            // an event-scoped lookup would call everyone "unknown".
            const participant = await invoke<Participant | null>("participant_by_card", { cardNumber: latest.cardNumber });
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

  // Manual entries have no EMIT punches to validate against a course, so
  // skip course validation for them — otherwise the empty punch list reads
  // as "missing control" against an arbitrary course and shows the wrong
  // confirm button.
  const cardValidation = pendingCard && activeEvent && editingSource !== "MANUAL" ? validateCourse(pendingCard.punches, activeEvent.courses) : null;
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
      <h4>Kuntorastit client</h4>
      <p className="build-version">Build: {new Date(__BUILD_DATE__).toLocaleString("fi-FI")}</p>

      <section>
        {activeEvent ? <><div className="event-running"><div><span className="eyebrow">Tapahtuma käynnissä</span><h2>{activeEvent.name}</h2><p>{new Date(activeEvent.startsAt).toLocaleString("fi-FI")} · {activeEvent.locationName || "Paikka ei tiedossa"}</p></div><div className={`reader-badge ${reading ? "ok" : "error"}`}><span />{pendingCard ? "Kuittaus odottaa" : reading ? "Lukija OK" : "Lukija ei yhteydessä"}</div><button onClick={() => void stopEvent()}>Lopeta tapahtuma</button><button type="button" className="settings-toggle" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">⚙ Asetukset</button><button type="button" className="settings-toggle" onClick={() => setPersonDbOpen(true)} aria-haspopup="dialog">👥 HenkilöDB</button></div><div className="course-list"><strong>Radat</strong>{activeEvent.courses.length ? activeEvent.courses.map((course) => <span key={course.id}>{course.name} · {(course.lengthMeters / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} km</span>) : <span>Ei julkaistuja ratoja</span>}</div></> : <div className="event-start">{calendarLoading ? <p>Haetaan tapahtumia…</p> : calendarError ? <div><p className="error">{calendarError}</p><button onClick={() => void loadCalendar()}>Yritä uudelleen</button></div> : <><label className="event-select-field"><span className="eyebrow">Valitse tapahtuma</span><select value={selectedEventId} onChange={(event) => setSelectedEventId(event.target.value)}><option value="">Valitse tapahtuma</option>{events.map((event) => <option key={event.id} value={event.id}>{new Date(event.startsAt).toLocaleDateString("fi-FI")} · {event.name}</option>)}</select></label><button className="primary" onClick={() => void startEvent()} disabled={!selectedEventId}>Valitse tapahtuma</button><div className="event-start-actions"><button type="button" className="settings-toggle" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">⚙ Asetukset</button><button type="button" className="settings-toggle" onClick={() => setPersonDbOpen(true)} aria-haspopup="dialog">👥 HenkilöDB</button></div></>}</div>}
        {status && <p className="status">{status}</p>}
      </section>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <h2 id="settings-title">Asetukset</h2>
            <div className="reader-settings"><select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={reading}><option value="">Valitse sarjaportti</option>{devices.map((device) => <option key={device.portName} value={device.portName}>{device.portName} – {device.product || device.manufacturer || device.portType}</option>)}</select><input className="port-input" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={reading} placeholder="Sarjaportin polku" aria-label="Sarjaportin polku" /><button type="button" onClick={() => void refresh()} disabled={reading}>Päivitä portit</button><div className="device-row">{deviceStatus === "unregistered" || deviceStatus === "revoked" ? <>{deviceStatus === "revoked" && <p className="error">Ylläpitäjä on peruuttanut tämän laitteen pääsyn. Rekisteröidy uudelleen.</p>}<input className="device-name-input" value={deviceNameInput} onChange={(e) => setDeviceNameInput(e.target.value)} placeholder="Laitteen nimi, esim. Maalin lukija #1" aria-label="Laitteen nimi" /><button type="button" onClick={() => void registerDevice()} disabled={!deviceNameInput.trim()}>Lähetä hyväksyntäpyyntö</button></> : deviceStatus === "pending" ? <><span>Odotetaan ylläpitäjän hyväksyntää (nimellä &quot;{deviceName}&quot;)…</span><button type="button" onClick={() => void checkDeviceStatus()}>Tarkista nyt</button></> : <><span className="device-approved">✓ Hyväksytty (nimellä &quot;{deviceName}&quot;)</span><button type="button" onClick={() => void checkDeviceStatus()}>Tarkista nyt</button><button type="button" onClick={() => void forgetDevice()}>Unohda laite</button></>}{deviceError && <p className="error">{deviceError}</p>}</div></div>
            <div className="confirm-actions"><button type="button" className="primary" onClick={() => setSettingsOpen(false)}>Sulje</button></div>
          </section>
        </div>
      )}

      {personDbOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal person-db-modal" role="dialog" aria-modal="true" aria-labelledby="person-db-title">
            <h2 id="person-db-title">HenkilöDB</h2>
            <div className="person-db-toolbar">
              <p className="status">{personDbLoading ? "Ladataan…" : `${filteredPersonDb.length} / ${personDb.length} henkilöä`}</p>
              <div className="person-db-io">
                <button type="button" disabled={personDbBusy} onClick={() => personDbFileInputRef.current?.click()}>⬆ Tuo CSV</button>
                <button type="button" disabled={personDbBusy || personDb.length === 0} onClick={() => void exportPersonDb()}>⬇ Vie CSV</button>
                <input ref={personDbFileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={handlePersonDbFileChange} />
              </div>
            </div>
            <label className="log-search"><span className="sr-only">Hae henkilöä</span><input type="search" autoFocus value={personDbQuery} onChange={(event) => setPersonDbQuery(event.target.value)} placeholder="Hae nimellä, seuralla tai kortin numerolla…" /></label>
            {personDbStatus && <p className="status person-db-io-status">{personDbStatus}</p>}
            {personDbError && <p className="error">{personDbError}</p>}
            <div className="log-table-wrap"><table className="log-table"><thead><tr><th>Sukunimi</th><th>Etunimi</th><th>Seura</th><th>Kortti</th><th></th></tr></thead><tbody>{filteredPersonDb.map((person) => person.id === editingParticipantId && editDraft ? <tr key={person.id} className="editing-row"><td><input value={editDraft.lastName} onChange={(event) => { const value = event.target.value; setEditDraft((draft) => draft ? { ...draft, lastName: value } : draft); }} /></td><td><input value={editDraft.firstName} onChange={(event) => { const value = event.target.value; setEditDraft((draft) => draft ? { ...draft, firstName: value } : draft); }} /></td><td><input value={editDraft.club} onChange={(event) => { const value = event.target.value; setEditDraft((draft) => draft ? { ...draft, club: value } : draft); }} placeholder="Ei seuraa" /></td><td><input value={editDraft.cardNumber} onChange={(event) => { const value = event.target.value; setEditDraft((draft) => draft ? { ...draft, cardNumber: value } : draft); }} inputMode="numeric" pattern="[0-9]*" className="card-number-input" /></td><td className="person-db-actions"><button type="button" className="primary" disabled={savingPersonEdit} onClick={() => void savePersonEdit()}>Tallenna</button><button type="button" disabled={savingPersonEdit} onClick={cancelPersonEdit}>Peruuta</button></td></tr> : <tr key={person.id}><td title={person.lastName}>{person.lastName}</td><td title={person.firstName}>{person.firstName}</td><td className="log-club" title={person.club || undefined}>{person.club || "–"}</td><td className="log-time">{person.cardNumber}</td><td className="person-db-actions"><button type="button" onClick={() => startPersonEdit(person)}>Muokkaa</button></td></tr>)}</tbody></table></div>
            <div className="confirm-actions"><button type="button" className="primary" onClick={() => { setPersonDbOpen(false); cancelPersonEdit(); }}>Sulje</button></div>
          </section>
        </div>
      )}

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
        <div className="log-heading"><div><h2>Tulokset</h2><p>{history.length} viimeisintä tulosta</p></div><div className="log-heading-actions"><label className="log-search"><span className="sr-only">Hae tuloksista</span><input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Hae nimellä, seuralla tai kortilla…" /></label><button onClick={openManualEntry} disabled={!activeEvent}>+ Syötä osanottoja</button></div></div>
        {history.length === 0 ? <p>Ei tallennettuja tuloksia.</p> : filteredHistory.length === 0 ? <p className="log-empty">Haulla ei löytynyt tuloksia.</p> : <><div className="log-result-count">Näytetään {filteredHistory.length} / {history.length}</div><div className="log-table-wrap"><table className="log-table"><thead><tr><th>Lukuhetki</th><th>Nimi</th><th>Seura</th><th>Rata</th><th>Aika</th></tr></thead><tbody>{filteredHistory.map((item) => <tr key={item.id}><td className="log-read-at"><time>{new Date(item.readAtMs).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></td><td><button className="log-name" onClick={() => void openHistoryRead(item)}>{item.participantName}</button></td><td className="log-club">{item.club || "–"}</td><td className="log-course">{activeEvent?.courses.find((course) => course.id === item.courseId)?.name ?? "–"}</td><td className="log-time">{item.resultStatus === "NO_TIME" ? "–" : formatDuration(item.source === "MANUAL" ? item.manualDurationSeconds : totalTime(item.punches))}</td></tr>)}</tbody></table></div></>}
      </section>

      {pendingCard && (
        <div className="modal-backdrop" role="presentation">
          <section className={`modal ${pendingParticipant ? "result-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="participant-title">
            <h2 id="participant-title">{editingReadId != null ? "Muokkaa lukutulosta" : pendingParticipant ? "Kuittaa lukutulos" : "Uusi osallistuja"}</h2>
            {pendingParticipant ? <div className="result-confirm"><aside className={`result-person ${cardValidation?.status === "DISQUALIFIED" || cardValidation?.status === "MISSING_CONTROL" ? "disqualified" : ""}`}><span className="eyebrow">Osallistuja</span><div className="result-person-edit"><label>Etunimi<input value={pendingParticipant.firstName} onChange={(event) => { const value = event.target.value; setPendingParticipant((prev) => prev ? { ...prev, firstName: value } : prev); }} /></label><label>Sukunimi<input value={pendingParticipant.lastName} onChange={(event) => { const value = event.target.value; setPendingParticipant((prev) => prev ? { ...prev, lastName: value } : prev); }} /></label><label>Seura<input value={pendingParticipant.club ?? ""} onChange={(event) => { const value = event.target.value; setPendingParticipant((prev) => prev ? { ...prev, club: value } : prev); }} placeholder="Ei seuraa" /></label></div>{cardValidation &&<div className={`validation-badge ${cardValidation.status.toLowerCase()}`}>{cardValidation.status === "ACCEPTED" ? `Hyväksytty · ${cardValidation.courseName}` : cardValidation.status === "MISSING_CONTROL" ? `Rasti puuttuu · rata ${cardValidation.courseName}` : cardValidation.status === "DISQUALIFIED" ? `Hylätty · ei vastaa rataa ${cardValidation.courseName}` : "Ratadata puuttuu · käynnistä tapahtuma uudelleen"}</div>}<dl>{editingSource === "MANUAL" ? <><dt>Tulos</dt><dd className="result-time">{formatDuration(editingManualDurationSeconds)}</dd></> : <><dt>EMIT-kortti</dt><dd>{pendingCard.cardNumber}</dd><dt>Rasteja</dt><dd>{pendingCard.punches.length}</dd><dt>Tulos</dt><dd className="result-time">{cardValidation?.status === "DISQUALIFIED" ? "Hylätty" : cardValidation?.status === "MISSING_CONTROL" ? "Rasti puuttuu" : formatDuration(totalTime(pendingCard.punches))}</dd></>}</dl></aside>{editingSource !== "MANUAL" && <div className="punch-panel"><table className="punch-table"><thead><tr><th>Rasti</th><th>Koodi</th><th>Väliaika</th><th>Lähdöstä</th><th>Huomio</th></tr></thead><tbody>{pendingCard.punches.map((punch, index) => { const elapsed = totalTime(pendingCard.punches.slice(0, index + 1)); const invalid = cardValidation?.invalidIndices.includes(index); return <tr className={invalid ? "invalid-punch" : ""} key={`${index}-${punch.controlCode}`}><td>{index + 1}</td><td>{punch.controlCode}</td><td>{formatDuration(punch.timeSeconds)}</td><td>{formatDuration(elapsed)}</td><td>{invalid ? `Odotettu ${cardValidation?.expectedCodes[index] ?? "–"}` : ""}</td></tr>; })}</tbody></table></div>}{formError && <p className="error result-error">{formError}</p>}<div className="confirm-actions">{cardValidation?.status === "DISQUALIFIED" ? <button className="danger" onClick={() => void confirmResult("DISQUALIFIED")}>Kuittaa hylätty</button> : cardValidation?.status === "MISSING_CONTROL" ? <button className="danger" onClick={() => void confirmResult("MISSING_CONTROL")}>Kuittaa: rasti puuttuu</button> : <button className="primary" onClick={() => void confirmResult("OK")}>Tulos OK</button>}<button onClick={() => void confirmResult("NO_TIME")}>Ilman aikaa</button></div></div> : <><p>EMIT-korttia <strong>{pendingCard.cardNumber}</strong> ei löydy tietokannasta.</p><form onSubmit={(event) => void saveParticipant(event)}>
              <label>Etunimi<input autoFocus required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
              <label>Sukunimi<input required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
              <label>Seura<input value={club} onChange={(event) => setClub(event.target.value)} /></label>
              {formError && <p className="error">{formError}</p>}
              <div className="confirm-actions">
                <button className="primary" type="submit">Tallenna osallistuja</button>
                <button type="button" onClick={() => void skipPendingCard()}>Ohita kortti</button>
              </div>
            </form></>}
          </section>
        </div>
      )}

      {manualEntryOpen && activeEvent && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-title">
            <h2 id="manual-title">Syötä osanottoja</h2>
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
              <label>Aika (valinnainen)<input value={manualDuration} onChange={(event) => setManualDuration(event.target.value)} placeholder="esim. 38:42" autoComplete="off" /></label>
              {manualError && <p className="error">{manualError}</p>}
              <div className="confirm-actions">
                <button className="primary" type="submit">{manualDuration.trim() ? "Tallenna tulos" : "Tallenna ilman aikaa"}</button>
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

/// Parses semicolon-separated CSV text (RFC 4180 quoting supported) into rows
/// of raw string cells — used for the HenkilöDB import, which otherwise has
/// no CSV library available in this small frontend bundle.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") { field += "\""; index += 1; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ";") {
      pushField();
    } else if (char === "\r") {
      // ignored; the following \n (or end of row content) closes the row
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

type PersonImportRow = { firstName: string; lastName: string; club: string | null; cardNumber: number };

/// Maps the import CSV by its header names (Sukunimi/Etunimi/Seura/Kortti, in
/// any order) rather than fixed column positions, so both this app's own
/// export and hand-built spreadsheets import correctly.
function parsePersonCsv(text: string): PersonImportRow[] {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = parseCsvRows(withoutBom);
  if (rows.length === 0) throw new Error("Tiedosto on tyhjä.");
  const header = rows[0].map((cell) => cell.trim().toLocaleUpperCase("fi-FI"));
  const lastNameIndex = header.indexOf("SUKUNIMI");
  const firstNameIndex = header.indexOf("ETUNIMI");
  const clubIndex = header.indexOf("SEURA");
  const cardIndex = header.indexOf("KORTTI");
  if (lastNameIndex === -1 || firstNameIndex === -1 || cardIndex === -1) {
    throw new Error("CSV-tiedostosta puuttuu vaadittu sarake (Sukunimi, Etunimi tai Kortti).");
  }
  return rows.slice(1).map((row) => {
    const cardNumber = Number.parseInt((row[cardIndex] ?? "").trim(), 10);
    return {
      lastName: (row[lastNameIndex] ?? "").trim(),
      firstName: (row[firstNameIndex] ?? "").trim(),
      club: clubIndex === -1 ? null : (row[clubIndex] ?? "").trim() || null,
      cardNumber: Number.isFinite(cardNumber) && cardNumber > 0 ? cardNumber : 0,
    };
  });
}

function formatDuration(seconds?: number) {
  if (seconds == null) return "–";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parseDurationInput(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  const seconds = numbers.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1];
  return seconds > 0 ? seconds : null;
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
      // START is never an actual EMIT punch. FINISH usually isn't either
      // (a symbolic code like "M"/"F" for a plain download-station finish),
      // but when a course does have a real numbered finish punch unit (e.g.
      // "100"), Number.isFinite below keeps it in the expected sequence so
      // that trailing punch is matched instead of flagged as unexpected.
      codes: course.controls!
        .filter((item) => item.type !== "START")
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
