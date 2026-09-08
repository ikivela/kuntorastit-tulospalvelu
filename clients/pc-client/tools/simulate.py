#!/usr/bin/env python3
"""Simulate a whole event's EMIT 250 card reads for testing the pc-client.

Draws up to --count participants at random from the pc-client's own local
SQLite (reader.sqlite3), assigns each one a random course from the chosen
event's real control-code data (fetched from the public calendar API), and
writes one EMIT 250 frame per competitor to a serial port every --interval
seconds -- exactly as a real reader would.

Run this against the *other* end of whatever serial port the pc-client is
configured to listen on (a null-modem cable to a second USB-serial adapter,
or a virtual pair via e.g. `socat -d -d pty,raw,echo=0,link=/tmp/emit-a
pty,raw,echo=0,link=/tmp/emit-b`), while the target event is running in the
app -- reads then show up in its results log exactly like a live reader.

Usage:
    python3 simulate.py --list-events
    python3 simulate.py --event-id <uuid> --port /tmp/emit-a
    python3 simulate.py --event-id <uuid> --count 30 --interval 5 --loop
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
import termios
import time
import urllib.error
import urllib.request
from pathlib import Path

FRAME_LENGTH = 217
XOR_MASK = 0xDF
MAX_CARD_NUMBER = 0xFFFFFF  # EMIT card number is a 3-byte field
DEFAULT_API = "http://localhost:3001/api/v1"
DEFAULT_DB = Path.home() / "Library/Application Support/fi.kuntorastit.client/reader.sqlite3"
DEFAULT_PORT = "/dev/cu.usbserial-FTDBLBY5"


def configure_serial(fd: int) -> None:
    attrs = termios.tcgetattr(fd)
    attrs[0] = 0
    attrs[1] = 0
    attrs[2] = termios.CLOCAL | termios.CREAD | termios.CS8 | termios.CSTOPB
    attrs[3] = 0
    attrs[4] = termios.B9600
    attrs[5] = termios.B9600
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIOFLUSH)


def make_frame(card_number: int, punches: list[tuple[int, int]]) -> bytes:
    if not 0 <= card_number <= MAX_CARD_NUMBER:
        raise ValueError("card number must fit in 3 bytes (0..16777215)")
    decoded = bytearray(FRAME_LENGTH)
    decoded[0:2] = b"\xff\xff"
    decoded[2:5] = card_number.to_bytes(3, "little")
    decoded[6] = 20  # production week
    decoded[7] = 126  # production year (2026 in the legacy format)
    if len(punches) > 50:
        raise ValueError("at most 50 punches fit in an EMIT 250 frame")
    for index, (control_code, time_seconds) in enumerate(punches):
        if not 0 <= control_code <= 0xFF or not 0 <= time_seconds <= 0xFFFF:
            raise ValueError("invalid control code or punch time")
        offset = 10 + index * 3
        decoded[offset] = control_code
        decoded[offset + 1 : offset + 3] = time_seconds.to_bytes(2, "little")
    decoded[-1] = (-sum(decoded[:-1])) & 0xFF
    return bytes(value ^ XOR_MASK for value in decoded)


def fetch_calendar(api_base: str, years: list[int]) -> list[dict]:
    seasons: dict[str, dict] = {}
    for year in years:
        url = f"{api_base}/public/calendar?year={year}"
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                for season in json.load(response):
                    seasons[season["id"]] = season
        except urllib.error.URLError as error:
            raise SystemExit(f"Kalenterin haku epäonnistui ({url}): {error}") from error
    return list(seasons.values())


def find_event(seasons: list[dict], event_id: str) -> dict | None:
    for season in seasons:
        for event in season["events"]:
            if event["id"] == event_id:
                return event
    return None


def eligible_courses(event: dict) -> list[dict]:
    # START is never an actual EMIT punch. FINISH usually isn't either (a
    # symbolic code like "M"/"F"), but a course with a real numbered finish
    # punch unit (e.g. "100") needs that trailing punch included, or the
    # client's own validateCourse will flag every generated read as
    # MISSING_CONTROL for lacking it.
    courses = []
    for course in event["courses"]:
        codes = []
        for control in sorted(course["controls"], key=lambda c: c["sequenceNumber"]):
            if control["type"] == "START":
                continue
            raw = control["controlCodes"][0] if control["controlCodes"] else control["control"]["code"]
            try:
                codes.append(int(raw))
            except (TypeError, ValueError):
                continue
        if codes:
            courses.append({"id": course["id"], "name": course["name"], "lengthMeters": course["lengthMeters"], "codes": codes})
    return courses


def build_punches(codes: list[int], pace_min_per_km: float, length_meters: int, rng: random.Random) -> list[tuple[int, int]]:
    total_seconds = max(60, int(length_meters / 1000 * pace_min_per_km * 60))
    remaining = total_seconds
    elapsed = 0
    punches = []
    for index, code in enumerate(codes):
        legs_left = len(codes) - index
        average = max(1, remaining // legs_left)
        leg = max(15, int(rng.gauss(average, average * 0.25)))
        elapsed = min(elapsed + leg, 0xFFFF)
        remaining = max(0, remaining - leg)
        punches.append((code, elapsed))
    return punches


def maybe_disqualify(codes: list[int], rate: float, rng: random.Random) -> list[int]:
    if len(codes) > 1 and rng.random() < rate:
        codes = list(codes)
        codes[rng.randrange(len(codes))] = 250  # code no course actually uses -> DISQUALIFIED/MISSING_CONTROL downstream
    return codes


def load_participants(db_path: Path, count: int, rng: random.Random) -> list[tuple[int, str, str, str | None]]:
    if not db_path.exists():
        raise SystemExit(f"Paikallista kantaa ei löytynyt: {db_path} (anna --db)")
    connection = sqlite3.connect(str(db_path))
    try:
        rows = connection.execute(
            "SELECT card_number, first_name, last_name, club FROM participants WHERE card_number <= ?",
            (MAX_CARD_NUMBER,),
        ).fetchall()
    finally:
        connection.close()
    if not rows:
        raise SystemExit(f"Kannasta ({db_path}) ei löytynyt yhtään henkilöä, jolla on kelvollinen EMIT-kortin numero.")
    rng.shuffle(rows)
    if len(rows) < count:
        print(f"Huom: kannassa on vain {len(rows)} kelvollista henkilöä, käytetään niitä kaikkia (pyydettiin {count}).")
    return rows[:count]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--event-id", help="tapahtuman UUID (ks. --list-events)")
    parser.add_argument("--list-events", action="store_true", help="listaa tapahtumat ja lopeta")
    parser.add_argument("--api", default=DEFAULT_API, help=f"API:n perusosoite (oletus: {DEFAULT_API})")
    parser.add_argument("--db", default=str(DEFAULT_DB), help=f"pc-clientin reader.sqlite3 (oletus: {DEFAULT_DB})")
    parser.add_argument("--port", default=DEFAULT_PORT, help=f"sarjaportti johon lähetetään (oletus: {DEFAULT_PORT})")
    parser.add_argument("--count", type=int, default=100, help="montako kilpailijaa arvotaan (oletus: 100)")
    parser.add_argument("--interval", type=float, default=10.0, help="sekuntia leimausten välillä (oletus: 10)")
    parser.add_argument("--disqualify-rate", type=float, default=0.05, help="osuus, jolle arvotaan väärä rasti (oletus: 0.05)")
    parser.add_argument("--loop", action="store_true", help="aloita alusta uudella arvonnalla kun kaikki on lähetetty")
    parser.add_argument("--seed", type=int, default=None, help="satunnaislukusiemen toistettavaa ajoa varten")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    now_year = time.localtime().tm_year
    seasons = fetch_calendar(args.api, [now_year - 1, now_year, now_year + 1])

    if args.list_events:
        for season in seasons:
            for event in season["events"]:
                print(f"{event['id']}  {event['startsAt'][:10]}  {event['name']}")
        return 0

    if not args.event_id:
        raise SystemExit("Anna --event-id (tai --list-events nähdäksesi vaihtoehdot).")

    event = find_event(seasons, args.event_id)
    if not event:
        raise SystemExit(f"Tapahtumaa {args.event_id} ei löytynyt kalenterista.")

    courses = eligible_courses(event)
    if not courses:
        raise SystemExit(f"Tapahtumalla '{event['name']}' ei ole yhtään rataa, jolla on rasteja.")

    rng = random.Random(args.seed)
    participants = load_participants(Path(args.db).expanduser(), args.count, rng)

    try:
        port = os.open(args.port, os.O_RDWR | os.O_NOCTTY)
        configure_serial(port)
    except OSError as error:
        raise SystemExit(f"Sarjaportin avaaminen epäonnistui ({args.port}): {error}") from error

    print(f"Tapahtuma: {event['name']} ({len(courses)} kelvollista rataa)")
    print(f"Kilpailijoita: {len(participants)}, väli: {args.interval} s, portti: {args.port}")
    print("Lopeta painamalla Ctrl+C.\n", flush=True)

    try:
        lap = 1
        while True:
            order = list(participants)
            rng.shuffle(order)
            for card_number, first_name, last_name, club in order:
                course = rng.choice(courses)
                codes = maybe_disqualify(course["codes"], args.disqualify_rate, rng)
                pace_min_per_km = rng.uniform(4.5, 9.0)
                punches = build_punches(codes, pace_min_per_km, course["lengthMeters"], rng)
                os.write(port, make_frame(card_number, punches))
                timestamp = time.strftime("%H:%M:%S")
                print(f"[{timestamp}] {first_name} {last_name} ({club or '–'}) kortti {card_number} -> {course['name']}", flush=True)
                time.sleep(args.interval)
            if not args.loop:
                break
            print(f"-- kierros {lap} lähetetty, arvotaan uudelleen (--loop) --", flush=True)
            lap += 1
    except KeyboardInterrupt:
        print("\nSimulaatio pysäytetty.", file=sys.stderr)
    finally:
        os.close(port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
