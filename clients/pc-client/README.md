# Kuntorastit PC Client

Desktop-client (Tauri 2 + React) rastihenkilökunnalle: lukee EMIT 250
-leimauskortteja natiivin sarjaportin kautta Windowsissa, Linuxissa ja
macOS:ssa, ja synkronoi tulokset Kuntorastien REST API:in.

## Ominaisuudet

- listaa käyttöjärjestelmän sarjaportit ja avaa valitun portin EMIT 250
  -asetuksilla (9600 baud, 8 data bits, no parity, 2 stop bits)
- purkaa EMITin XOR-koodatun (0xDF) 217 tavun kehyksen: kortin numero,
  valmistuspäivä ja rastileimat ajoista
- hakee tapahtumakalenterin ja ilmoittautuneet API:sta tapahtuman
  käynnistyessä, ja tallentaa ne paikalliseen SQLite-tietokantaan
  (`reader.sqlite3`, käyttöjärjestelmän sovellusdatahakemistossa)
- validoi luetun kortin radan rasteja vasten (hyväksytty / hylätty / rasti
  puuttuu) ja synkronoi tuloksen API:in heti kuittauksen jälkeen
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
se ensin repon juuresta: `docker compose -f compose.api.yaml up --build`.

## Laitteen hyväksyntä (kirjautuminen)

Lukijan omat rajapinnat (`reader-results`, `manual-results`,
`reader-registrations`, `persons/search`) vaativat hyväksytyn laitteen
bearer-tokenin; julkinen kalenteri ja tulossivu eivät.

Kirjautuminen toimii samalla periaatteella kuin esim. `gh auth login` tai
älytelevision sovelluskirjautuminen:

1. Avaa clientissä **⚙ Lukijan asetukset**, anna laitteelle nimi (esim.
   "Kokkolan lukija #1") ja paina **Lähetä hyväksyntäpyyntö**.
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

Paikallisesti: `npm run tauri build` (macOS: `.app`/`.dmg`; Windows/Linux
käyttävät alustan normaaleja pakettityyppejä `.msi`, `.deb`, `.rpm`,
`.AppImage`).

GitHub Actions (`.github/workflows/client-build.yml`) buildaa Windows- ja
Linux-versiot automaattisesti jokaisesta pushista/PR:stä jotka koskettavat
tätä hakemistoa, sekä manuaalisesti ajettuna (`workflow_dispatch`). Buildit
löytyvät ajon liitteistä (artifacts) Actions-välilehdeltä.

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
