#!/usr/bin/env python3
"""Insert dummy participants into the client's local SQLite database.

Useful for testing the client's card lookup and the "Lisää kilpailija ilman
aikaa" autocomplete without having to register real people first.
"""

from __future__ import annotations

import argparse
import os
import random
import sqlite3
import sys
import time

APP_IDENTIFIER = "fi.maanantairastit.client"
DB_FILENAME = "reader.sqlite3"

FIRST_NAMES = [
    "Maija", "Pekka", "Liisa", "Matti", "Anna", "Juha", "Kaisa", "Antti",
    "Sanna", "Timo", "Elina", "Jari", "Hanna", "Mikko", "Tiina", "Sami",
    "Riikka", "Ville", "Johanna", "Petri", "Laura", "Jukka", "Marja",
    "Tero", "Heidi", "Esa", "Katja", "Ari", "Suvi", "Marko", "Tuula",
    "Janne", "Anniina", "Kimmo", "Piia", "Olli", "Noora", "Teemu",
    "Sari", "Vesa",
]
LAST_NAMES = [
    "Korhonen", "Virtanen", "Mäkinen", "Nieminen", "Mäkelä", "Hämäläinen",
    "Laine", "Heikkinen", "Koskinen", "Järvinen", "Lehtonen", "Lehtinen",
    "Saarinen", "Salminen", "Heinonen", "Niemi", "Heikkilä", "Kinnunen",
    "Salo", "Turunen", "Wilska", "Aho", "Manninen", "Rantanen", "Karjalainen",
    "Anttila", "Tuominen", "Hiltunen", "Räsänen", "Ojala",
]
CLUBS = [
    "Kokkolan Suunnistajat", "Kälviän Kalske", "Lohtaja-Seura",
    "Kannuksen Kiisto", "Toholammin Visa", "Ykspihlajan Into",
    None, None,  # some participants have no club
]

# Manually added "ilman aikaa" participants get placeholder card numbers
# from 900_000_000 upward (see database.rs); dummy data stays well below that.
CARD_NUMBER_RANGE = (100_000, 799_999)


def default_db_path() -> str:
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    elif sys.platform.startswith("win"):
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return os.path.join(base, APP_IDENTIFIER, DB_FILENAME)


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """CREATE TABLE IF NOT EXISTS participants (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             card_number INTEGER NOT NULL UNIQUE,
             first_name TEXT NOT NULL,
             last_name TEXT NOT NULL,
             club TEXT,
             created_at_ms INTEGER NOT NULL
           )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS event_registrations (
             event_id TEXT NOT NULL,
             participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
             api_registration_id TEXT,
             api_person_id TEXT,
             course_id TEXT,
             synced_at_ms INTEGER NOT NULL,
             PRIMARY KEY (event_id, participant_id)
           )"""
    )


def unique_card_numbers(connection: sqlite3.Connection, count: int) -> list[int]:
    existing = {row[0] for row in connection.execute("SELECT card_number FROM participants")}
    low, high = CARD_NUMBER_RANGE
    available = set(range(low, high + 1)) - existing
    if len(available) < count:
        raise SystemExit(f"Ei tarpeeksi vapaita korttinumeroita välillä {low}-{high}.")
    return random.sample(sorted(available), count)


def generate_participants(count: int) -> list[tuple[str, str, str | None]]:
    seen: set[tuple[str, str]] = set()
    participants: list[tuple[str, str, str | None]] = []
    while len(participants) < count:
        first_name = random.choice(FIRST_NAMES)
        last_name = random.choice(LAST_NAMES)
        if (first_name, last_name) in seen:
            continue
        seen.add((first_name, last_name))
        participants.append((first_name, last_name, random.choice(CLUBS)))
    return participants


def insert_participants(
    connection: sqlite3.Connection,
    participants: list[tuple[str, str, str | None]],
    card_numbers: list[int],
    event_id: str | None,
    course_id: str | None,
) -> list[int]:
    created_at_ms = int(time.time() * 1000)
    participant_ids = []
    for (first_name, last_name, club), card_number in zip(participants, card_numbers):
        cursor = connection.execute(
            "INSERT INTO participants (card_number, first_name, last_name, club, created_at_ms) VALUES (?, ?, ?, ?, ?)",
            (card_number, first_name, last_name, club, created_at_ms),
        )
        participant_ids.append(cursor.lastrowid)
    if event_id:
        connection.executemany(
            """INSERT INTO event_registrations (event_id, participant_id, course_id, synced_at_ms)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(event_id, participant_id) DO UPDATE SET course_id = excluded.course_id""",
            [(event_id, participant_id, course_id, created_at_ms) for participant_id in participant_ids],
        )
    return participant_ids


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=100, help="Luotavien osallistujien määrä (oletus 100)")
    parser.add_argument("--db", default=default_db_path(), help="Polku reader.sqlite3-tiedostoon")
    parser.add_argument("--event-id", help="Sido osallistujat tähän tapahtuma-id:hen (event_registrations)")
    parser.add_argument("--course-id", help="Rata-id event-id:n rekisteröinnille (vaatii --event-id)")
    parser.add_argument("--seed", type=int, help="Satunnaislukusiemen toistettavia ajoja varten")
    args = parser.parse_args()

    if args.course_id and not args.event_id:
        parser.error("--course-id vaatii --event-id:n")
    if args.seed is not None:
        random.seed(args.seed)

    os.makedirs(os.path.dirname(args.db), exist_ok=True)
    connection = sqlite3.connect(args.db)
    try:
        ensure_schema(connection)
        card_numbers = unique_card_numbers(connection, args.count)
        participants = generate_participants(args.count)
        with connection:
            insert_participants(connection, participants, card_numbers, args.event_id, args.course_id)
    finally:
        connection.close()

    print(f"Luotu {args.count} osallistujaa tietokantaan {args.db}")
    if args.event_id:
        print(f"Sidottu tapahtumaan {args.event_id}" + (f" / rata {args.course_id}" if args.course_id else ""))


if __name__ == "__main__":
    main()
