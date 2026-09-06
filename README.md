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
- Swagger/OpenAPI-dokumentaatio
- Docker Compose PostgreSQLille ja API:lle
- Tauri-desktop-client EMIT 250 -lukijalle: kortinluku, manuaalinen
  tuloskirjaus, offline-synkronointi ja automaattiset Windows/Linux-buildit
  (ks. [clients/pc-client](clients/pc-client))

Tietomalli tukee tapahtumasarjoja, kausia, tapahtumia, ratoja, rasteja,
henkilöitä, seuroja, ilmoittautumisia, osallistumiskertoja, suorituksia,
leimauksia ja tavoitepalkintoja. Leimauskortti on mallinnettu yleisenä
`PunchCard`-tietona, jotta EMITin rinnalle voidaan lisätä myöhemmin SportIdent.

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
