# Maanantairastien tulospalvelu

Kokkolan maanantairastien uusi tulospalvelu. Kokonaisuus sisältää julkisen
kalenterin ja tulosnäkymän, TypeScript/NestJS REST API:n, PostgreSQL-tietomallin
sekä myöhemmin toteutettavan Electron-clientin EMIT 250 -kortinlukua varten.

## Nykyinen toteutus

- responsiivinen julkinen tapahtuma- ja tulosnäkymä
- NestJS + Fastify API
- Prisma + PostgreSQL -tietomalli
- tapahtumien listaus-, haku- ja luontirajapinnat
- Swagger/OpenAPI-dokumentaatio
- Docker Compose PostgreSQLille ja API:lle

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

API käynnistyy osoitteeseen `http://localhost:3001/api/v1` ja Swagger-
dokumentaatio osoitteeseen `http://localhost:3001/api/docs`.

API erikseen:

```bash
cd services/api
npm install
npm run prisma:generate
npm run build
npm run dev
```

Kopioi tarvittaessa `services/api/.env.example` tiedostoksi `.env`.

## Keskeiset hakemistot

```text
app/                         Julkinen web-käyttöliittymä
services/api/src/            NestJS REST API
services/api/prisma/         PostgreSQL/Prisma-tietomalli
components/ui/               Käyttöliittymäkomponentit
compose.api.yaml              Paikallinen API ja PostgreSQL
```

## Seuraavat vaiheet

1. Ensimmäinen tietokantamigraatio ja seed-data.
2. Julkisen kalenterin yhdistäminen REST API:in.
3. Ilmoittautuminen ja ylläpitäjän tapahtumahallinta.
4. Electron-client, SQLite-offline-tallennus ja synkronointi.
5. EMIT 250 -lukijaintegraatio ja tuloslaskenta.
