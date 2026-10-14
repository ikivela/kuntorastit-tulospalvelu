import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLUB_NAME, LOGO_URL, SITE_NAME, withBasePath } from "@/lib/site";

/** Sticky top bar of the public results pages. On phones the page's own
 * heading section is hidden, so the bar shows the event instead of the site
 * name (with a live-update dot while the event is on) and the back button
 * shrinks to its arrow. */
export function ResultsHeader({ title, subtitle, live, refreshing, backHref, backLabel }: { title: string | null; subtitle: string | null; live: boolean; refreshing: boolean; backHref: string; backLabel: string }) {
  return <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:gap-5 sm:px-5 sm:py-4 lg:px-8">
    <div className="flex min-w-0 items-center gap-3">
      <a className="flex shrink-0 items-center gap-3" href={withBasePath("/")} aria-label={SITE_NAME}><span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border sm:size-10"><img src={LOGO_URL} alt="" className="size-7 object-contain sm:size-8" /></span><span className="hidden sm:block"><b className="block tracking-tight">{SITE_NAME}</b>{CLUB_NAME && <small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">{CLUB_NAME}</small>}</span></a>
      <div className="min-w-0 sm:hidden"><b className="block truncate text-sm leading-tight">{title ?? SITE_NAME}</b>{subtitle && <small className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="truncate">{subtitle}</span>{refreshing ? <Loader2 className="size-3 shrink-0 animate-spin text-primary" /> : live && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" title="Päivittyy automaattisesti" />}</small>}</div>
    </div>
    <Button asChild variant="outline" className="shrink-0 rounded-full px-3 sm:px-4"><a href={backHref} aria-label={backLabel}><ArrowLeft className="size-4 sm:mr-2" /><span className="hidden sm:inline">{backLabel}</span></a></Button>
  </div></header>;
}
