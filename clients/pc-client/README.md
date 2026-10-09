# Kuntorastit PC Client

Desktop-client (Tauri 2 + React) rastihenkilökunnalle: lukee EMIT 250
-leimauskortteja natiivin sarjaportin kautta Windowsissa, Linuxissa ja
macOS:ssa, ja synkronoi tulokset Kuntorastien REST API:in.

## Ominaisuudet

- listaa käyttöjärjestelmän sarjaportit ja avaa valitun portin EMIT 250
  -asetuksilla (9600 baud, 8 data bits, no parity, 2 stop bits)
- purkaa EMITin XOR-koodatun (0xDF) 217 tavun kehyksen: kortin numero,
  valmistuspäivä ja rastileimat ajoista
- hakee tapahtumakalenterin API:sta tapahtuman käynnistyessä; osallistujat
  luetaan paikallisesta SQLite-henkilörekisteristä (`reader.sqlite3`,
  käyttöjärjestelmän sovellusdatahakemistossa) — clientti ei enää hae
  ilmoittautuneita API:sta, koska tapahtumaan voi osallistua myös
  omatoimisesti ilman ennakkoilmoittautumista
- validoi luetun kortin radan rasteja vasten (hyväksytty / leima puuttuu /
  rasti puuttuu) ja synkronoi tuloksen API:in heti kuittauksen jälkeen
- **HenkilöDB**: paikallisen henkilörekisterin selailu ja muokkaus (nimi,
  seura, kortin numero) suoraan clientistä, kortin numeron
  päällekkäisyystarkistuksella. **Tuo/Vie CSV**-napit tuovat henkilöitä
  puolisen-erotetusta CSV-tiedostosta (sarakkeet `Sukunimi;Etunimi;Seura;Kortti`
  missä tahansa järjestyksessä — tunnistetaan otsikkoriviltä) tai vievät koko
  rekisterin samaan muotoon; tuonti täsmää olemassa oleviin henkilöihin kortin
  numeron perusteella (sama henkilö kahdesti tuotuna päivittää vain nimen/seuran)
- **Syötä osanottoja**: manuaalinen tuloslisäys niille, joilla ei ole
  EMIT-korttia tai lukema epäonnistui — hakuboxi (`Hae henkilöä`) etsii jo
  tunnetuista osallistujista, ja tulokselle voi valinnaisesti syöttää ajan
  käsin (esim. sekuntikellolla otetun ajan); ilman aikaa jätetty tulos
  merkitään "ilman aikaa"
- toimii offline: lukemat ja manuaaliset lisäykset jäävät paikalliseen kantaan
  `PENDING`-tilaan ja synkronoituvat automaattisesti kun API on taas
  tavoitettavissa
- Bearer-token-suojaus API:n lukijakohtaisiin rajapintoihin (ks. alla)

Tämä ei vielä validoi EMITin virallista tarkistussummaa. Nykyinen
kehystunnistus hyväksyy siis vain rakenteellisesti oikean 217 tavun kehyksen.

## Käynnistys (kehitys)

Tarvitset Node.js 22:n, Rustin ja Tauri 2:n käyttöjärjestelmäkohtaiset
prerequisite-paketit (ks. [Taurin ohjeet](https://v2.tauri.app/start/prerequisites/)).

```bash
cd clients/pc-client
npm install
npm run tauri dev
```

Client odottaa API:a osoitteessa `http://localhost:3001/api/v1` — käynnistä
se ensin repon juuresta:
`docker compose -f dev.yml --env-file .env.development up api`.

Osoitteen voi vaihtaa sovelluksen **⚙ Asetukset** -näkymän API-osoite-
kentästä (tallentuu paikalliseen kantaan; **Palauta oletus** palaa buildin
osoitteeseen). Vaihto ei onnistu tapahtuman ollessa käynnissä, ja se unohtaa
laitteen hyväksynnän, koska token on edellisen palvelimen myöntämä:
lähetä hyväksyntäpyyntö uudelle palvelimelle.

## Laitteen hyväksyntä (kirjautuminen)

Lukijan omat rajapinnat (`reader-results`, `manual-results`,
`reader-registrations`, `persons/search`) vaativat hyväksytyn laitteen
bearer-tokenin; julkinen kalenteri ja tulossivu eivät.

Kirjautuminen toimii samalla periaatteella kuin esim. `gh auth login` tai
älytelevision sovelluskirjautuminen:

1. Avaa clientissä **⚙ Lukijan asetukset**, anna laitteelle nimi (esim.
   "Maalin lukija #1") ja paina **Lähetä hyväksyntäpyyntö**.
2. Ylläpitäjä hyväksyy laitteen admin-UI:n **Lukijalaitteet**-näkymästä
   (`/admin` → Lukijalaitteet).
3. Client saa tokenin automaattisesti heti kun se on hyväksytty — se
   tarkistaa tilan taustalla eikä vaadi mitään toimenpiteitä. Halutessaan voi
   painaa **Tarkista nyt** nopeuttaakseen tätä.

Ylläpitäjä näkee kunkin laitteen viimeisimmän käyttöajan ja voi perua
yksittäisen laitteen pääsyn milloin tahansa (**Peru pääsy**) — esim. jos
kannettava katoaa tai vaihtaa käyttäjää. Peruttu laite voi rekisteröityä
uudelleen samalla nimellä ja odottaa uutta hyväksyntää.

## Tuotantobuild

API:n oletusosoite upotetaan buildiin muuttujasta `VITE_API_BASE_URL` (esim.
`https://tulokset.esimerkki.fi/kuntorastit/api/v1`); käyttäjä voi vaihtaa sen
sovelluksen asetuksista, joten sovelluksen Content-Security-Policy sallii
yhteydet mihin tahansa http(s)-osoitteeseen.

Paikallisesti: aseta `VITE_API_BASE_URL` juuren `.env.production`iin (tai
ympäristömuuttujaksi) ja aja `npm run tauri:build` (macOS: `.app`/`.dmg`;
Windows/Linux käyttävät alustan normaaleja pakettityyppejä `.msi`, `.deb`,
`.rpm`, `.AppImage`). `npm run tauri:build -- --dry-run` näyttää vain
käytettävän oletusosoitteen.

GitHub Actions (`.github/workflows/client-build.yml`) buildaa Windows- ja
Linux-versiot käsin käynnistettynä (Actions → Client build → Run
workflow) tai `pc-client-v*`-tagin puskemisesta. Osoite luetaan repositorion muuttujasta `VITE_API_BASE_URL`
(Settings → Secrets and variables → Actions → Variables, tai
`gh variable set VITE_API_BASE_URL --body <osoite>`); ilman sitä build
pysähtyy virheeseen.

Asennuspaketit (`.exe`/`.msi`, `.AppImage`/`.deb`/`.rpm`) julkaistaan
GitHubin **Releases**-osioon:

- käsin käynnistetty ajo `master`-haarassa päivittää esijulkaisun
  **pc-client-latest** (aina uusin build)
- versiojulkaisu: nosta versio (`package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`), commitoi ja puske tagi, esim.
  `git tag pc-client-v0.2.0 && git push origin pc-client-v0.2.0` — tagin
  pitää vastata `tauri.conf.json`:n versiota

Kaikki bundle-tiedostot löytyvät lisäksi ajon liitteistä (artifacts).

## Testidatan generointi

`tools/generate_dummy.py` lisää satunnaisia osallistujia paikalliseen
SQLite-kantaan, jotta korttihakua ja "Syötä osanottoja" -hakuboxia voi
testata ilman oikeita ilmoittautumisia:

```bash
python3 tools/generate_dummy.py                    # 100 osallistujaa oletus-DB:hen
python3 tools/generate_dummy.py --count 20 --seed 1 # toistettava pienempi erä
python3 tools/generate_dummy.py --event-id <uuid> --course-id <uuid>  # sido tapahtumaan/rataan
```

## Fyysisen sarjaportin korttiemulaattori

Skripti kirjoittaa EMIT-kehykset fyysiseen sarjaporttiin. Anna portti
`--port`-valitsimella (oletus on `/dev/cu.usbserial-FTDBLBY5`):

```bash
python3 tools/emulate_emit250.py --port /dev/cu.usbserial-FTDBLBY5 --card 123456
```

Yliopistokeskus-sprintin A-radalle on kaksi valmista yhden kortin testiä:

```bash
python3 tools/emulate_emit250.py --scenario a-hyvaksytty --once
python3 tools/emulate_emit250.py --scenario a-hylatty --once
```

Hyväksytty käyttää korttia `123456` ja A-radan koodeja
`31–32–33–31–34–35–31–100`. Hylätty käyttää korttia `654321` ja korvaa
rastin `33` väärällä koodilla `99`.

Halkokari 2026 -tapahtuman E-radalle on kaksi kortin `32012` testiä:

```bash
python3 tools/emulate_emit250.py --scenario halkokari-e-hyvaksytty --once
python3 tools/emulate_emit250.py --scenario halkokari-e-hylatty --once
```

Hyväksytty käyttää E-radan koodeja
`137–38–158–138–41–45–141–40–43–157–44–78–32–50`. Hylätyssä rastin
`158` tilalla on väärä koodi `99`.

Valitse sama portti clientissä ja käynnistä kuuntelu. Oletuksena sama kortti
lähetetään kolmen sekunnin välein; yhden kehyksen testin saa komennolla `--once`.

Emulaattori tuottaa 217 tavun XOR-kehyksen. Se ei emuloi vielä EMITin
virallista tarkistussummaa tai täydellistä kilpailukortin sisältöä.

## Koko tapahtuman simulointi

`tools/simulate.py` arpoo paikallisesta henkilörekisteristä (samasta
`reader.sqlite3`:sta kuin HenkilöDB) satunnaisen joukon oikeita kortin
numeroita, jakaa jokaiselle satunnaisen radan valitusta tapahtumasta
(radan oikeat rastikoodit haetaan julkisesta kalenteri-API:sta) ja lähettää
yhden EMIT-kehyksen per kilpailija sarjaporttiin annetuin väliajoin — hyvä
tapa kuormittaa/demota koko sovellus (lukija → validointi → API-synkka)
ilman 100 oikeaa leimausta:

```bash
python3 tools/simulate.py --list-events
python3 tools/simulate.py --event-id <uuid> --port /dev/cu.usbserial-FTDBLBY5
```

Oletuksena 100 kilpailijaa, 10 sekunnin väli ja 5 % osuus tahallisesti
väärällä rastikoodilla (näkyy clientissä "leima puuttuu"/"rasti puuttuu"
-tuloksena). Yleisimmät valitsimet: `--count`, `--interval`,
`--disqualify-rate`, `--seed` (toistettava arvonta), `--loop` (jatka uudella
arvonnalla loppumatta), `--db` (jos `reader.sqlite3` ei ole oletuspaikassa)
ja `--api` (jos API ei ole `localhost:3001`:ssä).

Ilman toista fyysistä sarjaporttiparia voi käyttää virtuaalista paria (macOS/
Linux, vaatii `socat`:

```bash
socat -d -d pty,raw,echo=0,link=/tmp/emit-a pty,raw,echo=0,link=/tmp/emit-b
```

Valitse clientissä portiksi `/tmp/emit-b` ja anna simulaattorille `--port
/tmp/emit-a`.

## FTDI-kaapeliyhteyden testaus

Kahden ristiinkytketyn FTDI-portin voi testata ilman clientiä:

```bash
python3 tools/test_serial_link.py \
  /dev/cu.usbserial-FTDBLBY5 \
  /dev/cu.usbserial-FTF62W0Y
```

Testi lähettää tunnisteet molempiin suuntiin ja raportoi `OK`, jos ne palaavat
toiselle portille. Molemmat suunnat sekä yhteinen GND on kytkettävä.

Käyttäjällä pitää olla oikeus sarjaporttiin (tyypillisesti `/dev/ttyUSB*` tai
`/dev/ttyACM*`). Jakelusta riippuen tämä tarkoittaa esimerkiksi jäsenyyttä
`dialout`-ryhmässä tai udev-sääntöä.

## Seuraavaksi

EMIT 250:n virallinen tarkistussumma ja täysi rastikoodien validointi, sekä
yleinen `PunchCardReader`-rajapinta muille leimausjärjestelmille (esim.
SportIdent).
