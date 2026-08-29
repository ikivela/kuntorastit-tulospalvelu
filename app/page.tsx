import { ArrowRight, CalendarDays, CheckCircle2, Clock3, MapPin, Navigation, Radio, Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const courses = [
  ["A-rata", "5,3 km", 50], ["B-rata", "4,0 km", 78], ["C-rata", "1,9 km", 49],
  ["D-rata", "1,4 km", 12], ["E-rata", "6,6 km", 36],
] as const;

const upcoming = [
  ["31.8.–5.9.", "Laajalahti", "Uimarannan pysäköintialue"],
  ["7.–12.9.", "Koivuhaka", "Raviradan ympäristö"],
] as const;

export default function Home() {
  return <main className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 lg:px-8">
        <a className="flex items-center gap-3" href="#">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-white"><Navigation className="size-5 rotate-45" /></span>
          <span><b className="block tracking-tight">Maanantairastit</b><small className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Kokkolan Suunnistajat</small></span>
        </a>
        <nav className="hidden gap-7 text-sm font-bold md:flex"><a className="text-primary" href="#kalenteri">Kalenteri</a><a className="text-muted-foreground" href="#tulokset">Tulokset</a><a className="text-muted-foreground" href="#kausi">Kausiseuranta</a></nav>
        <Button variant="outline" className="rounded-full px-5">Ylläpito</Button>
      </div>
    </header>

    <section className="overflow-hidden border-b bg-[linear-gradient(135deg,#eaf5ed_0%,#f8fbf7_58%,#fff4d8_100%)]">
      <div className="relative mx-auto grid max-w-7xl items-end gap-10 px-5 py-14 lg:grid-cols-[1.35fr_.65fr] lg:px-8 lg:py-18">
        <div className="pointer-events-none absolute -right-28 -top-44 size-96 rounded-full border-[52px] border-primary/5" />
        <div className="relative">
          <div className="mb-5 flex items-center gap-3"><Badge className="rounded-full bg-primary/10 px-3 py-1 text-primary hover:bg-primary/10">Kausi 2026</Badge><span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Radio className="size-4 text-emerald-600" />Tulospalvelu toimii</span></div>
          <h1 className="max-w-3xl text-4xl font-black tracking-[-.045em] sm:text-5xl lg:text-6xl">Suunnista omalla tavallasi.<span className="block text-primary">Jokainen käynti lasketaan.</span></h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">Löydä seuraavat rastit, ilmoittaudu ennakkoon ja seuraa osallistumiskertojasi koko kauden ajan.</p>
        </div>
        <div className="relative grid grid-cols-2 gap-3"><Stat icon={CalendarDays} value="24" label="tapahtumaa"/><Stat icon={Users} value="2 184" label="osallistumista"/><Stat icon={Trophy} value="15" label="palkintoraja"/><Stat icon={CheckCircle2} value="94 %" label="valmiina"/></div>
      </div>
    </section>

    <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8 lg:py-12">
      <div className="space-y-10">
        <section id="kalenteri">
          <div className="mb-5 flex items-end justify-between gap-4"><div><p className="eyebrow">Ajankohtainen tapahtuma</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Karhi, Lohtaja</h2></div><Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800 hover:bg-emerald-100">Ilmoittautuminen avoinna</Badge></div>
          <article className="overflow-hidden rounded-3xl border bg-card shadow-[0_18px_50px_-36px_rgba(21,70,43,.45)]">
            <div className="grid gap-5 bg-primary px-6 py-6 text-white sm:grid-cols-3"><Meta icon={CalendarDays} label="Ajankohta" value="24.–29.8.2026"/><Meta icon={Clock3} label="Lähtöaika" value="Klo 17–19"/><Meta icon={MapPin} label="Kokoontuminen" value="Ojalantie, nuorisoseurantalo"/></div>
            <div className="p-3 sm:p-5" id="tulokset"><Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>Rata</TableHead><TableHead>Pituus</TableHead><TableHead className="text-right">Osallistujia</TableHead><TableHead className="w-12"><span className="sr-only">Avaa</span></TableHead></TableRow></TableHeader><TableBody>{courses.map(([name,distance,count])=><TableRow key={name} className="group"><TableCell className="font-bold">{name}</TableCell><TableCell className="text-muted-foreground">{distance}</TableCell><TableCell className="text-right font-semibold tabular-nums">{count}</TableCell><TableCell><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary"/></TableCell></TableRow>)}</TableBody></Table></div>
            <div className="flex flex-col gap-3 border-t bg-muted/35 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-center gap-3 text-sm"><span className="grid size-9 place-items-center rounded-full bg-white text-primary shadow-sm"><Users className="size-4"/></span><span><b>225 osallistujaa</b> <span className="text-muted-foreground">yhteensä</span></span></p><div className="flex gap-2"><Button variant="outline" className="rounded-full">Kaikki tulokset</Button><Button className="rounded-full">Ilmoittaudu <ArrowRight className="ml-1 size-4"/></Button></div></div>
          </article>
        </section>

        <section><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Kalenteri</p><h2 className="mt-1 text-2xl font-extrabold">Seuraavaksi</h2></div><Button variant="ghost" className="rounded-full text-primary">Koko kausi <ArrowRight className="ml-1 size-4"/></Button></div><div className="grid gap-4 sm:grid-cols-2">{upcoming.map(([date,place,address])=><article key={place} className="rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between"><span className="rounded-xl bg-secondary px-3 py-2 text-sm font-extrabold text-primary">{date}</span><ArrowRight className="mt-2 size-4 text-muted-foreground"/></div><h3 className="mt-5 text-lg font-extrabold">{place}</h3><p className="mt-1 text-sm text-muted-foreground">{address}</p><p className="mt-4 flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4 text-primary"/>Klo 17–19</p></article>)}</div></section>
      </div>

      <aside className="space-y-6" id="kausi">
        <section className="rounded-3xl bg-[#183c2b] p-6 text-white shadow-[0_24px_60px_-40px_rgba(15,59,39,.85)]"><div className="flex justify-between"><span className="grid size-11 place-items-center rounded-2xl bg-white/10"><Trophy className="size-5 text-amber-300"/></span><Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">Tavoitepalkinto</Badge></div><h2 className="mt-6 text-2xl font-extrabold">12 / 15 käyntiä</h2><p className="mt-2 text-sm leading-6 text-white/70">Kolme käyntiä seuraavaan palkintorajaan.</p><Progress value={80} className="mt-6 h-2 bg-white/15 [&>div]:bg-amber-300"/><Button variant="secondary" className="mt-6 w-full rounded-full bg-white text-[#183c2b]">Valitse oma henkilö</Button></section>
        <section className="rounded-3xl border bg-card p-6"><p className="eyebrow">Tapahtuman tila</p><div className="mt-5 space-y-4"><Status label="Hyväksytty" value="94" color="bg-emerald-500"/><Status label="Omatoimi" value="100" color="bg-sky-500"/><Status label="Ilman aikaa" value="31" color="bg-amber-400"/></div></section>
        <section className="rounded-3xl border border-dashed border-primary/30 bg-primary/5 p-6"><p className="text-sm font-extrabold text-primary">Jokainen käynti huomioidaan</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Myös toimitsijapäivä ja osallistuminen ilman aikaa lasketaan yhdeksi käynniksi.</p></section>
      </aside>
    </div>
    <footer className="border-t bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-7 text-sm text-muted-foreground sm:flex-row sm:justify-between lg:px-8"><p>© 2026 Kokkolan Suunnistajat</p><p>Tulokset, osallistumiset ja tavoitepalkinnot yhdessä paikassa.</p></div></footer>
  </main>;
}

function Stat({icon:Icon,value,label}:{icon:typeof Users;value:string;label:string}){return <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur"><Icon className="size-4 text-primary"/><p className="mt-4 text-2xl font-black">{value}</p><p className="text-xs font-semibold text-muted-foreground">{label}</p></div>}
function Meta({icon:Icon,label,value}:{icon:typeof Users;label:string;value:string}){return <div className="flex gap-3"><Icon className="mt-0.5 size-5 shrink-0 text-white/60"/><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-white/55">{label}</p><p className="mt-1 text-sm font-bold leading-5">{value}</p></div></div>}
function Status({label,value,color}:{label:string;value:string;color:string}){return <div className="flex justify-between text-sm"><span className="flex items-center gap-3 font-semibold"><span className={`size-2.5 rounded-full ${color}`}/>{label}</span><b>{value}</b></div>}
