"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE, PAYMENT_HINT } from "@/lib/site";

const apiBase = API_BASE;

export type RegistrationEvent = { id: string; name: string; courses: { id: string; name: string; lengthMeters: number }[]; paymentMethods: string[] };

export function RegistrationDialog({ event, open, onOpenChange }: { event: RegistrationEvent; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault(); setSaving(true); setError("");
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    try {
      const payload = { firstName: data.get("firstName"), lastName: data.get("lastName"), clubName: data.get("clubName") || undefined, courseId: data.get("courseId"), paymentMethod: data.get("paymentMethod"), notes: data.get("notes") || undefined };
      const response = await fetch(`${apiBase}/public/events/${event.id}/registrations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => null) as { message?: string | string[]; participant?: string } | null;
      if (!response.ok) { const message = Array.isArray(result?.message) ? result.message.join(" ") : result?.message; throw new Error(message || "Ilmoittautuminen epäonnistui."); }
      setSuccess(`${result?.participant ?? "Osallistuja"} on ilmoitettu tapahtumaan.`); form.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ilmoittautuminen epäonnistui."); }
    finally { setSaving(false); }
  }
  function changeOpen(value: boolean) { if (!value) { setError(""); setSuccess(""); } onOpenChange(value); }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-xl"><DialogHeader><DialogTitle>Ilmoittaudu · {event.name}</DialogTitle><DialogDescription>Valitse rata ja anna osallistujan tiedot. Seura ja lisätiedot ovat vapaaehtoisia.</DialogDescription></DialogHeader>{success ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center"><CheckCircle2 className="mx-auto size-9 text-emerald-700" /><p className="mt-3 font-bold text-emerald-900">Ilmoittautuminen vastaanotettu</p><p className="mt-1 text-sm text-emerald-800">{success}</p><Button className="mt-5 rounded-full" onClick={() => changeOpen(false)}>Valmis</Button></div> : <form className="grid gap-4" onSubmit={submit}><div className="grid gap-4 sm:grid-cols-2"><RegistrationField label="Etunimi" name="firstName" autoComplete="given-name" /><RegistrationField label="Sukunimi" name="lastName" autoComplete="family-name" /></div><RegistrationField label="Seura (vapaaehtoinen)" name="clubName" autoComplete="organization" required={false} /><div><Label htmlFor={`course-${event.id}`}>Sarja (rata)</Label><NativeSelect id={`course-${event.id}`} name="courseId" className="mt-2 w-full" required defaultValue=""><NativeSelectOption value="" disabled>Valitse rata</NativeSelectOption>{event.courses.map((course) => <NativeSelectOption key={course.id} value={course.id}>{course.name} · {formatDistance(course.lengthMeters)}</NativeSelectOption>)}</NativeSelect></div><div><p className="mb-2 text-sm text-muted-foreground">{PAYMENT_HINT}</p><Label htmlFor={`payment-${event.id}`}>Maksutapa</Label><NativeSelect id={`payment-${event.id}`} name="paymentMethod" className="mt-2 w-full" required defaultValue=""><NativeSelectOption value="" disabled>Valitse maksutapa</NativeSelectOption>{event.paymentMethods.map((method) => <NativeSelectOption key={method} value={method}>{method}</NativeSelectOption>)}</NativeSelect></div><div><Label htmlFor={`notes-${event.id}`}>Lisätiedot (vapaaehtoinen)</Label><Textarea id={`notes-${event.id}`} name="notes" className="mt-2" maxLength={2000} rows={3} /></div>{error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}<Button type="submit" className="mt-2 rounded-full" disabled={saving}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UserPlus className="mr-2 size-4" />}{saving ? "Tallennetaan…" : "Vahvista ilmoittautuminen"}</Button></form>}</DialogContent></Dialog>;
}

function RegistrationField({ label, name, required = true, ...props }: { label: string; name: string; required?: boolean } & React.ComponentProps<typeof Input>) {
  return <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} className="mt-2" required={required} maxLength={120} {...props} /></div>;
}

function formatDistance(meters: number) { return `${(meters / 1000).toLocaleString("fi-FI", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`; }
