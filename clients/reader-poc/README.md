# EMIT 250 / Tauri proof of concept

Tämän kokeen tarkoitus on varmistaa, että Maanantairastien desktop-client voidaan toteuttaa Tauri 2:lla siten, että EMIT 250 -lukija toimii natiivin sarjaportin kautta sekä Windowsissa että Linuxissa ilman WebSerial-riippuvuutta.

## Mitä PoC tekee

- listaa käyttöjärjestelmän sarjaportit ja USB VID/PID -tiedot
- avaa valitun portin EMIT 250 -asetuksilla: 9600 baud, 8 data bits, no parity, 2 stop bits
- kuuntelee raakadataa jatkuvasti, kunnes käyttäjä lopettaa kuuntelun
- tekee EMITin käyttämän XOR-muunnoksen (0xDF)
- etsii 217 tavun EMIT 250 -kehyksen
- näyttää kortin numeron, jos kokonainen kehys löytyy

Tämä ei vielä validoi tarkistussummia eikä pura rasteja/aikoja. Nykyinen kehystunnistus osoittaa siksi vain mahdollisen EMIT 250 -kehyksen. Täysi validointi lisätään, kun fyysisellä lukijalla saatuja näytteitä on käytettävissä.

## Käynnistys

Tarvitset Node.js:n, Rustin ja Tauri 2:n käyttöjärjestelmäkohtaiset prerequisite-paketit.

```bash
cd clients/reader-poc
npm install
npm run tauri dev
```

Tuotantobuild tehdään komennolla `npm run tauri build`. macOS:ssa tuloksena on `.app`; Windowsissa ja Linuxissa Tauri käyttää alustan normaaleja pakettityyppejä.

Liitä EMIT 250 USB:llä, valitse listasta oikea portti, paina **Käynnistä kuuntelu**, aseta kortti lukijaan ja lopeta kuuntelu **Lopeta kuuntelu** -painikkeella.

## Fyysisen sarjaportin korttiemulaattori

Skripti kirjoittaa EMIT-kehykset fyysiseen sarjaporttiin. Anna portti
`--port`-valitsimella (oletus on `/dev/cu.usbserial-FTDBLBY5`):

```bash
python3 tools/emulate_emit250.py --port /dev/cu.usbserial-FTDBLBY5 --card 123456
```

Valitse sama portti Reader PoC:ssa ja käynnistä kuuntelu. Oletuksena sama kortti
lähetetään kolmen sekunnin välein; yhden kehyksen testin saa komennolla `--once`.

Emulaattori tuottaa tämän PoC:n 217 tavun XOR-kehyksen. Se ei emuloi vielä EMITin virallista tarkistussummaa tai täydellistä kilpailukortin sisältöä.

## Linux

## FTDI-kaapeliyhteyden testaus

Kahden ristiinkytketyn FTDI-portin voi testata ilman Reader PoC -clientiä:

```bash
python3 tools/test_serial_link.py \
  /dev/cu.usbserial-FTDBLBY5 \
  /dev/cu.usbserial-FTF62W0Y
```

Testi lähettää tunnisteet molempiin suuntiin ja raportoi `OK`, jos ne palaavat
toiselle portille. Molemmat suunnat sekä yhteinen GND on kytkettävä.

Käyttäjällä pitää olla oikeus sarjaporttiin (tyypillisesti `/dev/ttyUSB*` tai `/dev/ttyACM*`). Jakelusta riippuen tämä tarkoittaa esimerkiksi jäsenyyttä `dialout`-ryhmässä tai udev-sääntöä.

## Onnistumiskriteeri

PoC hyväksytään, kun samalla lähdekoodilla:

1. EMIT 250 näkyy porttilistassa Windowsissa.
2. Kortin numero saadaan luettua Windowsissa.
3. EMIT 250 näkyy porttilistassa Linuxissa.
4. Kortin numero saadaan luettua Linuxissa.

Tämän jälkeen seuraava vaihe on siirtää EMIT 250:n täysi parseri Rustiin ja tehdä yleinen `PunchCardReader`-rajapinta.
