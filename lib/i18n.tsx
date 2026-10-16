"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

/** Languages of the public pages (calendar, results, split times,
 * registration). The admin pages stay Finnish. The language comes from the
 * visitor's choice (remembered in the browser) or else the browser's
 * language; the server always renders Finnish and the browser switches right
 * after hydration, so there's no hydration mismatch. */
export const LANGUAGES = ["fi", "sv", "en"] as const;
export type Lang = (typeof LANGUAGES)[number];
const LOCALES: Record<Lang, string> = { fi: "fi-FI", sv: "sv-FI", en: "en-GB" };
const STORAGE_KEY = "kuntorastit-lang";

const fi = {
  languageName: "Suomi",
  common: {
    admin: "Ylläpito",
    retry: "Yritä uudelleen",
    results: "Tulokset",
    register: "Ilmoittaudu",
    registrationOpen: "Ilmoittautuminen avoinna",
    placeLater: "Paikka ilmoitetaan myöhemmin",
    liveUpdating: "Päivittyy automaattisesti",
    connectionLost: "Yhteys katkesi hetkeksi",
    language: "Kieli",
  },
  home: {
    fullCalendar: "Koko kalenteri",
    intro: "Täältä löydät kaikki tulevat tapahtumat, tulokset ja ilmoittautumisen.",
    upcoming: "Seuraavat tapahtumat",
    loadError: "Tapahtumien lataaminen epäonnistui. Tarkista yhteys ja yritä uudelleen.",
    loadErrorTitle: "Tapahtumia ei voitu ladata",
    noneTitle: "Ei tulevia tapahtumia juuri nyt",
    noneText: "Koko kauden tapahtumat löytyvät kalenterista.",
    openCalendar: "Avaa kalenteri",
    footer: "tapahtumat, tulokset ja ilmoittautuminen.",
  },
  calendar: {
    title: (year: number) => `Kalenteri ${year}`,
    toFrontPage: "Etusivulle",
    intro: "Tarkista tulevat rastit, tapahtumapaikat ja tarjolla olevat radat. Julkaistut tulokset ja osallistujamäärät näkyvät tapahtumien yhteydessä.",
    events: "tapahtumaa",
    attendances: "osallistumista",
    season: "Kausi",
    previousYear: "Edellinen vuosi",
    nextYear: "Seuraava vuosi",
    loadError: "Kalenterin lataaminen epäonnistui. Tarkista yhteys ja yritä uudelleen.",
    loadErrorTitle: "Kalenteria ei voitu ladata",
    noneTitle: (year: number) => `Vuodelle ${year} ei ole vielä julkaistuja tapahtumia`,
    noneText: "Voit tarkistaa edellisen tai seuraavan vuoden kalenterin nuolipainikkeilla.",
    backToSeason: (year: number) => `Palaa kauteen ${year}`,
    reward: (count: number) => `Tavoitepalkinto ${count} käynnistä`,
    registered: (count: number) => `${count} ilmoittautunut`,
    attended: (count: number) => `${count} osallistunut`,
    courses: "Radat",
    registerToEvent: "Ilmoittaudu tapahtumaan",
    coursesLater: "Ratavalikoima julkaistaan myöhemmin.",
    upcomingBadge: "Tulossa",
    ongoingBadge: "Käynnissä",
    finishedBadge: "Päättynyt",
  },
  results: {
    eyebrow: "Tulokset",
    toCalendar: "Kalenteriin",
    loadError: "Tulosten lataaminen epäonnistui. Yritetään pian uudelleen.",
    loadErrorTitle: "Tuloksia ei voitu ladata",
    noneTitle: "Ei vielä tuloksia",
    noneText: "Tulokset ilmestyvät tähän automaattisesti, kun kortteja luetaan.",
    course: "Rata",
    resultCount: (count: number) => `${count} tulosta`,
    splitTimes: "Rastiväliajat",
    rank: "Sija",
    name: "Nimi",
    club: "Seura",
    result: "Tulos",
    behind: "Ero kärkeen",
    pace: "Vauhti",
    attendances: "Osallistumiskerrat",
    timesShort: (count: number) => `${count} krt`,
    noTime: "Ei aikaa",
    missingPunch: "Leima puuttuu",
    didNotFinish: "Keskeyttänyt",
    pending: "Odottaa",
    selfService: "Omatoimi",
  },
  splits: {
    eyebrow: "Rastiväliajat",
    toResults: "Tuloksiin",
    loadError: "Rastiväliaikojen lataaminen epäonnistui. Yritetään pian uudelleen.",
    loadErrorTitle: "Tietoja ei voitu ladata",
    class: "Sarja",
    classNotFound: "Sarjaa ei löytynyt",
    classNotFoundText: "Valitse sarja yllä olevasta valikosta.",
    noneTitle: "Ei vertailukelpoisia tuloksia",
    noneText: "Rastiväliaikoja ei voi vielä näyttää — odotetaan hyväksyttyjä tuloksia.",
    rankName: "Sija · Nimi",
    rank: "Sija",
    sortByResult: "Järjestä tuloksen mukaan",
    start: "L",
    finishShort: "M",
    finish: "Maali",
    leg: "väli",
    total: "yht.",
    legend: "Taulukon selite",
    legendLegs: <><b>L–1, 1–2, … –M</b> = rastiväli lähdöstä (L) maaliin (M). Otsikon alla rastikoodi.</>,
    legendRows: <><b>Ylärivi</b> = rastivälin aika, <b>alarivi</b> = kokonaisaika lähdöstä kyseiselle rastille. Suluissa sija.</>,
    legendRanks: (first: ReactNode, second: ReactNode) => <>{first} = nopein, {second} = toiseksi ja kolmanneksi nopein.</>,
    legendMistake: <><b>Pummi</b> = rastiväli, jolla juoksija oli selvästi omaa tasoaan hitaampi.</>,
    legendMistakeHow: "Kunkin rastivälin vertailuaika on kolmen nopeimman keskiarvo. Juoksijan oma taso on hänen rastiväliensä mediaani suhteessa vertailuaikoihin (esim. 1,12 = tyypillisesti 12 % kärkeä hitaampi).",
    legendMistakeRule: "Odotettu aika = vertailuaika × oma taso. Väli on pummi, kun se on yli 20 % ja vähintään 20 s odotettua hitaampi. Aikahukka = toteutunut − odotettu aika; näet sen napauttamalla punaista solua.",
    legendMistakeNote: "Pienissä sarjoissa arvio on suuntaa antava, eikä yhden juoksijan sarjassa pummeja tunnisteta.",
    legendSort: <><b>väli</b> ja <b>yht.</b> järjestävät juoksijat rastivälin tai kokonaisajan mukaan. <b>Sija</b> palauttaa tulosjärjestyksen.</>,
    mistakeLabel: (time: string) => `Pummi, ${time}: näytä aikahukka`,
    mistake: (time: ReactNode) => <><b>Pummi</b>: arviolta <b className="tabular-nums">{time}</b> hukkaa juoksijan omaan tasoon verrattuna.</>,
    excluded: (count: number, names: string) => `Vertailun ulkopuolella (${count}): ${names} — ei hyväksyttyä tulosta.`,
  },
  registration: {
    title: (event: string) => `Ilmoittaudu · ${event}`,
    intro: "Valitse rata ja anna osallistujan tiedot. Seura ja lisätiedot ovat vapaaehtoisia.",
    firstName: "Etunimi",
    lastName: "Sukunimi",
    club: "Seura (vapaaehtoinen)",
    course: "Sarja (rata)",
    chooseCourse: "Valitse rata",
    payment: "Maksutapa",
    choosePayment: "Valitse maksutapa",
    notes: "Lisätiedot (vapaaehtoinen)",
    submit: "Vahvista ilmoittautuminen",
    saving: "Tallennetaan…",
    failed: "Ilmoittautuminen epäonnistui.",
    received: "Ilmoittautuminen vastaanotettu",
    registered: (name: string) => `${name} on ilmoitettu tapahtumaan. Ilmoittautuminen näkyy tuloksissa omatoimisuorituksena.`,
    selfServiceTitle: "Omatoimirastit",
    selfServiceNote: "Ilmoittautuminen kirjataan tuloksiin omatoimisuorituksena (Omatoimi) ja se lasketaan osallistumiskertoihin. Jos luet EMIT-kortin tapahtumassa, saat ajan ja sijoituksen, ja tulos korvaa omatoimimerkinnän.",
    participant: "Osallistuja",
    done: "Valmis",
  },
};

type Dictionary = typeof fi;

const sv: Dictionary = {
  languageName: "Svenska",
  common: {
    admin: "Administration",
    retry: "Försök igen",
    results: "Resultat",
    register: "Anmäl dig",
    registrationOpen: "Anmälan öppen",
    placeLater: "Platsen meddelas senare",
    liveUpdating: "Uppdateras automatiskt",
    connectionLost: "Anslutningen bröts tillfälligt",
    language: "Språk",
  },
  home: {
    fullCalendar: "Hela kalendern",
    intro: "Här hittar du alla kommande evenemang, resultat och anmälan.",
    upcoming: "Kommande evenemang",
    loadError: "Evenemangen kunde inte laddas. Kontrollera anslutningen och försök igen.",
    loadErrorTitle: "Evenemangen kunde inte laddas",
    noneTitle: "Inga kommande evenemang just nu",
    noneText: "Hela säsongens evenemang finns i kalendern.",
    openCalendar: "Öppna kalendern",
    footer: "evenemang, resultat och anmälan.",
  },
  calendar: {
    title: (year) => `Kalender ${year}`,
    toFrontPage: "Till startsidan",
    intro: "Se kommande kontroller, platser och banor. Publicerade resultat och deltagarantal visas vid evenemangen.",
    events: "evenemang",
    attendances: "deltaganden",
    season: "Säsong",
    previousYear: "Föregående år",
    nextYear: "Nästa år",
    loadError: "Kalendern kunde inte laddas. Kontrollera anslutningen och försök igen.",
    loadErrorTitle: "Kalendern kunde inte laddas",
    noneTitle: (year) => `Inga publicerade evenemang för ${year} ännu`,
    noneText: "Du kan se föregående eller nästa års kalender med pilknapparna.",
    backToSeason: (year) => `Tillbaka till säsongen ${year}`,
    reward: (count) => `Målpris efter ${count} deltaganden`,
    registered: (count) => `${count} anmälda`,
    attended: (count) => `${count} deltagit`,
    courses: "Banor",
    registerToEvent: "Anmäl dig till evenemanget",
    coursesLater: "Banorna publiceras senare.",
    upcomingBadge: "Kommande",
    ongoingBadge: "Pågår",
    finishedBadge: "Avslutat",
  },
  results: {
    eyebrow: "Resultat",
    toCalendar: "Till kalendern",
    loadError: "Resultaten kunde inte laddas. Vi försöker snart igen.",
    loadErrorTitle: "Resultaten kunde inte laddas",
    noneTitle: "Inga resultat ännu",
    noneText: "Resultaten visas här automatiskt när brickorna läses.",
    course: "Bana",
    resultCount: (count) => `${count} resultat`,
    splitTimes: "Sträcktider",
    rank: "Plac.",
    name: "Namn",
    club: "Klubb",
    result: "Resultat",
    behind: "Efter täten",
    pace: "Tempo",
    attendances: "Deltaganden",
    timesShort: (count) => `${count} ggr`,
    noTime: "Ingen tid",
    missingPunch: "Felstämpling",
    didNotFinish: "Utgått",
    pending: "Väntar",
    selfService: "På egen hand",
  },
  splits: {
    eyebrow: "Sträcktider",
    toResults: "Till resultaten",
    loadError: "Sträcktiderna kunde inte laddas. Vi försöker snart igen.",
    loadErrorTitle: "Uppgifterna kunde inte laddas",
    class: "Klass",
    classNotFound: "Klassen hittades inte",
    classNotFoundText: "Välj klass i menyn ovan.",
    noneTitle: "Inga jämförbara resultat",
    noneText: "Sträcktiderna kan inte visas ännu — inväntar godkända resultat.",
    rankName: "Plac. · Namn",
    rank: "Plac.",
    sortByResult: "Sortera efter resultat",
    start: "S",
    finishShort: "M",
    finish: "Mål",
    leg: "sträcka",
    total: "tot.",
    legend: "Förklaring",
    legendLegs: <><b>S–1, 1–2, … –M</b> = sträcka från start (S) till mål (M). Kontrollkoden under rubriken.</>,
    legendRows: <><b>Övre raden</b> = sträcktid, <b>nedre raden</b> = totaltid från start till kontrollen. Placering inom parentes.</>,
    legendRanks: (first, second) => <>{first} = snabbast, {second} = näst och tredje snabbast.</>,
    legendMistake: <><b>Bom</b> = sträcka där löparen var klart långsammare än sin egen nivå.</>,
    legendMistakeHow: "Varje sträckas referenstid är medelvärdet av de tre snabbaste. Löparens egen nivå är medianen av hens sträcktider i förhållande till referenstiderna (t.ex. 1,12 = vanligtvis 12 % långsammare än täten).",
    legendMistakeRule: "Förväntad tid = referenstid × egen nivå. En sträcka är en bom när den är mer än 20 % och minst 20 s långsammare än förväntat. Tidsförlust = verklig − förväntad tid; tryck på den röda cellen för att se den.",
    legendMistakeNote: "I små klasser är uppskattningen ungefärlig, och i en klass med en enda löpare identifieras inga bommar.",
    legendSort: <><b>sträcka</b> och <b>tot.</b> sorterar löparna efter sträcktid eller totaltid. <b>Plac.</b> återställer resultatordningen.</>,
    mistakeLabel: (time) => `Bom, ${time}: visa tidsförlust`,
    mistake: (time) => <><b>Bom</b>: uppskattningsvis <b className="tabular-nums">{time}</b> förlorad tid jämfört med löparens egen nivå.</>,
    excluded: (count, names) => `Utanför jämförelsen (${count}): ${names} — inget godkänt resultat.`,
  },
  registration: {
    title: (event) => `Anmälan · ${event}`,
    intro: "Välj bana och fyll i deltagarens uppgifter. Klubb och tilläggsuppgifter är frivilliga.",
    firstName: "Förnamn",
    lastName: "Efternamn",
    club: "Klubb (frivillig)",
    course: "Klass (bana)",
    chooseCourse: "Välj bana",
    payment: "Betalningssätt",
    choosePayment: "Välj betalningssätt",
    notes: "Tilläggsuppgifter (frivilliga)",
    submit: "Bekräfta anmälan",
    saving: "Sparar…",
    failed: "Anmälan misslyckades.",
    received: "Anmälan mottagen",
    registered: (name) => `${name} är anmäld till evenemanget. Anmälan visas i resultaten som en prestation på egen hand.`,
    selfServiceTitle: "Orientering på egen hand",
    selfServiceNote: "Anmälan visas i resultaten som en prestation på egen hand (På egen hand) och räknas som ett deltagande. Om du läser av din EMIT-bricka vid evenemanget får du tid och placering, och resultatet ersätter markeringen.",
    participant: "Deltagaren",
    done: "Klar",
  },
};

const en: Dictionary = {
  languageName: "English",
  common: {
    admin: "Admin",
    retry: "Try again",
    results: "Results",
    register: "Register",
    registrationOpen: "Registration open",
    placeLater: "Venue to be announced",
    liveUpdating: "Updates automatically",
    connectionLost: "Connection lost for a moment",
    language: "Language",
  },
  home: {
    fullCalendar: "Full calendar",
    intro: "Find all upcoming events, results and registration here.",
    upcoming: "Upcoming events",
    loadError: "Could not load the events. Check your connection and try again.",
    loadErrorTitle: "Could not load the events",
    noneTitle: "No upcoming events right now",
    noneText: "The whole season's events are in the calendar.",
    openCalendar: "Open the calendar",
    footer: "events, results and registration.",
  },
  calendar: {
    title: (year) => `Calendar ${year}`,
    toFrontPage: "Home",
    intro: "Check upcoming events, venues and courses. Published results and participant numbers are shown with each event.",
    events: "events",
    attendances: "participations",
    season: "Season",
    previousYear: "Previous year",
    nextYear: "Next year",
    loadError: "Could not load the calendar. Check your connection and try again.",
    loadErrorTitle: "Could not load the calendar",
    noneTitle: (year) => `No published events for ${year} yet`,
    noneText: "Use the arrow buttons to see the previous or next year's calendar.",
    backToSeason: (year) => `Back to season ${year}`,
    reward: (count) => `Reward after ${count} visits`,
    registered: (count) => `${count} registered`,
    attended: (count) => `${count} took part`,
    courses: "Courses",
    registerToEvent: "Register for the event",
    coursesLater: "The courses will be published later.",
    upcomingBadge: "Upcoming",
    ongoingBadge: "Ongoing",
    finishedBadge: "Finished",
  },
  results: {
    eyebrow: "Results",
    toCalendar: "Calendar",
    loadError: "Could not load the results. Trying again shortly.",
    loadErrorTitle: "Could not load the results",
    noneTitle: "No results yet",
    noneText: "Results appear here automatically as cards are read.",
    course: "Course",
    resultCount: (count) => `${count} ${count === 1 ? "result" : "results"}`,
    splitTimes: "Split times",
    rank: "Pos.",
    name: "Name",
    club: "Club",
    result: "Result",
    behind: "Behind",
    pace: "Pace",
    attendances: "Participations",
    timesShort: (count) => `${count}×`,
    noTime: "No time",
    missingPunch: "Missing punch",
    didNotFinish: "Did not finish",
    pending: "Pending",
    selfService: "Own time",
  },
  splits: {
    eyebrow: "Split times",
    toResults: "Results",
    loadError: "Could not load the split times. Trying again shortly.",
    loadErrorTitle: "Could not load the data",
    class: "Course",
    classNotFound: "Course not found",
    classNotFoundText: "Choose a course from the menu above.",
    noneTitle: "No comparable results",
    noneText: "Split times can't be shown yet — waiting for accepted results.",
    rankName: "Pos. · Name",
    rank: "Pos.",
    sortByResult: "Sort by result",
    start: "S",
    finishShort: "F",
    finish: "Finish",
    leg: "leg",
    total: "total",
    legend: "Legend",
    legendLegs: <><b>S–1, 1–2, … –F</b> = leg from the start (S) to the finish (F). Control code under the heading.</>,
    legendRows: <><b>Top line</b> = leg time, <b>bottom line</b> = total time from the start to that control. Position in brackets.</>,
    legendRanks: (first, second) => <>{first} = fastest, {second} = second and third fastest.</>,
    legendMistake: <><b>Mistake</b> = a leg where the runner was clearly slower than their own level.</>,
    legendMistakeHow: "Each leg's reference time is the average of the three fastest. The runner's own level is the median of their legs relative to the reference times (e.g. 1.12 = usually 12% slower than the leaders).",
    legendMistakeRule: "Expected time = reference time × own level. A leg is a mistake when it is more than 20% and at least 20 s slower than expected. Time lost = actual − expected time; tap the red cell to see it.",
    legendMistakeNote: "In small courses the estimate is rough, and with a single runner no mistakes are detected.",
    legendSort: <><b>leg</b> and <b>total</b> sort the runners by leg time or total time. <b>Pos.</b> restores the result order.</>,
    mistakeLabel: (time) => `Mistake, ${time}: show time lost`,
    mistake: (time) => <><b>Mistake</b>: about <b className="tabular-nums">{time}</b> lost compared with the runner&apos;s own level.</>,
    excluded: (count, names) => `Not compared (${count}): ${names} — no accepted result.`,
  },
  registration: {
    title: (event) => `Register · ${event}`,
    intro: "Choose a course and fill in the participant's details. Club and notes are optional.",
    firstName: "First name",
    lastName: "Last name",
    club: "Club (optional)",
    course: "Course",
    chooseCourse: "Choose a course",
    payment: "Payment method",
    choosePayment: "Choose a payment method",
    notes: "Notes (optional)",
    submit: "Confirm registration",
    saving: "Saving…",
    failed: "Registration failed.",
    received: "Registration received",
    registered: (name) => `${name} is registered for the event. The registration is listed in the results as "Own time".`,
    selfServiceTitle: "Own-time orienteering",
    selfServiceNote: "Your registration is listed in the results as \"Own time\" and counts as a participation. If you read your EMIT card at the event, you get a time and a position, and the result replaces the entry.",
    participant: "The participant",
    done: "Done",
  },
};

const DICTIONARIES: Record<Lang, Dictionary> = { fi, sv, en };

// --- Current language: a tiny store shared by all components ---------------

const listeners = new Set<() => void>();
let chosen: Lang | null = null;

function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function detect(): Lang {
  if (chosen) return chosen;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return (chosen = stored);
  } catch { /* storage blocked: fall back to the browser language */ }
  const browser = (navigator.languages?.length ? navigator.languages : [navigator.language])
    .map((tag) => tag.toLowerCase().split("-")[0])
    .find(isLang);
  return (chosen = browser ?? "fi");
}

export function setLang(lang: Lang) {
  chosen = lang;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* not remembered */ }
  document.documentElement.lang = lang;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current language's texts, Intl locale and language code. */
export function useT() {
  const lang = useSyncExternalStore(subscribe, detect, () => "fi" as Lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return { t: DICTIONARIES[lang], lang, locale: LOCALES[lang] };
}

/** "FI · SV · EN" switcher for the public pages' top bars. */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, t } = useT();
  return <div role="group" aria-label={t.common.language} className={`inline-flex shrink-0 rounded-full border bg-white/70 p-0.5 text-xs font-bold ${className}`}>
    {LANGUAGES.map((code) => <button key={code} type="button" lang={code} title={DICTIONARIES[code].languageName} aria-pressed={lang === code} onClick={() => setLang(code)}
      className={`rounded-full px-2 py-1 uppercase transition-colors ${lang === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{code}</button>)}
  </div>;
}

// --- Formatting in the current locale ---------------------------------------

export function formatDistance(meters: number, locale: string) {
  return `${(meters / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}
