# EMIT 250 / Tauri proof of concept

Tämän kokeen tarkoitus on varmistaa, että Maanantairastien desktop-client voidaan toteuttaa Tauri 2:lla siten, että EMIT 250 -lukija toimii natiivin sarjaportin kautta sekä Windowsissa että Linuxissa ilman WebSerial-riippuvuutta.

## Mitä PoC tekee

- listaa käyttöjärjestelmän sarjaportit ja USB VID/PID -tiedot
- avaa valitun portin EMIT 250 -asetuksilla: 9600 baud, 8 data bits, no parity, 2 stop bits
- lukee raakadataa 15 sekunnin ajan
- tekee EMITin käyttämän XOR-muunnoksen (0xDF)
- etsii 217 tavun EMIT 250 -kehyksen
- näyttää kortin numeron, jos kokonainen kehys löytyy

Tämä ei vielä validoi tarkistussummia eikä pura rasteja/aikoja. Ne lisätään vasta kun fyysisellä lukijalla on varmistettu, että sarjaporttikerros toimii.

## Käynnistys

Tarvitset Node.js:n, Rustin ja Tauri 2:n käyttöjärjestelmäkohtaiset prerequisite-paketit.

```bash
cd clients/reader-poc
npm install
npm run tauri dev
```

Liitä EMIT 250 USB:llä, valitse listasta oikea portti, paina **Testaa EMIT 250** ja aseta kortti lukijaan 15 sekunnin testijakson aikana.

## Linux

Käyttäjällä pitää olla oikeus sarjaporttiin (tyypillisesti `/dev/ttyUSB*` tai `/dev/ttyACM*`). Jakelusta riippuen tämä tarkoittaa esimerkiksi jäsenyyttä `dialout`-ryhmässä tai udev-sääntöä.

## Onnistumiskriteeri

PoC hyväksytään, kun samalla lähdekoodilla:

1. EMIT 250 näkyy porttilistassa Windowsissa.
2. Kortin numero saadaan luettua Windowsissa.
3. EMIT 250 näkyy porttilistassa Linuxissa.
4. Kortin numero saadaan luettua Linuxissa.

Tämän jälkeen seuraava vaihe on siirtää EMIT 250:n täysi parseri Rustiin ja tehdä yleinen `PunchCardReader`-rajapinta.
