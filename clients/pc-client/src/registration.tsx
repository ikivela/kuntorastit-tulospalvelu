import React, { useEffect, useState } from "react";

// Registration mode (paperless registration at the event) and the reader
// mode's big result screen. The App in main.tsx owns the card reader, the
// local database and the sync queue; these components only show and collect.

export type RegistrationCourse = { id: string; name: string; lengthMeters: number };
export type Registration = {
  eventId: string;
  participantId: number;
  cardNumber?: number | null;
  firstName: string;
  lastName: string;
  club?: string | null;
  courseId?: string | null;
  paymentMethod?: string | null;
  registeredAtMs: number;
  syncStatus: "PENDING" | "SYNCED" | "ERROR";
  syncError?: string | null;
  syncRevision: number;
};
export type RegistrationDraft = { cardNumber: number | null; firstName: string; lastName: string; club: string; courseId: string; paymentMethod: string };
export type PersonSuggestion = { key: string; firstName: string; lastName: string; club?: string | null; cardNumber?: number | null };

/** Registration form: from a card read (card number shown, name filled in
 * when the card is known) or without a card (search a known person or type
 * the name). The course and payment method are always asked. */
export function RegistrationForm({ draft, courses, paymentMethods, alreadyRegistered, search, onSave, onCancel }: {
  draft: RegistrationDraft;
  courses: RegistrationCourse[];
  paymentMethods: string[];
  alreadyRegistered?: Registration | null;
  search: (query: string) => Promise<PersonSuggestion[]>;
  onSave: (draft: RegistrationDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(draft);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (field: keyof RegistrationDraft, value: string) => setValues((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) { setSuggestions([]); return; }
    let disposed = false;
    const timeout = window.setTimeout(() => {
      search(trimmed).then((found) => { if (!disposed) setSuggestions(found); }).catch(() => { if (!disposed) setSuggestions([]); });
    }, 250);
    return () => { disposed = true; window.clearTimeout(timeout); };
  }, [query, search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!values.courseId) { setError("Valitse rata."); return; }
    if (!values.paymentMethod) { setError("Valitse maksutapa."); return; }
    setSaving(true); setError("");
    try { await onSave(values); } catch (cause) { setError(String(cause)); } finally { setSaving(false); }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="modal registration-modal" role="dialog" aria-modal="true" aria-labelledby="registration-title">
      <div className="modal-header"><h2 id="registration-title">Ilmoittautuminen</h2><button type="button" className="modal-close" onClick={onCancel} aria-label="Peruuta" title="Peruuta (Esc)">×</button></div>
      {values.cardNumber != null
        ? <p className="registration-card">EMIT-kortti <b>{values.cardNumber}</b>{draft.firstName ? " · tunnettu kortti, tarkista tiedot" : " · uusi kortti, täytä tiedot"}</p>
        : <p className="hint">Ilmoittautuminen ilman korttia: hae henkilö tai kirjoita nimi.</p>}
      {alreadyRegistered && <p className="registration-note">Jo ilmoittautunut tähän tapahtumaan ({courses.find((course) => course.id === alreadyRegistered.courseId)?.name ?? "rata –"}, {alreadyRegistered.paymentMethod ?? "–"}). Tallennus päivittää ilmoittautumisen.</p>}
      <form onSubmit={(event) => void submit(event)}>
        {values.cardNumber == null && <div className="manual-search-field">
          <label>Hae henkilöä<input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kirjoita vähintään 3 merkkiä…" autoComplete="off" /></label>
          {suggestions.length > 0 && <ul className="manual-suggestions">{suggestions.map((person) => <li key={person.key}><button type="button" onClick={() => { setValues((current) => ({ ...current, firstName: person.firstName, lastName: person.lastName, club: person.club ?? "" })); setQuery(""); setSuggestions([]); }}>{person.firstName} {person.lastName}{person.club ? ` · ${person.club}` : ""}</button></li>)}</ul>}
        </div>}
        <div className="form-row">
          <label>Etunimi<input required autoFocus={values.cardNumber != null && !draft.firstName} value={values.firstName} onChange={(event) => set("firstName", event.target.value)} autoComplete="off" /></label>
          <label>Sukunimi<input required value={values.lastName} onChange={(event) => set("lastName", event.target.value)} autoComplete="off" /></label>
        </div>
        <label>Seura<input value={values.club} onChange={(event) => set("club", event.target.value)} placeholder="Ei seuraa" autoComplete="off" /></label>
        <fieldset className="choice-group"><legend>Rata</legend><div className="choices">{courses.map((course) => <button key={course.id} type="button" aria-pressed={values.courseId === course.id} className={values.courseId === course.id ? "choice selected" : "choice"} onClick={() => set("courseId", course.id)}><b>{course.name}</b><span>{(course.lengthMeters / 1000).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} km</span></button>)}</div></fieldset>
        <fieldset className="choice-group"><legend>Maksutapa</legend><div className="choices">{paymentMethods.map((method) => <button key={method} type="button" aria-pressed={values.paymentMethod === method} className={values.paymentMethod === method ? "choice selected" : "choice"} onClick={() => set("paymentMethod", method)}><b>{method}</b></button>)}</div></fieldset>
        {error && <p className="error">{error}</p>}
        <div className="confirm-actions"><button className="primary" type="submit" disabled={saving}>{saving ? "Tallennetaan…" : alreadyRegistered ? "Päivitä ilmoittautuminen" : "Ilmoittaudu"}</button><button type="button" onClick={onCancel}>Peruuta</button></div>
      </form>
    </section>
  </div>;
}

/** The event's registrations made on this machine, newest first. */
export function RegistrationList({ registrations, courses, query }: { registrations: Registration[]; courses: RegistrationCourse[]; query: string }) {
  const needle = query.trim().toLocaleLowerCase("fi-FI");
  const shown = needle ? registrations.filter((item) => [`${item.firstName} ${item.lastName}`, item.club ?? "", String(item.cardNumber ?? "")].some((value) => value.toLocaleLowerCase("fi-FI").includes(needle))) : registrations;
  if (registrations.length === 0) return <div className="log-empty"><b>Ei vielä ilmoittautuneita</b><span>Lue EMIT-kortti lukijalla tai ilmoittaudu ilman korttia.</span></div>;
  if (shown.length === 0) return <p className="log-empty">Haulla ei löytynyt ilmoittautuneita.</p>;
  return <div className="log-table-wrap"><table className="log-table"><thead><tr><th>Aika</th><th>Nimi</th><th>Seura</th><th>Rata</th><th>Maksutapa</th><th>Kortti</th><th><span className="sr-only">Lähetys</span></th></tr></thead><tbody>
    {shown.map((item) => <tr key={`${item.eventId}-${item.participantId}`}>
      <td className="log-read-at"><time>{new Date(item.registeredAtMs).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" })}</time></td>
      <td><b>{item.firstName} {item.lastName}</b></td>
      <td className="log-club">{item.club || "–"}</td>
      <td className="log-course">{courses.find((course) => course.id === item.courseId)?.name ?? "–"}</td>
      <td>{item.paymentMethod ?? "–"}</td>
      <td className="log-club">{item.cardNumber ?? "–"}</td>
      <td className={`log-sync ${item.syncStatus === "SYNCED" ? "synced" : item.syncStatus === "ERROR" ? "error" : "pending"}`} title={item.syncStatus === "SYNCED" ? "Lähetetty palvelimelle" : item.syncError || "Odottaa lähetystä"}>{item.syncStatus === "SYNCED" ? "✓" : item.syncStatus === "ERROR" ? "!" : "…"}</td>
    </tr>)}
  </tbody></table></div>;
}

/** A short-lived full-screen confirmation, readable from a distance: the
 * reader mode's accepted result, or a completed registration. Closes on a
 * click, after `seconds`, or when the next card comes. */
export function BigScreen({ tone, eyebrow, title, value, detail, seconds = 8, onClose }: { tone: "ok" | "info"; eyebrow: string; title: string; value: string; detail: string; seconds?: number; onClose: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, seconds * 1000);
    return () => window.clearTimeout(timeout);
  }, [onClose, seconds]);
  return <div className={`big-screen ${tone}`} role="status" aria-live="polite" onClick={onClose}>
    <div className="big-screen-content">
      <span className="big-screen-eyebrow">{eyebrow}</span>
      <h1 className="big-screen-title">{title}</h1>
      <p className="big-screen-value">{value}</p>
      <p className="big-screen-detail">{detail}</p>
    </div>
  </div>;
}
