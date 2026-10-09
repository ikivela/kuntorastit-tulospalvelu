"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpen, Code, Download, ExternalLink, Loader2, MonitorDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_BASE, CLIENT_DOWNLOAD_URL, LOGO_URL, SITE_NAME, SOURCE_URL, withBasePath } from "@/lib/site";

const apiBase = API_BASE;

// Usage instructions for the admin UI and the PC client (Kuntorastit PC
// Client, clients/pc-client). Static content; keep the button and field names
// in sync with the pages they describe.
export default function InstructionsPage() {
  const [checking, setChecking] = useState(true);
  // The client needs an absolute address; API_BASE may be a path (/api/v1).
  const [clientApiBase, setClientApiBase] = useState(apiBase);

  useEffect(() => {
    const stored = window.localStorage.getItem("kuntorastit-admin-token");
    if (!stored) { window.location.href = withBasePath("/admin"); return; }
    fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${stored}` } })
      .then((response) => {
        if (!response.ok) throw new Error();
        setClientApiBase(new URL(apiBase, window.location.origin).toString().replace(/\/+$/, ""));
        setChecking(false);
      })
      .catch(() => { window.localStorage.removeItem("kuntorastit-admin-token"); window.location.href = withBasePath("/admin"); });
  }, []);

  if (checking) return <main className="grid min-h-screen place-items-center bg-muted/30"><Loader2 className="size-6 animate-spin text-primary" /></main>;

  return <main className="min-h-screen bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-border"><img src={LOGO_URL} alt="" className="size-8 object-contain" /></span><div><b className="block">{SITE_NAME}</b><span className="text-xs text-muted-foreground">Ylläpito</span></div></div><Button asChild variant="ghost" className="rounded-full"><a href={withBasePath("/admin")}><ArrowLeft className="mr-2 size-4" />Tapahtumat</a></Button></div></header>
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-8"><p className="text-sm font-bold uppercase tracking-wider text-primary">Hallinta</p><h1 className="mt-2 text-3xl font-black tracking-tight">Ohjeet</h1><p className="mt-2 text-muted-foreground">Miten tulospalvelua ylläpidetään ja miten tapahtumapäivän luenta hoidetaan PC-clientillä. Tulospalvelu on avointa lähdekoodia: <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">lähdekoodi GitHubissa</a>.</p></div>

      <Card className="mb-8 rounded-2xl"><CardContent className="grid gap-6 p-5 sm:grid-cols-2">
        <Toc title="Web-sovellus" items={[["kausi", "1. Sarjat ja kaudet"], ["tapahtumat", "2. Tapahtumat"], ["radat", "3. Radat ja XML-tuonti"], ["ilmoittautumiset", "4. Ilmoittautuminen ja osanottajat"], ["tapahtumapaiva", "5. Tapahtumapäivä ja tulokset"], ["osallistumiskerrat", "6. Osallistumiskerrat ja palkinnot"], ["lukijalaitteet", "7. Lukijalaitteet"], ["tili", "8. Salasana ja kirjautuminen"]]} />
        <Toc title="PC-client" items={[["client-asennus", "1. Asennus"], ["client-kayttoonotto", "2. Käyttöönotto"], ["client-henkilot", "3. Henkilörekisteri (HenkilöDB)"], ["client-luenta", "4. Kortin luenta"], ["client-kasin", "5. Käsin syötetyt tulokset"], ["client-korjaus", "6. Tulosten korjaaminen"], ["client-offline", "7. Verkkoyhteys katkeilee"], ["client-vianetsinta", "8. Vianetsintä"]]} />
      </CardContent></Card>

      <h2 className="mb-4 flex items-center gap-2 text-2xl font-black tracking-tight"><BookOpen className="size-6 text-primary" />Web-sovellus</h2>
      <div className="grid gap-4">
        <Section id="kausi" title="1. Sarjat ja kaudet">
          <p>Jokainen tapahtuma kuuluu kauteen, ja kausi kuuluu tapahtumasarjaan (esim. &quot;Kuntorastit&quot;). Kun aloitat uutta vuotta, luo kausi ennen tapahtumia.</p>
          <Steps items={[
            <>Avaa <b>Kaudet</b> ylävalikosta.</>,
            <>Jos sarjaa ei vielä ole, paina <b>Lisää sarja</b> ja anna nimi. Nimi näkyy julkisessa kalenterissa.</>,
            <>Paina sarjan kohdalla <b>Lisää kausi</b>. Lomake ehdottaa edellisen kauden pohjalta seuraavaa vuotta, samoja päivämääriä ja samoja palkintorajoja.</>,
            <>Tarkista <b>Palkintorajat</b>: kuinka monella osallistumiskerralla palkinnon saa. Rajoja voi olla useita (esim. 5 ja 10 kertaa).</>,
          ]} />
          <Note>Vuosi on sarjan sisällä yksilöllinen, ja tapahtumien Excel-tuonti tunnistaa kauden vuoden perusteella. Kauden voi poistaa vasta, kun siinä ei ole tapahtumia, ja sarjan vasta, kun siinä ei ole kausia.</Note>
        </Section>

        <Section id="tapahtumat" title="2. Tapahtumat">
          <p>Tapahtumat hallitaan etusivulla (<b>Tapahtumat</b>). Uuden tapahtuman voi lisätä yksitellen tai koko kauden kerralla Excelillä.</p>
          <Steps items={[
            <>Paina <b>Lisää tapahtuma</b>, valitse kausi ja täytä nimi, paikka, osoite sekä alkamis- ja päättymisaika.</>,
            <>Kartta hakee sijainnin paikan ja osoitteen perusteella. Hienosäädä sijaintia raahaamalla merkkiä tai klikkaamalla karttaa.</>,
            <>Tarkista <b>Maksutavat</b>. Erottele ne puolipisteellä (;). Ne näkyvät ilmoittautumislomakkeen Maksutapa-valikossa.</>,
            <>Uusi tapahtuma tallentuu <b>luonnoksena</b>, eikä se näy julkisella sivulla. Lisää tapahtumalle radat (kohta 3) ja vaihda sen jälkeen <b>Muokkaa</b>-ikkunassa tilaksi <b>Julkaistu</b>.</>,
            <>Ruksi <b>Ilmoittautuminen avoinna</b>, kun ennakkoilmoittautuminen saa alkaa.</>,
          ]} />
          <Definitions items={[["Luonnos", "Näkyy vain ylläpidossa. Tuloksia ei voi tallentaa."], ["Julkaistu", "Näkyy kalenterissa ja PC-clientissä. Tuloksia voi tallentaa."], ["Päättynyt", "Tapahtuma on pidetty. Tulokset näkyvät edelleen."]]} />
          <p><b>Excel:</b> <b>Lataa Excel</b> antaa kaikki tapahtumat taulukkona, ja samaa tiedostoa voi käyttää tuonnin pohjana. <b>Tuo Excel</b> näyttää ensin esikatselun (uudet, päivitettävät ja virheelliset rivit) ja tallentaa vasta vahvistuksen jälkeen. Rivi, jolla on ID, päivittää olemassa olevan tapahtuman, ja tyhjä ID luo uuden. Excelistä puuttuvia tapahtumia ei poisteta.</p>
          <Note>Tapahtuman poistaminen (roskakori) poistaa myös sen radat, ilmoittautumiset ja tulokset pysyvästi.</Note>
        </Section>

        <Section id="radat" title="3. Radat ja XML-tuonti">
          <p>Avaa tapahtuman <b>Radat / XML-tuonti</b>. Radat tarvitaan sekä ilmoittautumiseen että kortin tarkistukseen: luettu kortti verrataan radan rastijärjestykseen.</p>
          <Steps items={[
            <>Vie radat ratasuunnitteluohjelmasta (esim. OCAD tai Purple Pen) muodossa <b>IOF XML 3.0 CourseData</b>.</>,
            <>Valitse tiedosto ja paina <b>Tuo XML</b>. Tuonti lukee radat, rastit ja rastijärjestyksen. Samanniminen rata ja samankoodinen rasti päivitetään, eikä muita tietoja poisteta.</>,
            <>Tarkista jokaisen radan kohdalta <b>Rastikoodit järjestyksessä</b>.</>,
          ]} />
          <p>Radan voi lisätä myös käsin (nimi, pituus km, nousu m, järjestys), mutta silloin radalla ei ole rastijärjestystä eikä kortteja voi tarkistaa automaattisesti.</p>
        </Section>

        <Section id="ilmoittautumiset" title="4. Ilmoittautuminen ja osanottajat">
          <p>Kun tapahtuma on julkaistu ja ilmoittautuminen on avoinna, osallistujat ilmoittautuvat julkisella sivulla (<b>Ilmoittaudu</b>). He valitsevat radan ja maksutavan ja antavat nimen, seuran sekä vapaaehtoiset lisätiedot.</p>
          <p>Tapahtuman <b>Osanottajat</b>-nappi näyttää ilmoittautuneet: nimen, seuran, radan, leimauskortin, maksutavan ja lisätiedot.</p>
          <Note>Ennakkoilmoittautuminen lasketaan kauden osallistumiskerraksi, vaikka henkilöllä ei olisi luettua tulosta (omatoiminen suoritus).</Note>
        </Section>

        <Section id="tapahtumapaiva" title="5. Tapahtumapäivä ja tulokset">
          <p>Maalissa EMIT-kortit luetaan jommallakummalla tavalla:</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><b>PC-client</b> (suositus): toimii myös ilman verkkoyhteyttä ja sisältää paikallisen henkilörekisterin. Katso ohjeet alta.</li>
            <li><b>EMIT-luenta selaimessa</b> (ylävalikko): liitä EMIT 250 -lukija koneeseen, valitse tapahtuma ja paina <b>Yhdistä lukijaan</b>. Toimii vain Chromessa tai Edgessä https-osoitteesta, ja vaatii jatkuvan verkkoyhteyden. Kuittaa jokainen luettu kortti ennen sivun sulkemista.</li>
          </ul>
          <p>Tulokset näkyvät julkisella tulossivulla (kalenteri → tapahtuma → <b>Tulokset</b>) ja päivittyvät automaattisesti sitä mukaa kuin kortteja luetaan.</p>
          <p>Kun tapahtuma on pidetty, vaihda sen tilaksi <b>Päättynyt</b>.</p>
        </Section>

        <Section id="osallistumiskerrat" title="6. Osallistumiskerrat ja palkinnot">
          <Steps items={[
            <>Avaa <b>Osallistumiskerrat</b> ja valitse kausi.</>,
            <>Selvitä ensin <b>Epäselvät merkinnät</b>: sama henkilö voi esiintyä kahdesti eri kirjoitusasulla. Valitse säilytettävä henkilö ja paina <b>Yhdistä valittuun</b>. Merkinnät &quot;Todennäköinen tupla&quot; ovat lähes varmoja, mutta &quot;Samankaltainen&quot; kannattaa tarkistaa.</>,
            <>Taulukko näyttää osallistumiskerrat henkilöittäin. Palkintomerkki tarkoittaa, että henkilö on saavuttanut palkintorajan. Nimeä klikkaamalla näet henkilön tapahtumat ja tulokset.</>,
            <><b>Lataa Excel</b> antaa kaikki kauden osallistumiset (tapahtuma, nimi, seura, maksutapa, rata, aika), esimerkiksi maksujen täsmäytykseen.</>,
          ]} />
        </Section>

        <Section id="lukijalaitteet" title="7. Lukijalaitteet">
          <p>PC-client saa lähettää tuloksia vasta, kun ylläpitäjä on hyväksynyt laitteen. Avaa <b>Lukijalaitteet</b>: uusi laite näkyy tilassa <b>Odottaa hyväksyntää</b> sillä nimellä, jonka client-käyttäjä sille antoi. Paina <b>Hyväksy</b>. Client huomaa hyväksynnän itsestään muutamassa sekunnissa.</p>
          <p>Jos kone katoaa tai vaihtaa käyttäjää, paina <b>Peru pääsy</b>. Laite ei voi sen jälkeen lähettää tuloksia, ennen kuin se rekisteröidään ja hyväksytään uudelleen. <b>Viimeksi käytetty</b> kertoo, milloin laite on viimeksi ottanut yhteyttä.</p>
        </Section>

        <Section id="tili" title="8. Salasana ja kirjautuminen">
          <p>Vaihda salasana ylävalikon <b>Vaihda salasana</b> -toiminnolla. Jos kirjautuminen epäonnistuu liian monta kertaa peräkkäin, kirjautuminen estetään hetkeksi, ja virheilmoitus kertoo odotusajan. Kirjaudu ulos yhteiskäytössä olevalla koneella.</p>
        </Section>
      </div>

      <h2 className="mt-12 mb-4 flex items-center gap-2 text-2xl font-black tracking-tight"><MonitorDown className="size-6 text-primary" />PC-client</h2>
      <p className="mb-4 text-muted-foreground">Kuntorastit PC Client on Windows- ja Linux-koneelle asennettava lukijaohjelma. Se lukee EMIT 250 -lukijaa sarjaportin kautta, tarkistaa kortin radan rasteja vasten ja lähettää tuloksen tulospalveluun. Tulokset tallentuvat ensin koneelle, joten luenta jatkuu, vaikka verkkoyhteys katkeaisi.</p>
      <div className="grid gap-4">
        <Section id="client-asennus" title="1. Asennus">
          {CLIENT_DOWNLOAD_URL ? <p><Button asChild className="rounded-full"><a href={CLIENT_DOWNLOAD_URL} target="_blank" rel="noreferrer"><Download className="mr-2 size-4" />Lataa PC-client</a></Button></p> : <p>Pyydä asennuspaketti järjestelmän ylläpitäjältä.</p>}
          <ul className="ml-5 list-disc space-y-1.5">
            <li><b>Windows:</b> aja <code>…_x64-setup.exe</code> (tai <code>.msi</code>). Jos Windows varoittaa tuntemattomasta julkaisijasta, valitse <b>Lisätietoja → Suorita silti</b>.</li>
            <li><b>Linux:</b> <code>.AppImage</code> (aseta suoritusoikeus), <code>.deb</code> tai <code>.rpm</code>.</li>
            <li>EMIT 250 -lukija tarvitsee USB-sarjaporttiajurin. Jos lukija ei näy porttilistassa, asenna lukijan valmistajan ajuri.</li>
          </ul>
        </Section>

        <Section id="client-kayttoonotto" title="2. Käyttöönotto (kerran per kone)">
          <Steps items={[
            <>Käynnistä ohjelma ja avaa <b>⚙ Asetukset</b>.</>,
            <>Tarkista <b>API-osoite</b>. Sen pitää olla <code className="break-all rounded bg-muted px-1.5 py-0.5">{clientApiBase}</code>. Jos osoite on eri, kirjoita tämä osoite kenttään ja paina <b>Tallenna</b>.</>,
            <>Anna laitteelle kuvaava nimi (esim. &quot;Maalin lukija #1&quot;) ja paina <b>Lähetä hyväksyntäpyyntö</b>.</>,
            <>Ylläpitäjä hyväksyy laitteen kohdassa <b>Lukijalaitteet</b> (ks. web-ohjeen kohta 7). Clientissä lukee sen jälkeen <b>✓ Hyväksytty</b>.</>,
            <>Liitä EMIT-lukija, paina <b>Päivitä portit</b> ja valitse lukijan sarjaportti (Windowsissa esim. COM3).</>,
          ]} />
          <Note>API-osoitteen vaihtaminen unohtaa laitteen hyväksynnän, koska hyväksyntä koskee aina yhtä palvelinta. Lähetä silloin uusi hyväksyntäpyyntö. Osoitetta ei voi vaihtaa tapahtuman ollessa käynnissä.</Note>
        </Section>

        <Section id="client-henkilot" title="3. Henkilörekisteri (HenkilöDB)">
          <p>Client tunnistaa kortin numerosta, kenen kortti on. Tiedot ovat koneen omassa henkilörekisterissä, jota voi selata ja muokata kohdassa <b>👥 HenkilöDB</b> (nimi, seura, kortin numero).</p>
          <ul className="ml-5 list-disc space-y-1.5">
            <li><b>⬆ Tuo CSV</b> tuo henkilöt puolipisteellä erotetusta tiedostosta, jonka sarakkeet ovat <code>Sukunimi;Etunimi;Seura;Kortti</code>. Sarakkeet tunnistetaan otsikkoriviltä. Jos kortin numero on jo rekisterissä, rivi päivittää kyseisen henkilön.</li>
            <li><b>⬇ Vie CSV</b> tallentaa koko rekisterin samassa muodossa. Sillä voi siirtää rekisterin toiselle lukijakoneelle tai ottaa varmuuskopion.</li>
            <li>Uudet osallistujat tallentuvat rekisteriin automaattisesti, kun heidän korttinsa luetaan ensimmäisen kerran.</li>
          </ul>
        </Section>

        <Section id="client-luenta" title="4. Kortin luenta tapahtumapäivänä">
          <Steps items={[
            <>Valitse alasvetovalikosta päivän tapahtuma ja paina <b>Valitse tapahtuma</b>. Listassa näkyvät kuluvan vuoden <b>julkaistut</b> tapahtumat.</>,
            <>Varmista, että tila näyttää <b>Lukija OK</b> ja että tapahtuman radat näkyvät.</>,
            <>Lue kortti lukijassa. Jos kortti on rekisterissä, avautuu <b>Kuittaa lukutulos</b>: nimi, rata, rastit ja aika. Väärä tai puuttuva leima näkyy punaisella.</>,
            <>Kuittaa tulos: <b>Tulos OK</b>, <b>Ilman aikaa</b>, <b>Kuittaa: rasti puuttuu</b> tai <b>Kuittaa hylätty</b>. Nimeä ja seuraa voi korjata samassa ikkunassa.</>,
            <>Jos korttia ei tunneta, avautuu <b>Uusi osallistuja</b>. Täytä nimi ja seura ja paina <b>Tallenna osallistuja</b>, minkä jälkeen kuittaa tulos. <b>Ohita kortti</b> hylkää luennan tallentamatta mitään.</>,
            <>Lopuksi paina <b>Lopeta tapahtuma</b>. Tämä vapauttaa lukijan.</>,
          ]} />
          <Definitions items={[["Hyväksytty", "Rastit ovat radan mukaisessa järjestyksessä."], ["Rasti puuttuu", "Radan rasti puuttuu kortilta."], ["Hylätty", "Leimat eivät vastaa rataa (esim. väärä rata)."], ["Ilman aikaa", "Osallistuminen kirjataan, mutta aikaa ei julkaista."]]} />
        </Section>

        <Section id="client-kasin" title="5. Käsin syötetyt tulokset">
          <p>Paina <b>+ Syötä osanottoja</b>, kun osallistujalla ei ole EMIT-korttia tai luenta epäonnistui. Hae henkilö kirjoittamalla vähintään kolme merkkiä tai kirjoita uuden henkilön nimi. Valitse rata ja anna halutessasi aika (esim. <code>38:42</code>). Ilman aikaa tulos tallentuu merkinnällä &quot;ilman aikaa&quot;.</p>
        </Section>

        <Section id="client-korjaus" title="6. Tulosten korjaaminen">
          <p>Tulokset-taulukko näyttää tapahtuman luetut ja syötetyt tulokset. Hakukentällä voi hakea nimen, seuran tai kortin numeron perusteella. Klikkaa nimeä avataksesi <b>Muokkaa lukutulosta</b>, jossa voit korjata nimen tai seuran tai kuitata tuloksen uudelleen eri tilalla. Korjaus lähetetään tulospalveluun samalla tavalla kuin alkuperäinen tulos.</p>
        </Section>

        <Section id="client-offline" title="7. Kun verkkoyhteys katkeilee">
          <p>Jokainen kuitattu tulos tallentuu ensin koneelle ja lähetetään tulospalveluun heti, kun yhteys toimii. Jos verkko katkeaa, luentaa voi jatkaa normaalisti, ja lähettämättömät tulokset siirtyvät automaattisesti, kun yhteys palaa.</p>
          <Note>Älä poista ohjelmaa äläkä vaihda API-osoitetta, ennen kuin kaikki tulokset ovat näkyneet julkisella tulossivulla.</Note>
        </Section>

        <Section id="client-vianetsinta" title="8. Vianetsintä">
          <Definitions items={[
            ["Tapahtumien haku backendistä epäonnistui", "Tarkista verkkoyhteys ja kohdan ⚙ Asetukset API-osoite. Virheilmoituksen alla näkyy osoite, jota client yrittää käyttää."],
            ["Tapahtuma puuttuu listasta", "Tapahtuma on luonnos tai eri vuodelta. Julkaise tapahtuma ylläpidossa ja paina Yritä uudelleen tai käynnistä client uudelleen."],
            ["Lukija ei yhteydessä", "Tarkista USB-kaapeli ja sarjaportin valinta (⚙ Asetukset → Päivitä portit). Sulje muut ohjelmat, jotka käyttävät samaa porttia."],
            ["Ratadata puuttuu", "Tapahtumalle ei ollut ratoja, kun se valittiin. Tuo radat ylläpidossa, lopeta tapahtuma ja valitse se uudelleen."],
            ["Tulokset eivät näy tulossivulla", "Laitetta ei ole hyväksytty tai sen pääsy on peruttu. Tarkista tila kohdasta ⚙ Asetukset ja ylläpidon Lukijalaitteet-näkymästä."],
          ]} />
        </Section>
      </div>

      <h2 className="mt-12 mb-4 flex items-center gap-2 text-2xl font-black tracking-tight"><Code className="size-6 text-primary" />Avoin lähdekoodi</h2>
      <Section id="lahdekoodi" title="Lähdekoodi ja lisenssi">
        <p>Tulospalvelu ja PC-client ovat avointa lähdekoodia. Kuka tahansa saa käyttää, muokata ja levittää niitä maksutta GNU Affero General Public License v3 -lisenssin (AGPL-3.0) ehdoilla. Lisenssi pitää ohjelmiston vapaana: muokattua versiota levittävän tai verkkopalveluna tarjoavan pitää julkaista muutostensa lähdekoodi samalla lisenssillä.</p>
        <p>Lähdekoodista löytyvät myös asennusohjeet omalle palvelimelle. Virheilmoitukset ja kehitysideat voi kirjata GitHubin Issues-osioon.</p>
        <p><Button asChild variant="outline" className="rounded-full"><a href={SOURCE_URL} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 size-4" />Lähdekoodi GitHubissa</a></Button></p>
      </Section>
    </div>
  </main>;
}

function Toc({ title, items }: { title: string; items: [string, string][] }) {
  return <div><p className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</p><ul className="space-y-1 text-sm">{items.map(([id, label]) => <li key={id}><a href={`#${id}`} className="underline-offset-4 hover:text-primary hover:underline">{label}</a></li>)}</ul></div>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <Card id={id} className="scroll-mt-6 rounded-2xl"><CardContent className="space-y-3 p-5 text-sm leading-6"><h3 className="text-lg font-extrabold">{title}</h3>{children}</CardContent></Card>;
}

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="ml-5 list-decimal space-y-1.5">{items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
}

function Definitions({ items }: { items: [string, string][] }) {
  return <dl className="grid gap-x-4 gap-y-2 rounded-xl border bg-muted/25 p-4 sm:grid-cols-[minmax(0,12rem)_1fr]">{items.map(([term, description]) => <div key={term} className="contents"><dt className="font-semibold">{term}</dt><dd className="text-muted-foreground">{description}</dd></div>)}</dl>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-amber-950">{children}</p>;
}
