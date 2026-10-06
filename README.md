# Kuntorastit

Kuntorastien tulospalvelu. Kokonaisuus sisältää julkisen kalenterin ja tulosnäkymän,
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

- Kirjaudu sisään tunnuksella **admin**. Kehitysympäristössä oletussalasana
  on `mara2026`; tuotannossa salasana asetetaan ensimmäisellä käynnistyksellä
  muuttujalla `ADMIN_INITIAL_PASSWORD` (oletussalasanaa ei hyväksytä).
  Salasanan voi vaihtaa ylläpidon **Vaihda salasana** -napista (vähintään
  12 merkkiä). Viisi epäonnistunutta kirjautumista samasta osoitteesta
  estää uudet yritykset 15 minuutiksi.
- **Tapahtumat**: luo/muokkaa tapahtumia, ratoja ja sijaintia. Osoitekenttä
  hakee kartalle sijainnin automaattisesti (voi myös raahata merkkiä käsin).
  Kortin alla näkyy "*n* tulosta · *m* ilmoittautunutta"; **Osanottajat**-
  nappi avaa ilmoittautuneiden hallinnan.
- **Lataa Excel / Tuo Excel**: tapahtumat voi viedä Exceliin (yksi rivi =
  yksi tapahtuma), muokata siellä ja tuoda takaisin. Rivi, jolla on ID,
  päivittää kyseisen tapahtuman; tyhjä ID luo uuden. Tuonti näyttää ensin
  esikatselun (uudet, päivitettävät ja muuttuneet kentät) ja virheet
  rivinumeroineen; mitään ei tallenneta ennen vahvistusta, ja jos yksikin rivi
  on virheellinen, koko tuonti hylätään. Excelistä puuttuvia tapahtumia ei
  poisteta. Tiedoston "Ohje"-välilehdellä on sarakkeiden kuvaus.
- **EMIT-luenta** (tapahtumakortin nappi): lukee EMIT 250 -kortit suoraan
  selaimesta Web Serialilla ilman pc-clientiä. Liitä lukija koneeseen, paina
  "Yhdistä lukijaan" ja valitse sarjaportti. Kortin haltija haetaan aiempien
  luentojen/ilmoittautumisten perusteella, rata ja tulos (OK / rasti puuttuu /
  hylätty) päätellään leimoista samoin kuin pc-clientissä, ja tulos
  tallennetaan kuittauksella. Vaatii Chromen tai Edgen tietokoneella sekä
  suojatun yhteyden (https:// tai localhost). Toisin kuin pc-client, selain
  ei toimi offline-tilassa.
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
cp .env.development.example .env.development
docker compose -f compose.api.yaml --env-file .env.development up --build
```

Asetukset ovat kahdessa tiedostossa, joissa on samat muuttujien nimet:
`.env.development` (kehitys) ja `.env.production` (tuotanto); pohjat
`*.example`-tiedostoissa. Web-käyttöliittymä (Vite/vinext) ja pc-client
lataavat automaattisesti `.env.development`in `npm run dev`:ssä ja
`.env.production`in buildissa. Docker Composelle tiedosto annetaan
`--env-file`-valitsimella.

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
muuttujat kuin juuren `.env.development`:ssa, mutta `DATABASE_URL`:n host on
`localhost` eikä `postgres`).

Alustusdata (mm. ylläpitäjätunnus `admin`, kehityksessä salasana `mara2026`) syntyy migraatioiden
jälkeen komennolla:

```bash
cd services/api
npm run prisma:seed
```

## Tuotantoon vieminen

### Docker Compose (`prod.yml`)

Valmis tuotantokokoonpano: PostgreSQL, API, web-käyttöliittymä ja nginx-
gateway, joka tarjoilee koko sovelluksen yhdestä portista. Kaikki asetukset
(portit, alipolku, salasanat, image-tagit) tulevat env-tiedostosta:

```bash
cp docker-compose.example.yml prod.yml
cp .env.production.example .env.production   # aseta vähintään POSTGRES_PASSWORD ja ADMIN_TOKEN_SECRET
docker compose -f prod.yml --env-file .env.production up -d --build
```

- `NEXT_PUBLIC_BASE_PATH` (esim. `/kuntorastit`) asettaa alipolun kerralla
  web-käyttöliittymälle, API:lle (`<polku>/api/v1`), Swaggerille
  (`<polku>/api/docs`) ja gatewaylle. Se upotetaan web-buildiin, joten
  muutoksen jälkeen aja `up -d --build`.
- Seurakohtaiset tiedot asetetaan `NEXT_PUBLIC_*`-muuttujilla: sivuston ja
  seuran nimi (`SITE_NAME`, `CLUB_NAME`), logo ja favicon (`LOGO_URL`,
  `FAVICON_URL`), kartan oletuskeskipiste ja paikkakunta (`MAP_CENTER`,
  `DEFAULT_CITY`) sekä oletusmaksutavat ja ilmoittautumisen ohjeteksti
  (`DEFAULT_PAYMENT_METHODS`, `PAYMENT_HINT`). Seuran kuvat kopioidaan
  kansioon `public/brand/` (gitignoressa) ennen buildia, esim.
  `NEXT_PUBLIC_LOGO_URL=/brand/logo.png`. Ilman asetuksia käytetään
  neutraaleja oletuksia.
- `GATEWAY_PORT` on julkinen portti. Web, API ja PostgreSQL ovat lisäksi
  suoraan saatavilla omista porteistaan (`*_EXTERNAL_PORT`), oletuksena vain
  palvelimelta itseltään (`*_BIND_ADDRESS=127.0.0.1`).
- TLS (https) hoidetaan gatewayn edessä, esim. palvelimen omalla nginxillä,
  joka välittää alipolun sellaisenaan gatewaylle.
- Ohjaa liikenne alipolkuasennuksessa aina gatewayn kautta, älä suoraan
  web-konttiin: vinext 0.0.50:n tuotantopalvelin tarjoilee build-assetit
  vain polusta `/assets/`, ja gateway kääntää `<polku>/assets/`-pyynnöt
  sinne (ks. `deploy/nginx/default.conf.template`).
- pc-clientin `VITE_API_BASE_URL` on silloin
  `https://<domain><BASE_PATH>/api/v1`.

Alla olevat käsin tehtävät nginx-ohjeet koskevat asennusta ilman Dockeria.


Web-käyttöliittymä (`npm run build && npm run start`, portti 3000 oletuksena)
ja API (`services/api`, portti 3001) ajetaan kahtena erillisenä prosessina
samalla palvelimella; niiden eteen laitetaan nginx yhdeksi julkiseksi
osoitteeksi. Web-käyttöliittymä kutsuu API:a oletuksena suhteellisella polulla
`<alipolku>/api/v1/...` (juuriasennuksessa `/api/v1/...`).

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

Alipolku asetetaan build-aikaisella muuttujalla `NEXT_PUBLIC_BASE_PATH`
(`.env.production` / `.env.development`). Se välitetään Next/vinextin `basePath`-asetukseksi
(`next.config.ts`), joten kaikki sivut, linkit, kuvat, faviconit ja JS/CSS-
resurssit tarjoillaan alipolun alta:

```bash
NEXT_PUBLIC_BASE_PATH=/kuntorastit npm run build
```

Käyttöliittymä kutsuu oletuksena API:a samasta alipolusta
(`/kuntorastit/api/v1`). Jos API on muualla (toinen polku tai domain), aseta
`NEXT_PUBLIC_API_BASE_URL` (esim. `/api/v1` tai
`https://api.esimerkki.fi/api/v1`) ennen buildia.

nginx välittää alipolun **sellaisenaan** käyttöliittymälle (ei etuliitteen
poistoa, eli `proxy_pass`-rivillä ei polkua), koska sovellus odottaa
`/kuntorastit/`-etuliitteen olevan pyynnöissä. API:n osalta etuliite
poistetaan, jolloin API pysyy oletusprefiksissään `/api/v1`:

```nginx
location /kuntorastit/api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /kuntorastit/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Vaihtoehtoisesti API:n prefiksin voi muuttaa itse API:ssa ympäristö-
muuttujilla `API_PREFIX` (oletus `api/v1`, esim. `kuntorastit/api/v1`) ja
`API_DOCS_PATH` (oletus `api/docs`), jolloin nginx voi välittää API-polun
ilman uudelleenkirjoitusta.

Huomioita:

- `NEXT_PUBLIC_BASE_PATH` upotetaan buildiin — sen muuttaminen vaatii uuden
  buildin.
- Kehityspalvelin (`npm run dev`) noudattaa samaa asetusta: sivu löytyy
  osoitteesta `http://localhost:5173/kuntorastit/`, ja Viten proxy välittää
  `/kuntorastit/api`-kutsut API:n `/api`-polkuun.
- Linkkejä lisätessä käytä `withBasePath("/polku")` (`lib/site.ts`) tavallisissa
  `<a href>`-, `<img src>`- ja `window.location`-poluissa; `next/link` ja
  `next/navigation`in router lisäävät etuliitteen itse.

### pc-client tuotanto-API:a vasten

pc-client lukee API:n osoitteen build-aikaisesta `VITE_API_BASE_URL`-
muuttujasta (`.env.production` tuotantobuildissa, `.env.development`
kehityksessä) ja upottaa sen buildattuun
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
- Alipolkuasennus (`NEXT_PUBLIC_BASE_PATH`) on testattu buildin ja
  palvelinrenderöinnin tasolla, mutta ei vielä oikean nginxin takana.
