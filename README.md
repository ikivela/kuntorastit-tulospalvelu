# KoS-Kuntorastit

Kokkolan Suunnistajien kuntorastien tulospalvelu (tapahtumat eivät ole enää
vain maanantaisin). Kokonaisuus sisältää julkisen kalenterin ja tulosnäkymän,
ylläpitäjän tapahtumahallinnan, TypeScript/NestJS REST API:n, PostgreSQL-
tietomallin sekä Tauri-pohjaisen desktop-clientin EMIT 250 -kortinlukua ja
tuloskirjausta varten.

## Nykyinen toteutus

- responsiivinen julkinen tapahtuma- ja tulosnäkymä
- ylläpitäjän kirjautuminen, tapahtuma-/ratahallinta ja lukijalaitteiden
  hyväksyntä (`app/admin`)
- NestJS + Fastify API, Bearer-token-suojaus admin- ja lukijarajapinnoille;
  lukijaclientit rekisteröityvät ja odottavat ylläpitäjän hyväksyntää ennen
  tokenin saamista
- Prisma + PostgreSQL -tietomalli, tietokantamigraatiot
- tapahtumien listaus-, haku-, luonti- ja ilmoittautumisrajapinnat
- tulossivulla ero kärkeen, min/km-vauhti ja osallistumiskerrat (myös
  omatoimiset, ajattomat osallistumiset lasketaan mukaan)
- osallistumiskerrat-näkymä ylläpidossa Excel-vientinä (tapahtuma, ilmoittau-
  tumis-/luenta-aika, nimi, seura, maksutapa, rata, aika)
- tapahtuman sijainti kartalla (Leaflet + OpenStreetMap), osoitteesta
  automaattisesti haettuna (Nominatim)
- Swagger/OpenAPI-dokumentaatio
- Docker Compose PostgreSQLille ja API:lle
- Tauri-desktop-client EMIT 250 -lukijalle: kortinluku, manuaalinen
  tuloskirjaus, offline-synkronointi, paikallinen henkilörekisteri
  selailu-/muokkausikkunalla ("HenkilöDB") ja automaattiset Windows/Linux-
  buildit (ks. [clients/pc-client](clients/pc-client))

Tietomalli tukee tapahtumasarjoja, kausia, tapahtumia, ratoja, rasteja,
henkilöitä, seuroja, ilmoittautumisia, osallistumiskertoja, suorituksia,
leimauksia ja tavoitepalkintoja. Leimauskortti on mallinnettu yleisenä
`PunchCard`-tietona, jotta EMITin rinnalle voidaan lisätä myöhemmin SportIdent.

## Käyttöohjeet

### Julkinen sivusto

- **Etusivu** (`/`) listaa tulevat tapahtumat. "Ilmoittaudu" avaa
  ilmoittautumislomakkeen modaalina; "Tulokset" vie tapahtuman tulossivulle.
- **Kalenteri** (`/kalenteri`) näyttää kaikki tapahtumat ja ilmoittautumiset
  kootusti.
- **Tulossivu** (`/tulokset/[tapahtuma]`) näyttää sarjoittain ajat, eron
  kärkeen, min/km-vauhdin ja osallistumiskerrat. Leimaus, joka ei täsmää
  radan rasteihin, näkyy tulostilana "Leima puuttuu".
- Ilmoittautuminen ei vaadi EMIT-korttia: tapahtumaan voi osallistua myös
  **omatoimisesti** (omalla ajalla) pelkällä ilmoittautumisella — nimeä ei
  tällöin näy tulosjulkaisussa, mutta osallistumiskerta lasketaan silti
  mukaan.

### Ylläpito (`/admin`)

- Kirjaudu sisään oletustunnuksilla **admin / mara2026** (seed-data, ks.
  alla) — vaihda salasana ennen tuotantokäyttöä (ks. "Tuotantoon vieminen").
- **Tapahtumat**: luo/muokkaa tapahtumia, ratoja ja sijaintia. Osoitekenttä
  hakee kartalle sijainnin automaattisesti (voi myös raahata merkkiä käsin).
  Kortin alla näkyy "*n* tulosta · *m* ilmoittautunutta"; **Osanottajat**-
  nappi avaa ilmoittautuneiden hallinnan.
- **Lukijalaitteet**: jokainen pc-client rekisteröityy itse ja jää
  odottamaan hyväksyntää tässä näkymässä ennen kuin se saa API-tokenin.
  Peru pääsy tästä samasta näkymästä tarvittaessa (esim. kannettava katoaa).
- **Osallistumiskerrat**: henkilöittäinen historia kaudelta, sisältäen
  omatoimiset osallistumiset omana rivinään. **Lataa Excel** -nappi vie koko
  listan (tapahtuma, ilmoittautumis-/luenta-aika, nimi, seura, maksutapa,
  rata, aika) yhtenä `.xlsx`-tiedostona.

### Lukijaclient tapahtumapäivänä (pc-client)

Asenna/käynnistä client kannettavalla tai maalitoimiston koneella, valitse
päivän tapahtuma ja hyväksytä laite kerran ylläpidon Lukijalaitteet-
näkymästä (ks. tarkemmin [clients/pc-client/README.md](clients/pc-client/README.md#laitteen-hyväksyntä-kirjautuminen)).
Käytön aikana:

- **⚙ Asetukset** valitsee sarjaportin EMIT-lukijalle.
- **👥 HenkilöDB** avaa paikallisen henkilörekisterin selailuun ja
  muokkaukseen (nimi, seura, kortin numero) — hyödyllinen esim. virheellisen
  kortti-ilmoittautumisen korjaamiseen kesken tapahtuman. **Tuo/Vie CSV**
  -napeilla koko rekisterin voi tuoda toiselta koneelta tai varmuuskopioida.
- Kortinluvut kirjautuvat lokiin reaaliajassa ja synkronoituvat API:in heti;
  jos yhteys katkeaa, lukemat jäävät `PENDING`-tilaan ja synkronoituvat
  automaattisesti yhteyden palattua.
- **+ Syötä osanottoja** manuaaliseen tulokseen niille, joilla ei ole
  EMIT-korttia tai lukema epäonnistui.

## Web-käyttöliittymä

Vaatimuksena on Node.js 22 tai uudempi.

```bash
npm install
npm run dev
```

Testit:

```bash
npm test
```

## API ja PostgreSQL

Koko kehitysympäristö:

```bash
docker compose -f compose.api.yaml up --build
```

Tietokannan ja API:n asetukset (`POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `DATABASE_URL`, `PORT`, `ADMIN_TOKEN_SECRET`) luetaan
juuren `.env`-tiedostosta (ks. `.env.example`); Docker Compose lukee sen
automaattisesti.

API käynnistyy osoitteeseen `http://localhost:3001/api/v1` ja Swagger-
dokumentaatio osoitteeseen `http://localhost:3001/api/docs`.

API erikseen (ilman Dockeria):

```bash
cd services/api
npm install
npm run prisma:generate
npm run build
npm run dev
```

Kopioi tällöin `services/api/.env.example` tiedostoksi `.env` (samat
muuttujat kuin juuren `.env`:ssä, mutta `DATABASE_URL`:n host on
`localhost` eikä `postgres`).

Alustusdata (mm. ylläpitäjätunnus `admin` / `mara2026`) syntyy migraatioiden
jälkeen komennolla:

```bash
cd services/api
npm run prisma:seed
```

## Tuotantoon vieminen

Web-käyttöliittymä (`npm run build && npm run start`, portti 3000 oletuksena)
ja API (`services/api`, portti 3001) ajetaan kahtena erillisenä prosessina
samalla palvelimella; niiden eteen laitetaan nginx yhdeksi julkiseksi
osoitteeksi. Web-käyttöliittymä kutsuu API:a suhteellisella polulla
`/api/v1/...`, joten API:n reverse proxy -sijainti on pidettävä juuressa
riippumatta siitä, missä polussa itse käyttöliittymä on.

### Koko domain (esim. `tulokset.esimerkki.fi`)

```nginx
server {
    listen 443 ssl;
    server_name tulokset.esimerkki.fi;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Web-käyttöliittymä alipolussa (esim. seuran olemassa olevan sivuston alla, `esimerkki.fi/kuntorastit/`)

API pidetään edelleen juuressa (`/api/`), koska käyttöliittymän oma koodi
kutsuu sitä juuripolusta riippumatta alipolusta. Vain käyttöliittymän oma
sijainti siirtyy:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /kuntorastit/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Huomioita alipolkuratkaisusta:

- Kauttaviivat `/kuntorastit/`-lohkon molemmissa päissä (sekä `location`- että
  `proxy_pass`-riveillä) ovat tärkeitä — ne saavat nginxin poistamaan
  `/kuntorastit/`-etuliitteen ennen pyynnön välittämistä eteenpäin, jolloin
  käyttöliittymä ei itse tarvitse tietää ajavansa alipolussa.
- Käyttöliittymän build (`npm run build`) upottaa staattisten resurssien
  (JS/CSS) polut valmiiksi HTML:ään Viten `base`-asetuksen mukaan. Jos sivu
  näyttää lataavan tyhjänä tai konsolissa näkyy 404-virheitä resursseille,
  aseta `vite.config.ts`:ään `base: "/kuntorastit/"` ja tee build uudelleen
  ennen kuin otat alipolkuratkaisun tuotantoon — tätä ei ole vielä testattu
  päästä päähän vinext + Cloudflare Workers -ympäristössä, joten kannattaa
  varmistaa yksittäisen sivun lataus selaimen kehitystyökaluilla käyttöönoton
  yhteydessä.
- Yksinkertaisin ja varmatoimisin vaihtoehto on oma (ali)domain
  (`tulokset.esimerkki.fi`) alipolun sijaan — silloin yllä olevaa
  `base`-huomiota ei tarvitse miettiä lainkaan.

### pc-client tuotanto-API:a vasten

pc-client lukee API:n osoitteen build-aikaisesta `VITE_API_BASE_URL`-
muuttujasta (ks. juuren `.env.example`) ja upottaa sen buildattuun
sovellukseen — sitä ei voi enää muuttaa asennuksen jälkeen. Aseta se
julkisesti tavoitettavaan osoitteeseen (esim.
`https://tulokset.esimerkki.fi/api/v1`) ennen kuin buildaat clientin
jaettavaksi tapahtumapaikoille; oletusarvo `http://localhost:3001/api/v1`
toimii vain paikallisessa kehityksessä.

## Keskeiset hakemistot

```text
app/                     Julkinen web-käyttöliittymä ja admin (Next.js)
services/api/src/        NestJS REST API
services/api/prisma/     PostgreSQL/Prisma-tietomalli
clients/pc-client/       Tauri-desktop-client EMIT 250 -lukijalle
components/ui/           Käyttöliittymäkomponentit
compose.api.yaml         Paikallinen API ja PostgreSQL
.github/workflows/       CI: clientin Windows/Linux-buildit
```

## Tunnetut rajoitukset ja seuraavat vaiheet

- EMIT 250:n virallinen tarkistussumma ja täysi rastikoodien validointi
  puuttuu vielä (ks. clientin README).
- Muiden leimausjärjestelmien (esim. SportIdent) tuki tietomalli sallii
  (`PunchCard`), mutta clientissä on toteutettu vain EMIT 250.
- Web-käyttöliittymä kutsuu API:a suhteellisella polulla `/api/v1` (samasta
  originista); jos API halutaan täysin eri domainiin ilman reverse proxya,
  osoite pitää tehdä konfiguroitavaksi (esim. ympäristömuuttujalla) — tätä ei
  ole vielä toteutettu.
- Alipolkuun (`/kuntorastit/`) deployaus vaatii lisäksi Viten
  `base`-asetuksen (ks. "Tuotantoon vieminen"), jota ei ole vielä testattu
  päästä päähän tässä vinext + Cloudflare Workers -ympäristössä.
