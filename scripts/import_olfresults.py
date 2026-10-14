#!/usr/bin/env python3
"""Import events and results from OLFresults into the kuntorastit database.

Two sources:

  --event <OLFresults link or id>   fetch one event straight from olfresults.net
                                    (all courses, plus split times from the
                                    event's WinSplits database when it has one)
  --calendar <OLFresults calendar>  every event of the calendar that has results
  --data <folder>                   an export folder: tapahtumaluettelo.csv +
                                    kaikki_tulokset_<year>.csv (semicolon, UTF-8)

Everything is written in one transaction; without --apply it is rolled back,
so a dry run reports exactly what an import would do.

    pip install "psycopg[binary]" tzdata
    python scripts/import_olfresults.py --event "https://www.olfresults.net/ords/r/olfresults/olfresults/kaikki-tulokset?tapahtumasarja=67&kalenteri=166&tapahtuma=1928&sarja=&lisasarja=0" \\
        --series "Maanantairastit" --database-url postgresql://kuntorastit:...@localhost:5432/kuntorastit
    python scripts/import_olfresults.py --data tmp/maanantairastit_2026 \\
        --series "Kokkolan Maanantairastit" --year 2026 --database-url ...
    # check the report, then the same command with --apply

    # Only a CSV of the event (no database, no psycopg needed):
    python scripts/import_olfresults.py --event "<link>" --csv tulokset.csv

- The series and season must exist (Kaudet page in the admin UI). With
  --event the dates and place come from the OLFresults page and the season
  year from its calendar name (or --year).
- Events are matched to the season's existing events by start date (local
  time); unmatched ones are created. Events that already have results are
  skipped unless named with --include-event <OLFresults id>, so results read
  with the PC client are not duplicated. --only-missing imports them too, but
  only for people who have no result in the event yet.
- Every performance carries client_reference "olfresults:<event>:<course
  page>:<row>", so running the import again updates instead of duplicating.
- A Valiajat column (filled from WinSplits with --event/--calendar) is
  stored as the results' control punches, shown on the split-times page.
  --splits-only adds just those to results already in the database (matched
  by event date, course and name; results with punches, e.g. EMIT reads from
  the PC client, are left alone) and changes nothing else.
  --winsplits <list> does the same straight from WinSplits Online (a list
  of its events with dates, e.g. tmp/winsplits_events.md), without
  olfresults.net.
- Requests are spaced by --delay seconds (default 5) so a calendar import
  doesn't hammer the servers; --cache <folder> keeps fetched pages so a dry
  run and the --apply run after it fetch each page only once.
- seurat.csv (club spellings) and nimikorjaukset.csv (name fixes) in the
  --data folder are applied when present; see their header comments.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import tempfile
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

TIMEZONE = ZoneInfo("Europe/Helsinki")

# Source status -> (performance status, source). "Ilmoittautunut" is a
# registration, not a performance.
STATUS_MAP = {
    "Omatoimi": ("NO_TIME", "SELF_SERVICE"),
    "Ei aikaa": ("NO_TIME", "ONSITE"),
    "Toimitsija": ("NO_TIME", "ONSITE"),
    "Ratamestari": ("NO_TIME", "ONSITE"),
    "Leima puuttuu": ("DISQUALIFIED", "ONSITE"),
    "Keskeytti": ("DID_NOT_FINISH", "ONSITE"),
}
REGISTRATION_STATUSES = {"Ilmoittautunut"}
STATUS_LABELS = {"DRAFT": "luonnos", "PUBLISHED": "julkaistu", "FINISHED": "päättynyt"}
# Which result to keep when a person has several on the same course of an
# event: the public results page shows only one per person and course.
STATUS_RANK = {"ACCEPTED": 0, "NO_TIME": 1, "DISQUALIFIED": 2, "DID_NOT_FINISH": 3}
TIME_PATTERN = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")
COURSE_PATTERN = re.compile(r"^(.*?)\s*\((\d+(?:[.,]\d+)?)\s*km\)\s*$", re.IGNORECASE)


# --- Reading and normalising the export --------------------------------------

def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        lines = [line for line in handle if not line.startswith("#")]
    return list(csv.DictReader(lines, delimiter=";"))


def read_mapping(path: Path) -> list[dict[str, str]]:
    return read_csv(path) if path.exists() else []


def parse_course(title: str) -> tuple[str, int | None]:
    """"B - Rata (4,0 km)" -> ("B-rata", 4000)."""
    match = COURSE_PATTERN.match(title.strip())
    name = match.group(1) if match else title.strip()
    meters = round(float(match.group(2).replace(",", ".")) * 1000) if match else None
    name = re.sub(r"\s*-\s*", "-", name).strip().lower()
    if "rata" not in name:
        name += "-rata"  # "RR" -> "RR-rata", same course as "RR-Rata"
    # Course letters stay upper-case: "pysu a-rata" -> "Pysu A-rata", "RR-rata".
    name = re.sub(r"\b([a-z]{1,2})-rata\b", lambda m: m.group(1).upper() + "-rata", name)
    return name[:1].upper() + name[1:], meters


def course_key(name: str) -> str:
    return re.sub(r"[\s-]", "", name).lower()


def course_sort_order(name: str) -> int:
    match = re.match(r"^([A-E])-rata$", name)
    return "ABCDE".index(match.group(1)) + 1 if match else 10


def parse_seconds(value: str) -> int | None:
    match = TIME_PATTERN.match(value.strip())
    if not match:
        return None
    hours, minutes, seconds = (int(part) if part else 0 for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def parse_splits(value: str) -> list[tuple[str, int | None]]:
    """Valiajat-sarake "165=215;164=;..." (olfresults_csv.py, WinSplitsistä)."""
    splits = []
    for part in filter(None, (item.strip() for item in (value or "").split(";"))):
        code, _, seconds = part.partition("=")
        splits.append((code.strip(), int(seconds) if seconds.strip().isdigit() else None))
    # No control time at all: nothing to show, keep the result without punches.
    return splits if any(seconds is not None for _, seconds in splits) else []


def local_datetime(day: str, clock: time) -> datetime:
    return datetime.combine(date.fromisoformat(day), clock, TIMEZONE).astimezone(timezone.utc)


def split_location(text: str) -> tuple[str, str | None]:
    """OLFresults joins the place and its details with two spaces."""
    parts = [part.strip() for part in re.split(r"\s{2,}", text.strip(), maxsplit=1)]
    return parts[0], (parts[1] if len(parts) > 1 and parts[1] else None)


@dataclass
class SourceEvent:
    olf_id: str
    starts_on: str
    ends_on: str
    title: str
    expected_rows: int
    rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class Result:
    reference: str
    last_name: str
    first_name: str
    club: str | None
    course: str
    status: str | None  # None = registration only
    source: str
    seconds: int | None
    raw_status: str
    # Rastiväliajat: (rastikoodi, kokonaisaika sekunteina tai None = puuttuu).
    splits: list[tuple[str, int | None]] = field(default_factory=list)


class Normaliser:
    def __init__(self, data: Path | None):
        rows = read_mapping(data / "seurat.csv") if data else []
        self.clubs = {row["Lahde"].strip().lower(): row["Seura"].strip() for row in rows}
        self.spellings = [(row["Lahde"].strip(), row["Seura"].strip()) for row in rows]
        self.names = {row["Lahde"].strip(): (row["Sukunimi"].strip(), row["Etunimi"].strip()) for row in (read_mapping(data / "nimikorjaukset.csv") if data else [])}

    def club(self, value: str) -> str | None:
        value = value.strip()
        if not value:
            return None
        return self.clubs.get(value.lower(), value) or None

    def name(self, value: str) -> tuple[str, str] | None:
        value = " ".join(value.split())
        if value in self.names:
            last, first = self.names[value]
            return (last, first) if last and first else None
        parts = value.split(" ")
        if len(parts) < 2:
            return None
        return parts[0], " ".join(parts[1:])


def read_export(data: Path) -> dict[str, SourceEvent]:
    listing = read_csv(data / "tapahtumaluettelo.csv")
    results_file = next(iter(sorted(data.glob("kaikki_tulokset_*.csv"))), None)
    if results_file is None:
        sys.exit(f"Tulostiedostoa kaikki_tulokset_*.csv ei löytynyt kansiosta {data}.")
    events = {row["Tapahtuma_ID"]: SourceEvent(row["Tapahtuma_ID"], row["Alkupvm"], row["Loppupvm"], row["Tapahtuma"], int(row["Tulosriveja"] or 0)) for row in listing}
    for row in read_csv(results_file):
        if row["Tapahtuma_ID"] not in events:
            sys.exit(f"Tulosrivin tapahtumaa {row['Tapahtuma_ID']} ei ole tapahtumaluettelossa.")
        events[row["Tapahtuma_ID"]].rows.append(row)
    mismatched = [f"{event.olf_id}: luettelossa {event.expected_rows}, tiedostossa {len(event.rows)}" for event in events.values() if event.expected_rows != len(event.rows)]
    if mismatched:
        sys.exit("Rivimäärät eivät täsmää tapahtumaluetteloon:\n  " + "\n  ".join(mismatched))
    return events


def load_events(events: dict[str, SourceEvent], normaliser: Normaliser, report: list[str]):
    """Source rows (columns as in kaikki_tulokset_*.csv) -> results and courses per event."""
    skipped: list[str] = []
    unknown: Counter[str] = Counter()
    results: dict[str, list[Result]] = {}
    courses: dict[str, dict[str, int | None]] = {}
    for event in events.values():
        row_numbers: Counter[str] = Counter()
        event_results: list[Result] = []
        event_courses: dict[str, int | None] = {}
        for row in event.rows:
            row_numbers[row["Sarja_ID"]] += 1
            reference = f"olfresults:{event.olf_id}:{row['Sarja_ID']}:{row_numbers[row['Sarja_ID']]}"
            course, meters = parse_course(row["Sarja_ja_matka"])
            event_courses.setdefault(course, meters)
            name = normaliser.name(row["Nimi"])
            if name is None:
                skipped.append(f"{event.starts_on} {course}: nimi \"{row['Nimi']}\" ({row['Aika_tai_tila']})")
                continue
            raw = row["Aika_tai_tila"].strip()
            seconds = parse_seconds(raw)
            if seconds is not None:
                status, source = "ACCEPTED", "ONSITE"
            elif raw in REGISTRATION_STATUSES:
                status, source = None, "ONSITE"
            elif raw in STATUS_MAP:
                status, source = STATUS_MAP[raw]
            else:
                unknown[raw] += 1
                skipped.append(f"{event.starts_on} {course}: tuntematon tila \"{raw}\" ({row['Nimi']})")
                continue
            event_results.append(Result(reference, name[0], name[1], normaliser.club(row["Seura"]), course, status, source, seconds, raw,
                                        parse_splits(row.get("Valiajat", ""))))
        results[event.olf_id] = event_results
        courses[event.olf_id] = event_courses
    if unknown:
        report.append("Tuntemattomat tilat (rivit ohitettu): " + ", ".join(f"{key} ×{count}" for key, count in unknown.items()))
    return events, results, courses, skipped


def best_per_course(results: list[Result]) -> tuple[list[Result], list[Result]]:
    """One performance per person and course; returns (kept, dropped)."""
    best: dict[tuple[str, str, str], Result] = {}
    dropped: list[Result] = []
    for result in results:
        if result.status is None:
            continue
        key = (result.last_name.lower(), result.first_name.lower(), result.course)
        current = best.get(key)
        rank = (STATUS_RANK[result.status], result.seconds or 0)
        if current is None:
            best[key] = result
        elif rank < (STATUS_RANK[current.status], current.seconds or 0):
            dropped.append(current)
            best[key] = result
        else:
            dropped.append(result)
    return list(best.values()), dropped


# --- Database ----------------------------------------------------------------

def new_id() -> str:
    return str(uuid.uuid4())


class Importer:
    def __init__(self, connection: "psycopg.Connection", season_id: str):
        self.db = connection
        self.season_id = season_id
        self.now = datetime.now(timezone.utc)
        self.club_ids: dict[str, str] = {}
        self.person_ids: dict[tuple[str, str], str] = {}
        self.new_clubs: list[str] = []
        self.new_persons = 0

    def club_id(self, name: str | None, source_spelling: str | None) -> str | None:
        if not name:
            return None
        key = name.lower()
        if key not in self.club_ids:
            row = self.db.execute(
                """SELECT c.id FROM club c LEFT JOIN club_alias a ON a.club_id = c.id
                   WHERE lower(c.name) = %s OR lower(a.alias) = %s LIMIT 1""", (key, key)).fetchone()
            if row:
                self.club_ids[key] = str(row[0])
            else:
                club_id = new_id()
                self.db.execute("INSERT INTO club (id, name, created_at, updated_at) VALUES (%s, %s, %s, %s)", (club_id, name, self.now, self.now))
                self.club_ids[key] = club_id
                self.new_clubs.append(name)
        club_id = self.club_ids[key]
        # Remember the source spelling so later imports and searches find it.
        if source_spelling and source_spelling.strip().lower() != key:
            self.db.execute(
                """INSERT INTO club_alias (id, club_id, alias) SELECT %s, %s, %s
                   WHERE NOT EXISTS (SELECT 1 FROM club_alias WHERE lower(alias) = lower(%s))
                     AND NOT EXISTS (SELECT 1 FROM club WHERE lower(name) = lower(%s))""",
                (new_id(), club_id, source_spelling.strip(), source_spelling.strip(), source_spelling.strip()))
        return club_id

    def person_id(self, last: str, first: str, club_id: str | None) -> str:
        """Same matching as the app: first + last name, case-insensitive, oldest first."""
        key = (last.lower(), first.lower())
        if key not in self.person_ids:
            row = self.db.execute(
                """SELECT id, club_id FROM person WHERE lower(last_name) = %s AND lower(first_name) = %s
                   ORDER BY created_at LIMIT 1""", key).fetchone()
            if row:
                person_id = str(row[0])
                if row[1] is None and club_id:
                    self.db.execute("UPDATE person SET club_id = %s, updated_at = %s WHERE id = %s", (club_id, self.now, person_id))
            else:
                person_id = new_id()
                self.db.execute(
                    "INSERT INTO person (id, first_name, last_name, club_id, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (person_id, first, last, club_id, self.now, self.now))
                self.new_persons += 1
            self.person_ids[key] = person_id
        return self.person_ids[key]

    def people_with_results(self, event_id: str) -> set[tuple[str, str]]:
        """(last, first) in lower case of everyone with a result in the event
        that didn't come from this importer (PC client, manual entry)."""
        rows = self.db.execute(
            """SELECT DISTINCT lower(p.last_name), lower(p.first_name) FROM performance pf
               JOIN attendance a ON a.id = pf.attendance_id JOIN person p ON p.id = a.person_id
               WHERE a.event_id = %s AND (pf.client_reference IS NULL OR pf.client_reference NOT LIKE 'olfresults:%%')""",
            (event_id,)).fetchall()
        return {(last, first) for last, first in rows}

    def existing_events(self) -> dict[date, list[tuple]]:
        """Season's events by local start date, with their result count not
        counting this importer's own earlier runs."""
        by_day: dict[date, list[tuple]] = defaultdict(list)
        rows = self.db.execute(
            """SELECT e.id, e.name, e.starts_at, e.status::text,
                      (SELECT count(*) FROM performance p JOIN attendance a ON a.id = p.attendance_id
                       WHERE a.event_id = e.id AND (p.client_reference IS NULL OR p.client_reference NOT LIKE 'olfresults:%%'))
               FROM event e WHERE e.season_id = %s""", (self.season_id,)).fetchall()
        for row in rows:
            # Timestamps are stored as UTC in "timestamp without time zone".
            by_day[row[2].replace(tzinfo=timezone.utc).astimezone(TIMEZONE).date()].append(row)
        return by_day

    def create_event(self, event: SourceEvent, starts_at: datetime, ends_at: datetime, status: str) -> str:
        name, address = split_location(event.title)
        event_id = new_id()
        self.db.execute(
            """INSERT INTO event (id, season_id, name, location_name, address, starts_at, ends_at, status, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s::"EventStatus", %s, %s)""",
            (event_id, self.season_id, name, name, address, starts_at, ends_at, status, self.now, self.now))
        return event_id

    def courses(self, event_id: str, wanted: dict[str, int | None]) -> tuple[dict[str, str], int]:
        existing = {course_key(name): str(course_id) for course_id, name in self.db.execute("SELECT id, name FROM course WHERE event_id = %s", (event_id,)).fetchall()}
        ids: dict[str, str] = {}
        created = 0
        for name, meters in wanted.items():
            key = course_key(name)
            if key not in existing:
                existing[key] = new_id()
                self.db.execute(
                    """INSERT INTO course (id, event_id, name, length_meters, sort_order, created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (existing[key], event_id, name, meters or 0, course_sort_order(name), self.now, self.now))
                created += 1
            ids[name] = existing[key]
        return ids, created

    def attendance_id(self, event_id: str, person_id: str, recorded_at: datetime) -> str:
        row = self.db.execute(
            """INSERT INTO attendance (id, event_id, person_id, recorded_at, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (event_id, person_id) DO UPDATE SET updated_at = attendance.updated_at
               RETURNING id""",
            (new_id(), event_id, person_id, recorded_at, self.now, self.now)).fetchone()
        return str(row[0])

    def performance(self, attendance_id: str, course_id: str, result: Result, read_at: datetime) -> None:
        duration_ms = result.seconds * 1000 if result.seconds is not None else None
        performance_id = self.db.execute(
            """INSERT INTO performance (id, attendance_id, course_id, source, status, duration_ms, read_at, client_reference, created_at, updated_at)
               VALUES (%s, %s, %s, %s::"PerformanceSource", %s::"PerformanceStatus", %s, %s, %s, %s, %s)
               ON CONFLICT (client_reference) DO UPDATE SET
                 attendance_id = EXCLUDED.attendance_id, course_id = EXCLUDED.course_id, source = EXCLUDED.source,
                 status = EXCLUDED.status, duration_ms = EXCLUDED.duration_ms, read_at = EXCLUDED.read_at,
                 updated_at = EXCLUDED.updated_at, version = performance.version + 1
               RETURNING id""",
            (new_id(), attendance_id, course_id, result.source, result.status, duration_ms, read_at, result.reference, self.now, self.now)).fetchone()[0]
        # A source without splits leaves earlier ones as they are.
        if result.splits:
            self.punches(performance_id, result.splits)

    def punches(self, performance_id: str, splits: list[tuple[str, int | None]]) -> None:
        """Replaces the result's punches with its control split times (the
        finish is the result time, not a punch)."""
        self.db.execute("DELETE FROM punch WHERE performance_id = %s", (performance_id,))
        with self.db.cursor() as cursor:
            cursor.executemany(
                """INSERT INTO punch (id, performance_id, control_code, elapsed_ms, sequence_number, status)
                   VALUES (%s, %s, %s, %s, %s, %s::"PunchStatus")""",
                [(new_id(), performance_id, code, seconds * 1000 if seconds is not None else None, number,
                  "VALID" if seconds is not None else "MISSING")
                 for number, (code, seconds) in enumerate(splits, 1)])

    def registration(self, event_id: str, person_id: str, course_id: str, registered_at: datetime) -> None:
        self.db.execute(
            """INSERT INTO registration (id, event_id, person_id, course_id, notes, registered_at)
               VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (event_id, person_id) DO NOTHING""",
            (new_id(), event_id, person_id, course_id, "Tuotu OLFresultsista", registered_at))


def find_season(connection: "psycopg.Connection", series: str, year: int, required: bool = True) -> str | None:
    row = connection.execute(
        """SELECT s.id FROM season s JOIN event_series es ON es.id = s.event_series_id
           WHERE lower(es.name) = lower(%s) AND s.year = %s""", (series, year)).fetchone()
    if row:
        return str(row[0])
    if not required:
        return None
    available = connection.execute(
        "SELECT es.name, s.year FROM season s JOIN event_series es ON es.id = s.event_series_id ORDER BY es.name, s.year").fetchall()
    listing = "\n  ".join(f"{name} {season_year}" for name, season_year in available) or "(ei kausia)"
    sys.exit(f"Kautta \"{series}\" {year} ei löytynyt. Luo se ylläpidon Kaudet-sivulla. Olemassa olevat kaudet:\n  {listing}")


# --- Fetching from olfresults.net ---------------------------------------------
#
# The event's "Kaikki tulokset" page lists its courses; each course page has
# the result table. Row counts are checked against the pages' Osallistujia
# figures so a partial fetch is never imported or saved.

BASE = 'https://www.olfresults.net/ords/r/olfresults/olfresults/'


class Page(HTMLParser):
    """Sivun linkit, h1-otsikko, näkyvä teksti ja taulukot (rivit soluteksteinä)."""

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.text = []
        self.heading = []
        self.in_heading = False
        self.banner = []  # yläpalkin "12.10. - 17.10. Paikka :: Kalenteri 2026"
        self.in_banner = False
        self.tables = []
        self.table = None
        self.row = None
        self.cell = None
        self.feed(html)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            href = dict(attrs).get('href')
            if href:
                self.links.append(href)
        elif tag == 'h1' and not self.heading:
            # Vain sivun ensimmäinen h1 (sarjan nimi); APEX lisää perään
            # piilotetun "Saraketoiminnot"-otsikon.
            self.in_heading = True
        elif tag == 'span' and 'apex-logo-text' in (dict(attrs).get('class') or '').split():
            self.in_banner = True
        elif tag == 'table':
            self.table = []
        elif tag == 'tr' and self.table is not None:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        self.text.append(data)
        if self.cell is not None:
            self.cell.append(data)
        if self.in_heading:
            self.heading.append(data)
        if self.in_banner:
            self.banner.append(data)

    def handle_endtag(self, tag):
        if tag == 'h1':
            self.in_heading = False
        if tag == 'span':
            self.in_banner = False
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None

    def count(self):
        match = re.search(r'Osallistujia:\s*(\d+)', ' '.join(self.text))
        if not match:
            raise ValueError('Osallistujamäärää ei löytynyt. Sivun rakenne on voinut muuttua.')
        return int(match.group(1))

    def results(self):
        for table in self.tables:
            if table and 'Nimi' in table[0] and 'Aika' in table[0]:
                header = table[0]
                return [dict(zip(header, row)) for row in table[1:]
                        if len(row) == len(header) and row[header.index('Nimi')]]
        return []


def fetch(url, timeout):
    return Page(fetch_text(url, timeout))


# Pause before every request so a whole calendar (hundreds of pages) doesn't
# hammer the servers; a 1 s burst got this machine's connections to
# olfresults.net refused. --cache keeps fetched pages, so a dry run followed
# by --apply (or a rerun) asks for each page only once.
REQUEST_DELAY = 5.0
CACHE_DIR: Path | None = None


def fetch_text(url, timeout, encoding='utf-8'):
    """encoding: oletus, jos palvelin ei kerro merkistöä (WinSplits: windows-1252)."""
    cached = CACHE_DIR / (uuid.uuid5(uuid.NAMESPACE_URL, url).hex + '.html') if CACHE_DIR else None
    if cached and cached.exists():
        return cached.read_text(encoding='utf-8')
    for attempt in range(3):
        sleep(REQUEST_DELAY)
        try:
            request = Request(url, headers={'User-Agent': 'KuntorastitImport/1.0 (Python)'})
            with urlopen(request, timeout=timeout) as response:
                text = response.read().decode(response.headers.get_content_charset() or encoding)
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(text, encoding='utf-8')
            return text
        except HTTPError as error:
            if error.code < 500 or attempt == 2:
                raise
        except (URLError, TimeoutError) as error:
            # A refused connection won't fix itself in seconds: don't retry.
            if attempt == 2 or isinstance(getattr(error, 'reason', None), ConnectionRefusedError):
                raise
        sleep(5 * (attempt + 1))


def resolve(event, tapahtumasarja=None, kalenteri=None):
    """OLFRESULTS-linkki tai tapahtumatunnus -> {tapahtuma, tapahtumasarja, kalenteri}."""
    # Hyväksy myös shellin tai Markdownin kenoviivoilla suojaamat ?, = ja &
    # -merkit (lainausmerkkien sisällä kenoviivat jäävät osaksi linkkiä).
    event = re.sub(r'\\(?=[?=&])', '', event.strip())
    if event.isdigit():
        params = {'tapahtuma': event, 'tapahtumasarja': tapahtumasarja, 'kalenteri': kalenteri}
    else:
        parsed = urlsplit(event)
        if parsed.scheme not in ('http', 'https') or parsed.hostname not in ('olfresults.net', 'www.olfresults.net'):
            raise ValueError('Anna OLFRESULTS-linkki tai numeerinen tapahtumatunnus.')
        query = parse_qs(parsed.query)
        params = {key: query.get(key, [None])[0]
                  for key in ('tapahtuma', 'tapahtumasarja', 'kalenteri')}
    for key, value in params.items():
        if not value or not str(value).isdigit():
            raise ValueError(f'Puuttuva tai virheellinen {key}. Anna täydellinen linkki tai tarvittavat valitsimet.')
    return params


FIELDS = ['Tapahtuma_ID', 'Tapahtumasarja_ID', 'Kalenteri_ID', 'Sarja_ID',
          'Sarja_ja_matka', 'Sija', 'Nimi', 'Seura', 'Aika_tai_tila',
          'Suor', 'Ero', 'Aika_per_km', 'Lahde_URL', 'Valiajat']
WINSPLITS = 'https://obasen.orientering.se/winsplits/online/fi/'


def collect(params, timeout):
    """Hakee tapahtuman kaikkien sarjojen rivit (FIELDS-järjestyksessä) ja
    palauttaa ne sekä tapahtumasivun yläpalkin tekstin."""
    event_url = BASE + 'kaikki-tulokset?' + urlencode({**params, 'sarja': '', 'lisasarja': '0'})
    page = fetch(event_url, timeout)
    expected = page.count()
    courses = {}
    for link in page.links:
        absolute = urljoin(BASE, link)
        parsed = urlsplit(absolute)
        if not parsed.path.endswith('/tulokset'):
            continue
        query = parse_qs(parsed.query)
        sid = query.get('sarja', [''])[0]
        if query.get('tapahtuma', [''])[0] == params['tapahtuma'] and sid.isdigit() and sid != '0':
            courses[sid] = BASE + 'tulokset?' + urlencode({**params, 'sarja': sid, 'lisasarja': '0'})
    if expected and not courses:
        raise ValueError('Sarjalinkkejä ei löytynyt, vaikka tapahtumalla on osallistujia.')
    rows = []
    for index, (sid, url) in enumerate(courses.items(), 1):
        course = fetch(url, timeout)
        results = course.results()
        count = course.count()
        if len(results) != count:
            raise ValueError(f'Sarja {sid}: löytyi {len(results)} / {count} riviä. Vienti keskeytetty.')
        title = ' '.join(''.join(course.heading).split())
        print(f'[{index}/{len(courses)}] {title}: {count} riviä', file=sys.stderr)
        for row in results:
            rows.append([params['tapahtuma'], params['tapahtumasarja'], params['kalenteri'], sid,
                         title, row.get('Sija', ''), row['Nimi'], row.get('Seura', ''), row['Aika'],
                         row.get('Suor', ''), row.get('+', ''), row.get('/km', ''), url, ''])
    if len(rows) != expected:
        raise ValueError(f'Tapahtuma: sarjoista löytyi {len(rows)} / {expected} riviä. '
                         'Tulokset voivat päivittyä haun aikana. Yritä uudelleen.')
    add_splits(page, rows, timeout)
    return rows, ' '.join(''.join(page.banner).split())


# --- Rastiväliajat WinSplitsistä ----------------------------------------------
#
# OLFRESULTSin omat väliaikaikkunat aukeavat vain selainistunnossa, mutta
# tapahtumasivu linkittää saman tapahtuman WinSplits Online -tietokantaan.
# Valiajat-sarake: "165=215;164=365;163=;..." eli rastikoodi = kokonaisaika
# sekunteina lähdöstä, tyhjä = leimaus puuttuu. Maali ei ole mukana.

def name_key(name):
    """Nimen sanat ilman järjestystä: WinSplits "Jukka Polso" = OLFRESULTS "Polso Jukka"."""
    return frozenset(name.lower().split())


def course_name(title):
    """"A-rata (5,3 km)" -> "arata"; samaan muotoon WinSplitsin sarjan nimi."""
    return re.sub(r'[\s-]', '', re.sub(r'\s*\([^)]*km\)\s*$', '', title, flags=re.IGNORECASE)).lower()


def winsplits_seconds(value):
    """"3.35" -> 215, "1:00.01" -> 3601; "0.00" (leimaus puuttuu) ja muu -> None."""
    match = re.match(r'^(?:(\d+):)?(\d+)\.(\d\d)$', value.strip())
    if not match:
        return None
    seconds = int(match.group(1) or 0) * 3600 + int(match.group(2)) * 60 + int(match.group(3))
    return seconds or None


def winsplits_table(html_text):
    """Yhden sarjan taulukko -> (rastikoodit, [(nimi, [kokonaisaika rastilla..., maalissa])])."""
    cell = lambda raw: ' '.join(unescape(re.sub(r'<[^>]+>', '', raw)).split())
    codes = [match.group(1) for match in re.finditer(r'>\s*(?:L|\d+)-\d+\s*\((\w+)\)\s*<', html_text)]
    halves = {}
    for runner, half, body in re.findall(r'<TR id="(\d+)_([01])"[^>]*>(.*?)</TR>', html_text, re.S | re.I):
        halves.setdefault(runner, {})[half] = [cell(raw) for raw in re.findall(r'<TD[^>]*>(.*?)</TD>', body, re.S | re.I)]
    runners = []
    for parts in halves.values():
        if '0' not in parts or '1' not in parts:
            continue
        # Rivi 0: sija, nimi, väliajat..., nimi; rivi 1: seura, kokonaisajat..., seura.
        name, totals = parts['0'][1], parts['1'][1:-1]
        if len(totals) == len(codes) + 1:
            runners.append((name, [winsplits_seconds(value) for value in totals]))
    return codes, runners


def winsplits_classes(database, timeout):
    """WinSplits-tietokannan sarjat: {course_name(): (sarjan nimi, categoryId)}."""
    classes = fetch_text(WINSPLITS + 'classes.asp?' + urlencode({'databaseId': database}), timeout, 'windows-1252')
    found = {}
    for category, label in re.findall(r'categoryId=(\d+)[^>]*>(.*?)</A>', classes, re.S | re.I):
        label = ' '.join(unescape(re.sub(r'<[^>]+>', '', label)).split())
        found[course_name(label)] = (label, category)
    return found


def winsplits_class(database, category, timeout):
    return winsplits_table(fetch_text(
        WINSPLITS + 'table.asp?' + urlencode({'databaseId': database, 'categoryId': category}), timeout, 'windows-1252'))


def format_seconds(seconds):
    return f'{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}' if seconds >= 3600 else f'{seconds // 60}:{seconds % 60:02d}'


def winsplits_list(path):
    """WinSplits Online -tapahtumalistasta kopioitu teksti (esim. tmp/winsplits_events.md):
    päivämäärä dd/mm/yyyy ja sen jälkeen linkki, jossa databaseId -> [(päivä, databaseId, nimi)]."""
    text = Path(path).read_text(encoding='utf-8-sig')
    found = []
    for day, title, database in re.findall(r'(\d{1,2}/\d{1,2}/\d{4})\s+\**\[([^\]]+)\]\([^)]*databaseId=(\d+)', text):
        day_number, month, year = (int(part) for part in day.split('/'))
        found.append((date(year, month, day_number).isoformat(), database, title.strip()))
    if not found:
        raise ValueError(f'{path}: tapahtumia ei löytynyt (odotettu muoto: "12/10/2026" ja linkki, jossa databaseId).')
    return found


def winsplits_event(starts_on, database, title, timeout):
    """A WinSplits database as a SourceEvent for run_splits(): one row per
    runner with control times, finish time in Aika_tai_tila."""
    rows = []
    summary = []
    for label, category in winsplits_classes(database, timeout).values():
        codes, runners = winsplits_class(database, category, timeout)
        count = 0
        for name, totals in runners:
            *controls, finish = totals
            if not any(controls):
                continue
            rows.append({'Nimi': name, 'Sarja_ja_matka': label, 'Aika_tai_tila': format_seconds(finish) if finish else '',
                         'Valiajat': ';'.join(f'{code}={value or ""}' for code, value in zip(codes, controls))})
            count += 1
        summary.append(f'{label} {count}')
    print(f'{starts_on} {title} (WinSplits {database}): ' + ', '.join(summary), file=sys.stderr)
    return SourceEvent(f'ws{database}', starts_on, starts_on, title, len(rows), rows)


def add_splits(page, rows, timeout):
    """Täyttää rivien Valiajat-sarakkeen, kun tapahtumalla on WinSplits-tietokanta."""
    database = next((match.group(1) for link in page.links if 'winsplits' in link.lower()
                     for match in [re.search(r'databaseId=(\d+)', link)] if match), None)
    if not database:
        print('Väliajat: tapahtumalla ei ole WinSplits-linkkiä, väliaikoja ei haeta.', file=sys.stderr)
        return
    categories = {course: category for course, (_, category) in winsplits_classes(database, timeout).items()}
    index = FIELDS.index
    by_course = {}
    for row in rows:
        by_course.setdefault(course_name(row[index('Sarja_ja_matka')]), []).append(row)
    summary = []
    for course, course_rows in by_course.items():
        if course not in categories:
            summary.append(f'{course_rows[0][index("Sarja_ja_matka")]}: ei WinSplitsissä')
            continue
        codes, runners = winsplits_class(database, categories[course], timeout)
        found = {}
        for name, totals in runners:
            if any(totals[:-1]):  # ei yhtään rastileimausta (omatoimi, ilmoittautunut)
                found.setdefault(name_key(name), []).append(totals)
        names = [name_key(row[index('Nimi')]) for row in course_rows]
        matched = 0
        for row, key in zip(course_rows, names):
            candidates = found.get(key, [])
            if len(candidates) != 1 or names.count(key) != 1:
                continue  # ei väliaikoja tai sama nimi kahdesti: ei arvata
            *controls, finish = candidates[0]
            seconds = re.match(r'^(?:(\d+):)?(\d+):(\d\d)$', row[index('Aika_tai_tila')].strip())
            result = seconds and int(seconds.group(1) or 0) * 3600 + int(seconds.group(2)) * 60 + int(seconds.group(3))
            if result and finish and abs(result - finish) > 1:
                print(f'Väliajat: {row[index("Nimi")]} ({course}): WinSplitsin aika {finish} s ≠ tulos {result} s, ohitetaan.', file=sys.stderr)
                continue
            row[index('Valiajat')] = ';'.join(f'{code}={value or ""}' for code, value in zip(codes, controls))
            matched += 1
        summary.append(f'{course_rows[0][index("Sarja_ja_matka")]} {matched}')
    print(f'Väliajat (WinSplits {database}): ' + ', '.join(summary), file=sys.stderr)


def write_csv(rows, output, delimiter):
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8-sig', newline='',
                                         dir=output.parent, delete=False) as stream:
            temp_path = Path(stream.name)
            writer = csv.writer(stream, delimiter=delimiter)
            writer.writerow(FIELDS)
            writer.writerows(rows)
        os.replace(temp_path, output)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
    print(f'Tallennettu {len(rows)} riviä: {output.resolve()}')


def parse_banner(banner, year=None):
    """"12.10. - 17.10. Halkokari, Trullevintien parkkipaikka :: Kokkolan
    Maanantarastit 2026" -> ("2026-10-12", "2026-10-17", "Halkokari  Trullevintien
    parkkipaikka"). Vuosi tulee kalenterin nimestä, tai year-parametrista."""
    match = re.match(r'^(\d{1,2})\.(\d{1,2})\.(?:\s*-\s*(\d{1,2})\.(\d{1,2})\.)?\s*(.*?)\s*(?:::\s*(.*))?$', banner)
    if not match or not match.group(5):
        raise ValueError(f'Tapahtuman päivämäärää ja paikkaa ei löytynyt sivun otsikosta ("{banner}"). '
                         'Sivun rakenne on voinut muuttua.')
    start_day, start_month, end_day, end_month, place, calendar = match.groups()
    calendar_years = re.findall(r'\b(20\d{2})\b', calendar or '')
    calendar_year = int(calendar_years[-1]) if calendar_years else None
    if year and calendar_year and year != calendar_year:
        raise ValueError(f'--year {year} ei vastaa kalenteria "{calendar}" ({calendar_year}).')
    year = year or calendar_year
    if not year:
        raise ValueError(f'Vuotta ei löytynyt kalenterin nimestä ("{calendar}"). Anna --year.')
    starts_on = date(year, int(start_month), int(start_day))
    ends_on = date(year, int(end_month or start_month), int(end_day or start_day))
    if ends_on < starts_on:  # vuodenvaihde, esim. 29.12. - 3.1.
        ends_on = ends_on.replace(year=year + 1)
    # split_location() erottaa paikan ja lisätiedot kahdella välilyönnillä.
    title = re.sub(r',\s*', '  ', place, count=1)
    return starts_on.isoformat(), ends_on.isoformat(), title, year


def calendar_event_ids(link: str, timeout: float) -> list[str]:
    """Events of an OLFresults calendar that have results ("Kaikki tulokset")."""
    link = re.sub(r'\\(?=[?=&])', '', link.strip())
    query = parse_qs(urlsplit(link).query)
    params = {key: query.get(key, [None])[0] for key in ('tapahtumasarja', 'kalenteri')}
    if urlsplit(link).hostname not in ('olfresults.net', 'www.olfresults.net') or not all(str(value or '').isdigit() for value in params.values()):
        raise ValueError('Anna OLFRESULTS-kalenterin linkki (tapahtumasarja ja kalenteri mukana).')
    page = fetch(BASE + 'kalenteri?' + urlencode({**params, 'tapahtuma': query.get('tapahtuma', [''])[0], 'sarja': '', 'lisasarja': '0'}), timeout)
    ids = []
    for href in page.links:
        parsed = urlsplit(urljoin(BASE, href))
        found = parse_qs(parsed.query)
        event = found.get('tapahtuma', [''])[0]
        if (parsed.path.endswith('/kaikki-tulokset') and event.isdigit() and event not in ids
                and found.get('kalenteri', [''])[0] == params['kalenteri']):
            ids.append(event)
    if not ids:
        raise ValueError('Kalenterista ei löytynyt yhtään tapahtumaa, jolla on tulokset.')
    return [link_for(event, params) for event in ids]


def link_for(event: str, params: dict) -> str:
    return BASE + 'kaikki-tulokset?' + urlencode({**params, 'tapahtuma': event, 'sarja': '', 'lisasarja': '0'})


def fetch_event(link: str, tapahtumasarja: str | None, kalenteri: str | None, year: int | None, timeout: float):
    """OLFresults event -> (SourceEvent with rows as in kaikki_tulokset_*.csv, CSV rows)."""
    params = resolve(link, tapahtumasarja, kalenteri)
    rows, banner = collect(params, timeout)
    starts_on, ends_on, title, year = parse_banner(banner, year)
    event = SourceEvent(params["tapahtuma"], starts_on, ends_on, title, len(rows), [dict(zip(FIELDS, row)) for row in rows])
    return event, rows, year


# --- Import ------------------------------------------------------------------

def run_import(events: dict[str, SourceEvent], normaliser: Normaliser, *, series: str, year: int, database_url: str,
               apply: bool, include_event: list[str], start_clock: time, end_clock: time,
               report_path: Path | None, title: str, only_missing: bool = False) -> None:
    """Writes the events into the season in one transaction (rolled back
    unless apply). The summary is printed; the full report goes to
    report_path, or is printed too when there is none. With only_missing an
    event that already has results is imported too, but only for people
    without a result there yet."""
    try:
        import psycopg
    except ModuleNotFoundError as error:
        sys.exit(f'Tietokantatuonti tarvitsee paketin {error.name}: pip install "psycopg[binary]" tzdata')
    report: list[str] = []
    events, results, courses, skipped = load_events(events, normaliser, report)
    unknown_includes = set(include_event) - set(events)
    if unknown_includes:
        sys.exit(f"--include-event: tuntemattomat tapahtumat {', '.join(sorted(unknown_includes))}")

    # Prisma stores timestamps as UTC in "timestamp without time zone".
    with psycopg.connect(database_url, options="-c timezone=UTC") as connection:
        importer = Importer(connection, find_season(connection, series, year))
        existing = importer.existing_events()
        today = datetime.now(TIMEZONE).date()
        lines: list[str] = []
        dropped_lines: list[str] = []
        present_lines: list[str] = []
        totals: Counter[str] = Counter()

        for event in sorted(events.values(), key=lambda item: item.starts_on):
            starts_at = local_datetime(event.starts_on, start_clock)
            ends_at = local_datetime(event.ends_on, end_clock)
            event_results = results[event.olf_id]
            results_status = "FINISHED" if date.fromisoformat(event.ends_on) < today else "PUBLISHED"
            label = f"{event.starts_on} [{event.olf_id}] {split_location(event.title)[0]}"
            matches = existing.get(date.fromisoformat(event.starts_on), [])
            if len(matches) > 1:
                lines.append(f"{label}: OHITETTU, samana päivänä useita tapahtumia ({', '.join(match[1] for match in matches)})")
                totals["skipped_events"] += 1
                continue
            if matches:
                event_id, existing_name, _, status, performance_count = matches[0]
                if performance_count and event.olf_id not in include_event and not only_missing:
                    lines.append(f"{label}: OHITETTU, tapahtumalla \"{existing_name}\" on jo {performance_count} tulosta (tuo silti: --include-event {event.olf_id}, tai vain puuttuvat: --only-missing)")
                    totals["skipped_events"] += 1
                    continue
                action = f"päivitetään \"{existing_name}\""
                # Drafts' results are not public; publish once results arrive.
                if status == "DRAFT" and event_results:
                    connection.execute("""UPDATE event SET status = %s::"EventStatus", updated_at = %s WHERE id = %s""", (results_status, importer.now, event_id))
                    action += f", luonnos → {STATUS_LABELS[results_status]}"
                totals["matched_events"] += 1
            else:
                if not event_results:
                    lines.append(f"{label}: ei tuloksia eikä vastaavaa tapahtumaa, luodaan luonnoksena")
                status = results_status if event_results else "DRAFT"
                event_id = importer.create_event(event, starts_at, ends_at, status)
                action = f"luodaan ({STATUS_LABELS[status]})"
                totals["created_events"] += 1
                if not event_results:
                    continue

            course_ids, created_courses = importer.courses(event_id, courses[event.olf_id])
            kept, dropped = best_per_course(event_results)
            present = 0
            if only_missing and matches:
                # Same name matching as person_id(): case-insensitive first + last name.
                have = importer.people_with_results(event_id)
                for result in [item for item in kept if (item.last_name.lower(), item.first_name.lower()) in have]:
                    kept.remove(result)
                    present += 1
                    present_lines.append(f"{event.starts_on} {result.course}: {result.last_name} {result.first_name} \"{result.raw_status if result.seconds is None else 'aika'}\"")
            for result in dropped:
                dropped_lines.append(f"{event.starts_on} {result.course}: {result.last_name} {result.first_name} \"{result.raw_status}\" (paremmin sijoittunut tulos jää voimaan)")
            statuses: Counter[str] = Counter()
            for result in kept:
                club_id = importer.club_id(result.club, None)
                person_id = importer.person_id(result.last_name, result.first_name, club_id)
                attendance_id = importer.attendance_id(event_id, person_id, starts_at)
                importer.performance(attendance_id, course_ids[result.course], result, starts_at)
                statuses[result.raw_status if result.seconds is None else "aika"] += 1
                totals["splits"] += bool(result.splits)
            for result in (item for item in event_results if item.status is None):
                club_id = importer.club_id(result.club, None)
                importer.registration(event_id, importer.person_id(result.last_name, result.first_name, club_id), course_ids[result.course], starts_at)
                statuses[result.raw_status] += 1
            totals["performances"] += len(kept)
            totals["dropped"] += len(dropped)
            totals["present"] += present
            summary = ", ".join(f"{key} {count}" for key, count in statuses.most_common())
            lines.append(f"{label}: {action}; ratoja {len(course_ids)} (uusia {created_courses}); tuloksia {len(kept)}"
                         + (f" (jo tulos {present} henkilöllä, ohitettu)" if present else "") + f" — {summary}")

        # Source club spellings become aliases of the club they map to.
        for spelling, target in normaliser.spellings:
            if target and target.lower() in importer.club_ids:
                importer.club_id(target, spelling)

        header = [
            f"OLFresults-tuonti: {title} — {'TALLENNETTU' if apply else 'KUIVAHARJOITUS (ei tallennettu)'}",
            f"Tapahtumia: luodaan {totals['created_events']}, päivitetään {totals['matched_events']}, ohitetaan {totals['skipped_events']}",
            f"Tuloksia: {totals['performances']}; saman radan päällekkäisiä ohitettu {totals['dropped']}; rivejä ohitettu {len(skipped)}"
            + (f"; jo tulos tapahtumassa, ohitettu {totals['present']}" if only_missing else "")
            + f"; rastiväliajat {totals['splits']} tulokselle",
            f"Uusia henkilöitä {importer.new_persons}, uusia seuroja {len(importer.new_clubs)}" + (f": {', '.join(sorted(importer.new_clubs))}" if importer.new_clubs else ""),
            "",
        ]
        output = header + report + ["Tapahtumat:"] + [f"  {line}" for line in lines]
        if skipped:
            output += ["", "Ohitetut rivit (korjaa nimikorjaukset.csv:ssä):"] + [f"  {line}" for line in skipped]
        if present_lines:
            output += ["", "Henkilöllä on jo tulos tapahtumassa (--only-missing, ei tuotu):"] + [f"  {line}" for line in present_lines]
        if dropped_lines:
            output += ["", "Saman henkilön useampi tulos samalla radalla (vain paras tuodaan):"] + [f"  {line}" for line in dropped_lines]
        if report_path:
            report_path.write_text("\n".join(output) + "\n", encoding="utf-8")
            print("\n".join(header + report))
            print(f"Täysi raportti: {report_path}")
        else:
            print("\n".join(output))

        if apply:
            connection.commit()
        else:
            connection.rollback()


def run_splits(events: dict[str, SourceEvent], normaliser: Normaliser, *, series: str, years: dict[str, int],
               database_url: str, apply: bool) -> None:
    """Adds split times to results already in the database, nothing else.
    A row is matched to the event of its start date, the course and the
    person's name (word order free); only results with no punches yet get
    them, so the PC client's EMIT punches are kept. The result time must
    agree within a second when both have one."""
    try:
        import psycopg
    except ModuleNotFoundError as error:
        sys.exit(f'Tietokantatuonti tarvitsee paketin {error.name}: pip install "psycopg[binary]" tzdata')
    with psycopg.connect(database_url, options="-c timezone=UTC") as connection:
        importers = {year: Importer(connection, season_id) for year in sorted(set(years.values()))
                     for season_id in [find_season(connection, series, year, required=False)] if season_id}
        existing = {year: importer.existing_events() for year, importer in importers.items()}
        lines: list[str] = []
        problems: list[str] = []
        totals: Counter[str] = Counter()
        for event in sorted(events.values(), key=lambda item: item.starts_on):
            year = years[event.olf_id]
            label = f"{event.starts_on} [{event.olf_id}] {split_location(event.title)[0]}"
            if year not in importers:
                lines.append(f"{label}: OHITETTU, kautta \"{series}\" {year} ei ole")
                totals["events_skipped"] += 1
                continue
            matches = existing[year].get(date.fromisoformat(event.starts_on), [])
            if len(matches) != 1:
                lines.append(f"{label}: OHITETTU, " + ("tapahtumaa ei löytynyt kannasta" if not matches else f"samana päivänä useita tapahtumia ({', '.join(match[1] for match in matches)})"))
                totals["events_skipped"] += 1
                continue
            event_id = matches[0][0]
            results: dict[tuple[frozenset[str], str], list[tuple]] = defaultdict(list)
            for performance_id, last, first, course, duration_ms, punches in connection.execute(
                    """SELECT pf.id, p.last_name, p.first_name, c.name, pf.duration_ms,
                              (SELECT count(*) FROM punch WHERE performance_id = pf.id)
                       FROM performance pf JOIN attendance a ON a.id = pf.attendance_id
                       JOIN person p ON p.id = a.person_id JOIN course c ON c.id = pf.course_id
                       WHERE a.event_id = %s""", (event_id,)).fetchall():
                results[(name_key(f"{last} {first}"), course_key(course))].append((performance_id, duration_ms, punches))
            counts: Counter[str] = Counter()
            for row in event.rows:
                splits = parse_splits(row.get("Valiajat", ""))
                if not splits:
                    continue
                name = normaliser.name(row["Nimi"])
                course = parse_course(row["Sarja_ja_matka"])[0]
                who = f"{event.starts_on} {course}: {row['Nimi']}"
                candidates = results.get((name_key(" ".join(name)) if name else frozenset(), course_key(course)), [])
                if not candidates:
                    counts["not_found"] += 1
                    problems.append(f"{who}: tulosta ei löytynyt kannasta")
                    continue
                # The same result may be there twice (PC client read + an
                # earlier OLFresults import): every copy whose time agrees and
                # that has no punches yet gets the splits.
                seconds = parse_seconds(row["Aika_tai_tila"])
                agreeing = [item for item in candidates if seconds is None or item[1] is None or abs(item[1] / 1000 - seconds) <= 1]
                if not agreeing:
                    counts["time_mismatch"] += 1
                    problems.append(f"{who}: aika kannassa {', '.join(f'{item[1] // 1000} s' for item in candidates)}, OLFresultsissa {seconds} s")
                    continue
                targets = [item for item in agreeing if not item[2]]
                if not targets:
                    counts["had_punches"] += 1
                    continue
                for performance_id, _, _ in targets:
                    importers[year].punches(performance_id, splits)
                counts["added"] += 1
            totals.update(counts)
            lines.append(f"{label}: väliajat lisätty {counts['added']}, oli jo leimaukset {counts['had_punches']}"
                         + "".join(f", {text} {counts[key]}" for key, text in (("not_found", "ei löytynyt"), ("time_mismatch", "aika ei täsmää")) if counts[key]))

        header = [
            f"OLFresults-väliajat: {series} — {'TALLENNETTU' if apply else 'KUIVAHARJOITUS (ei tallennettu)'}",
            f"Tapahtumia {len(events)}, ohitettu {totals['events_skipped']}; väliajat lisätty {totals['added']} tulokselle, "
            f"oli jo leimaukset {totals['had_punches']}, ei löytynyt {totals['not_found']}, aika ei täsmää {totals['time_mismatch']}",
            "",
        ]
        print("\n".join(header + ["Tapahtumat:"] + [f"  {line}" for line in lines]
                        + (["", "Ei lisätty:"] + [f"  {line}" for line in problems] if problems else [])))
        if apply:
            connection.commit()
        else:
            connection.rollback()


# --- Main --------------------------------------------------------------------

def main() -> None:
    global REQUEST_DELAY
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_argument_group("lähde (--event, --calendar tai --data)")
    source.add_argument("--event", metavar="LINKKI", help="OLFresults-tapahtuman linkki tai tapahtumatunnus")
    source.add_argument("--calendar", metavar="LINKKI", help="OLFresults-kalenterin linkki: kaikki sen tapahtumat, joilla on tulokset")
    source.add_argument("--winsplits", type=Path, metavar="TIEDOSTO", help="WinSplits Online -tapahtumalista (esim. tmp/winsplits_events.md); "
                        "vain --splits-only: väliajat suoraan WinSplitsistä ilman OLFresultsia")
    source.add_argument("--tapahtumasarja", help="tunnusta käytettäessä, esim. 67")
    source.add_argument("--kalenteri", help="tunnusta käytettäessä, esim. 166")
    source.add_argument("--data", type=Path, help="vientikansio (tapahtumaluettelo.csv, kaikki_tulokset_*.csv); "
                        "--eventin kanssa vain kansion seurat.csv ja nimikorjaukset.csv")
    source.add_argument("--csv", type=Path, help="tallenna haetut rivit CSV:ksi (ilman --seriesiä pelkkä CSV)")
    source.add_argument("--delimiter", default=";", choices=[";", ","], help="CSV-erotin, oletus ;")
    source.add_argument("--timeout", type=float, default=60, help="verkkopyynnön aikaraja sekunteina")
    source.add_argument("--delay", type=float, default=REQUEST_DELAY, help=f"tauko ennen jokaista verkkopyyntöä sekunteina (oletus {REQUEST_DELAY})")
    source.add_argument("--cache", type=Path, metavar="KANSIO", help="tallenna haetut sivut kansioon ja käytä niitä uudelleen (esim. kuivaharjoitus + --apply)")
    target = parser.add_argument_group("tuonti tietokantaan")
    target.add_argument("--series", help="tapahtumasarjan nimi tietokannassa")
    target.add_argument("--year", type=int, help="kauden vuosi (--event/--calendar: oletus kalenterin nimestä)")
    target.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="PostgreSQL-osoite (oletus: DATABASE_URL)")
    target.add_argument("--apply", action="store_true", help="tallenna muutokset (oletuksena kuivaharjoitus)")
    target.add_argument("--include-event", action="append", default=[], metavar="OLF_ID", help="tuo myös tapahtumaan, jolla on jo tuloksia")
    target.add_argument("--only-missing", action="store_true", help="tuo tapahtumiin, joilla on jo tuloksia, vain henkilöt, joilla ei vielä ole tulosta")
    target.add_argument("--splits-only", action="store_true", help="lisää vain rastiväliajat kannassa jo oleville tuloksille, joilla ei ole leimauksia")
    target.add_argument("--start-time", default="17:00", help="uuden tapahtuman alkamisaika alkupäivänä (oletus 17:00)")
    target.add_argument("--end-time", default="21:00", help="uuden tapahtuman päättymisaika loppupäivänä (oletus 21:00)")
    target.add_argument("--report", type=Path, help="tallenna raportti tiedostoon (oletus: <data>/tuontiraportti.txt, --eventillä tulostetaan)")
    args = parser.parse_args()
    REQUEST_DELAY = max(0.0, args.delay)
    global CACHE_DIR
    CACHE_DIR = args.cache
    if args.winsplits:
        if args.event or args.calendar or args.data or args.csv:
            parser.error("--winsplits käytetään yksinään (ilman --event/--calendar/--data/--csv)")
        if not args.splits_only:
            parser.error("--winsplits toimii vain --splits-onlyn kanssa (WinSplitsissä ei ole tulostietoja tuontiin)")
        if not args.series or not args.database_url:
            parser.error("anna --series ja --database-url (tai DATABASE_URL)")
        try:
            listed = winsplits_list(args.winsplits)
            events = {}
            for number, (starts_on, database, title) in enumerate(listed, 1):
                print(f"== WinSplits {number}/{len(listed)}", file=sys.stderr)
                event = winsplits_event(starts_on, database, title, args.timeout)
                events[event.olf_id] = event
        except (ValueError, OSError) as error:
            sys.exit(f"Virhe: {error}")
        run_splits(events, Normaliser(None), series=args.series,
                   years={olf_id: int(event.starts_on[:4]) for olf_id, event in events.items()},
                   database_url=args.database_url, apply=args.apply)
        return
    if args.event and args.calendar:
        parser.error("anna joko --event tai --calendar")
    online = args.event or args.calendar
    if not online and not args.data:
        parser.error("anna --event (OLFresults-linkki), --calendar (kalenterin linkki) tai --data (vientikansio)")
    if args.csv and not online:
        parser.error("--csv toimii vain --eventin tai --calendarin kanssa")
    csv_only = bool(args.csv and not args.series)
    if not csv_only:
        if not args.series:
            parser.error("anna --series (tai pelkkään CSV-vientiin --csv ilman --seriesiä)")
        if not args.database_url:
            parser.error("anna --database-url tai aseta DATABASE_URL")
        if not online and not args.year:
            parser.error("--data-tuonti tarvitsee --yearin")

    if online:
        try:
            links = calendar_event_ids(args.calendar, args.timeout) if args.calendar else [args.event]
        except (ValueError, OSError) as error:
            sys.exit(f"Virhe: {error}")
        events: dict[str, SourceEvent] = {}
        years: dict[str, int] = {}
        all_rows: list[list[str]] = []
        failed: list[str] = []
        unreachable = 0
        for number, link in enumerate(links, 1):
            if len(links) > 1:
                print(f"== Tapahtuma {number}/{len(links)} ({parse_qs(urlsplit(link).query)['tapahtuma'][0]})", file=sys.stderr)
            try:
                event, rows, year = fetch_event(link, args.tapahtumasarja, args.kalenteri, args.year, args.timeout)
            except (ValueError, OSError) as error:
                if len(links) == 1:
                    sys.exit(f"Virhe: {error}")
                # One event that can't be read doesn't stop a whole calendar,
                # but a server that stopped answering does.
                failed.append(f"{link}: {error}")
                print(f"Virhe, tapahtuma ohitetaan: {error}", file=sys.stderr)
                unreachable = unreachable + 1 if isinstance(error, (URLError, TimeoutError)) else 0
                if unreachable >= 2:
                    sys.exit(f"Palvelin ei vastaa ({error}). Keskeytetty, mitään ei tuotu; yritä myöhemmin uudelleen "
                             "(--delay pidentää taukoa pyyntöjen välillä).")
                continue
            unreachable = 0
            events[event.olf_id], years[event.olf_id] = event, year
            all_rows += rows
        if failed:
            print(f"\nOhitettiin {len(failed)} tapahtumaa, joita ei saatu luettua:\n  " + "\n  ".join(failed) + "\n", file=sys.stderr)
        if args.csv:
            write_csv(all_rows, args.csv, args.delimiter)
        if csv_only or not events:
            return
    else:
        events = read_export(args.data)
        years = {olf_id: args.year for olf_id in events}

    normaliser = Normaliser(args.data)
    if args.splits_only:
        run_splits(events, normaliser, series=args.series, years=years, database_url=args.database_url, apply=args.apply)
        return
    if len(set(years.values())) > 1:
        sys.exit(f"Tapahtumat ovat eri vuosilta ({', '.join(map(str, sorted(set(years.values()))))}); tuo ne kalenteri kerrallaan.")
    year = next(iter(years.values()))
    if args.event:
        event = next(iter(events.values()))
        title = f"{args.series} {year}, {event.starts_on} {split_location(event.title)[0]}"
    else:
        title = f"{args.series} {year}"
    report_path = args.report or (args.data / "tuontiraportti.txt" if args.data else None)
    run_import(events, normaliser, series=args.series, year=year,
               database_url=args.database_url, apply=args.apply, include_event=args.include_event,
               start_clock=time.fromisoformat(args.start_time), end_clock=time.fromisoformat(args.end_time),
               report_path=report_path, title=title, only_missing=args.only_missing)

if __name__ == "__main__":
    main()
