"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE } from "@/lib/site";

const MIN_LENGTH = 12;

export function ChangePasswordDialog({ token, onSessionExpired, onClose }: { token: string; onSessionExpired: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword.length < MIN_LENGTH) { setError(`Uuden salasanan pitää olla vähintään ${MIN_LENGTH} merkkiä.`); return; }
    if (newPassword !== String(data.get("confirmPassword") ?? "")) { setError("Uudet salasanat eivät täsmää."); return; }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/auth/change-password`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new Error((Array.isArray(body?.message) ? body.message.join(" ") : body?.message) || "Salasanan vaihto epäonnistui.");
      }
      setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Salasanan vaihto epäonnistui."); }
    finally { setSaving(false); }
  }

  if (done) return <><DialogHeader><DialogTitle>Salasana vaihdettu</DialogTitle><DialogDescription>Käytä uutta salasanaa seuraavalla kirjautumiskerralla.</DialogDescription></DialogHeader><p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-primary" />Salasana on päivitetty.</p><DialogFooter><Button className="rounded-full" onClick={onClose}>Sulje</Button></DialogFooter></>;
  return <><DialogHeader><DialogTitle>Vaihda salasana</DialogTitle><DialogDescription>Uuden salasanan pitää olla vähintään {MIN_LENGTH} merkkiä.</DialogDescription></DialogHeader>
    <form className="grid gap-4" onSubmit={submit}>
      <div><Label htmlFor="currentPassword">Nykyinen salasana</Label><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="mt-2" /></div>
      <div><Label htmlFor="newPassword">Uusi salasana</Label><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={MIN_LENGTH} className="mt-2" /></div>
      <div><Label htmlFor="confirmPassword">Uusi salasana uudelleen</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="mt-2" /></div>
      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="ghost" className="rounded-full" onClick={onClose}>Peruuta</Button><Button type="submit" className="rounded-full" disabled={saving}>{saving && <Loader2 className="mr-2 size-4 animate-spin" />}Vaihda salasana</Button></DialogFooter>
    </form>
  </>;
}
