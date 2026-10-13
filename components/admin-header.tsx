"use client";

import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LOGO_URL, SITE_NAME } from "@/lib/site";

export type AdminNavItem = { label: string; icon?: LucideIcon; href?: string; onClick?: () => void; variant?: "outline" | "ghost" };

/** Top bar of the admin pages. Wide screens show the items as a row of
 * buttons; narrower ones fold two or more items into a hamburger menu that
 * slides in from the right (a lone item, e.g. "← Tapahtumat", stays as is). */
export function AdminHeader({ items }: { items: AdminNavItem[] }) {
  const folds = items.length > 1;
  return <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4">
    <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><div className="min-w-0"><b className="block truncate">{SITE_NAME}</b><span className="text-xs text-muted-foreground">Ylläpito</span></div></div>
    <nav className={folds ? "hidden flex-wrap justify-end gap-2 lg:flex" : "flex gap-2"} aria-label="Ylläpito">{items.map((item) => <NavButton key={item.label} item={item} />)}</nav>
    {folds && <Sheet><SheetTrigger asChild><Button variant="outline" size="icon" className="shrink-0 rounded-full lg:hidden" aria-label="Avaa valikko"><Menu className="size-5" /></Button></SheetTrigger>
      <SheetContent side="right" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b px-5 py-4"><SheetTitle>Ylläpito</SheetTitle></SheetHeader>
        <nav className="grid gap-1 p-3" aria-label="Ylläpito">{items.map((item) => <SheetClose key={item.label} asChild><NavButton item={item} inMenu /></SheetClose>)}</nav>
      </SheetContent>
    </Sheet>}
  </div></header>;
}

function NavButton({ item, inMenu = false, ...props }: { item: AdminNavItem; inMenu?: boolean } & ComponentProps<typeof Button>) {
  const Icon = item.icon;
  const content = <>{Icon && <Icon className={inMenu ? "mr-3 size-4" : "mr-2 size-4"} />}{item.label}</>;
  const className = inMenu ? "h-11 w-full justify-start rounded-xl px-3 text-base font-medium" : "rounded-full";
  const variant = inMenu ? "ghost" : item.variant ?? "outline";
  if (item.href) return <Button asChild variant={variant} className={className} {...props}><a href={item.href}>{content}</a></Button>;
  return <Button type="button" variant={variant} className={className} {...props} onClick={(event) => { props.onClick?.(event); item.onClick?.(); }}>{content}</Button>;
}
