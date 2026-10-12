"use client";

import { FormEvent, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DURATION_FORMAT_HINT, formatSeconds, parseDuration } from "@/lib/duration";
import { type CourseForValidation, type EmitPunch, splitSeconds, validateAgainstCourse } from "@/lib/emit250";
import { API_BASE } from "@/lib/site";

export type AdminResult = {
  id: string;
  firstName: string;
  lastName: string;
  clubName: string | null;
  courseId: string;
  courseName: string;
  status: "PENDING" | "ACCEPTED" | "DISQUALIFIED" | "NO_TIME" | "DID_NOT_FINISH";
  disqualificationReason: string | null;
  durationMs: number | null;
  cardNumber: string | null;
  readAt: string | null;
  punches: { controlCode: string; elapsedMs: number | null; status: string }[];
};

/** The outcome as one choice: status plus, for a disqualification, its reason. */
export type Outcome = "ACCEPTED" | "MISSING_CONTROL" | "WRONG_CONTROL" | "DID_NOT_FINISH" | "NO_TIME";
export const outcomeLabels: Record<Outcome, string> = {
  ACCEPTED: "Hyväksytty",
  MISSING_CONTROL: "Rasti puuttuu",
  WRONG_CONTROL: "Hylätty (ei vastaa rataa)",
  DID_NOT_FINISH: "Keskeytti",
  NO_TIME: "Ilman aikaa",
};

export function outcomeOf(result: Pick<AdminResult, "status" | "disqualificationReason">): Outcome {
  if (result.status === "DISQUALIFIED") return result.disqualificationReason === "MISSING_CONTROL" ? "MISSING_CONTROL" : "WRONG_CONTROL";
  if (result.status === "PENDING") return "ACCEPTED";
  return result.status;
}

const validationOutcome = { ACCEPTED: "ACCEPTED", MISSING_CONTROL: "MISSING_CONTROL", DISQUALIFIED: "WRONG_CONTROL" } as const;

/** Admin correction of one result: course, outcome and time. A card read's
 * punches are shown against the chosen course; changing the course checks
 * them again and pre-fills the outcome and time. */
export function ResultEditDialog({ eventId, result, courses, authHeaders, onSessionExpired, onSaved, onClose }: {
  eventId: string;
  result: AdminResult;
  courses: (CourseForValidation & { name: string })[];
  authHeaders: () => Record<string, string>;
  onSessionExpired: () => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const punches: EmitPunch[] = result.punches.map((punch) => ({ controlCode: Number(punch.controlCode), timeSeconds: Math.round((punch.elapsedMs ?? 0) / 1000) }));
  const [courseId, setCourseId] = useState(result.courseId);
  const [outcome, setOutcome] = useState<Outcome>(outcomeOf(result));
  const [duration, setDuration] = useState(result.durationMs != null ? formatSeconds(Math.round(result.durationMs / 1000)) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const course = courses.find((item) => item.id === courseId);
  const validation = punches.length > 0 ? validateAgainstCourse(punches, course) : null;
  const timed = outcome !== "NO_TIME" && outcome !== "DID_NOT_FINISH";

  function chooseCourse(id: string) {
    setCourseId(id);
    if (punches.length === 0) return;
    const check = validateAgainstCourse(punches, courses.find((item) => item.id === id));
    if (check.status === "UNAVAILABLE") return;
    setOutcome(validationOutcome[check.status]);
    if (check.resultSeconds != null) setDuration(formatSeconds(check.resultSeconds));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    let durationSeconds: number | null = null;
    if (timed && duration.trim()) {
      durationSeconds = parseDuration(duration);
      if (durationSeconds == null) { setError(DURATION_FORMAT_HINT); return; }
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/events/${eventId}/results/${result.id}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          status: outcome === "MISSING_CONTROL" || outcome === "WRONG_CONTROL" ? "DISQUALIFIED" : outcome,
          disqualificationReason: outcome === "MISSING_CONTROL" || outcome === "WRONG_CONTROL" ? outcome : undefined,
          durationSeconds: timed ? durationSeconds : null,
        }),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new Error((Array.isArray(body?.message) ? body.message.join(" ") : body?.message) || "Tuloksen tallentaminen epäonnistui.");
      }
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tuloksen tallentaminen epäonnistui."); }
    finally { setSaving(false); }
  }

  return <><DialogHeader><DialogTitle>Korjaa tulos</DialogTitle><DialogDescription>{result.firstName} {result.lastName}{result.clubName ? ` · ${result.clubName}` : ""}{result.cardNumber ? ` · kortti ${result.cardNumber}` : " · syötetty käsin"}</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div><Label htmlFor="result-course">Rata</Label><NativeSelect id="result-course" className="mt-2 w-full" value={courseId} onChange={(changeEvent) => chooseCourse(changeEvent.target.value)}>{courses.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></div>
        <div><Label htmlFor="result-outcome">Tulos</Label><NativeSelect id="result-outcome" className="mt-2 w-full" value={outcome} onChange={(changeEvent) => setOutcome(changeEvent.target.value as Outcome)}>{(Object.keys(outcomeLabels) as Outcome[]).map((key) => <NativeSelectOption key={key} value={key}>{outcomeLabels[key]}</NativeSelectOption>)}</NativeSelect></div>
        <div><Label htmlFor="result-duration">Aika</Label><Input id="result-duration" className="mt-2" autoComplete="off" placeholder={timed ? "esim. 38:42" : "–"} disabled={!timed} value={timed ? duration : ""} onChange={(changeEvent) => setDuration(changeEvent.target.value)} /></div>
      </div>
      {validation && validation.status !== "UNAVAILABLE" && <p className="text-sm text-muted-foreground">Leimat radalla {course?.name}: {validation.status === "ACCEPTED" ? `kaikki rastit, aika ${validation.resultSeconds != null ? formatSeconds(validation.resultSeconds) : "–"}` : `puuttuu ${validation.missingCodes.join(", ")}`}</p>}
      {punches.length > 0 && <div className="max-h-64 overflow-y-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead className="w-12">#</TableHead><TableHead>Koodi</TableHead><TableHead>Huomio</TableHead><TableHead className="text-right">Väliaika</TableHead><TableHead className="text-right">Lähdöstä</TableHead></TableRow></TableHeader><TableBody>{punches.map((punch, index) => {
        const controlNumber = validation ? validation.matchedIndices.indexOf(index) : -1;
        const isFinish = validation?.finishIndex === index;
        const extra = validation != null && validation.status !== "UNAVAILABLE" && controlNumber === -1 && !isFinish;
        return <TableRow key={index} className={extra ? "text-muted-foreground" : undefined}><TableCell>{index + 1}</TableCell><TableCell className="font-mono">{punch.controlCode}</TableCell><TableCell>{isFinish ? "Maali" : controlNumber >= 0 ? `Rasti ${controlNumber + 1}` : extra ? "Ylimääräinen" : ""}</TableCell><TableCell className="text-right font-mono">{formatSeconds(splitSeconds(punches, index))}</TableCell><TableCell className="text-right font-mono">{formatSeconds(punch.timeSeconds)}</TableCell></TableRow>;
      })}</TableBody></Table></div>}
      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="ghost" className="rounded-full" onClick={onClose}>Peruuta</Button><Button type="submit" className="rounded-full" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}Tallenna korjaus</Button></DialogFooter>
    </form>
  </>;
}
