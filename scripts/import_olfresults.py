#!/usr/bin/env python3
"""Import a season's events and results exported from OLFresults.

Reads an export folder (tapahtumaluettelo.csv + kaikki_tulokset_<year>.csv,
semicolon-separated UTF-8) and writes events, courses, clubs, persons,
attendances and performances straight into the PostgreSQL database, in one
transaction. Without --apply everything is rolled back at the end, so a dry
run reports exactly what an import would do.

    pip install "psycopg[binary]" tzdata
    python scripts/import_olfresults.py --data tmp/maanantairastit_2026 \\
        --series "Kokkolan Maanantairastit" --year 2026 \\
        --database-url postgresql://kuntorastit:...@localhost:15432/kuntorastit
    # check the report, then the same command with --apply

- The series and season must exist (Kaudet page in the admin UI).
- Events are matched to the season's existing events by start date (local
  time); unmatched ones are created. Events that already have results are
  skipped unless named with --include-event <OLFresults id>, so results read
  with the PC client are not duplicated.
- Every performance carries client_reference "olfresults:<event>:<course
  page>:<row>", so running the import again updates instead of duplicating.
- seurat.csv (club spellings) and nimikorjaukset.csv (name fixes) in the
  data folder are applied when present; see their header comments.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg

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


class Normaliser:
    def __init__(self, data: Path):
        rows = read_mapping(data / "seurat.csv")
        self.clubs = {row["Lahde"].strip().lower(): row["Seura"].strip() for row in rows}
        self.spellings = [(row["Lahde"].strip(), row["Seura"].strip()) for row in rows]
        self.names = {row["Lahde"].strip(): (row["Sukunimi"].strip(), row["Etunimi"].strip()) for row in read_mapping(data / "nimikorjaukset.csv")}

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


def load_export(data: Path, normaliser: Normaliser, report: list[str]):
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
            event_results.append(Result(reference, name[0], name[1], normaliser.club(row["Seura"]), course, status, source, seconds, raw))
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
    def __init__(self, connection: psycopg.Connection, season_id: str):
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
        self.db.execute(
            """INSERT INTO performance (id, attendance_id, course_id, source, status, duration_ms, read_at, client_reference, created_at, updated_at)
               VALUES (%s, %s, %s, %s::"PerformanceSource", %s::"PerformanceStatus", %s, %s, %s, %s, %s)
               ON CONFLICT (client_reference) DO UPDATE SET
                 attendance_id = EXCLUDED.attendance_id, course_id = EXCLUDED.course_id, source = EXCLUDED.source,
                 status = EXCLUDED.status, duration_ms = EXCLUDED.duration_ms, read_at = EXCLUDED.read_at,
                 updated_at = EXCLUDED.updated_at, version = performance.version + 1""",
            (new_id(), attendance_id, course_id, result.source, result.status, duration_ms, read_at, result.reference, self.now, self.now))

    def registration(self, event_id: str, person_id: str, course_id: str, registered_at: datetime) -> None:
        self.db.execute(
            """INSERT INTO registration (id, event_id, person_id, course_id, notes, registered_at)
               VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (event_id, person_id) DO NOTHING""",
            (new_id(), event_id, person_id, course_id, "Tuotu OLFresultsista", registered_at))


def find_season(connection: psycopg.Connection, series: str, year: int) -> str:
    row = connection.execute(
        """SELECT s.id FROM season s JOIN event_series es ON es.id = s.event_series_id
           WHERE lower(es.name) = lower(%s) AND s.year = %s""", (series, year)).fetchone()
    if row:
        return str(row[0])
    available = connection.execute(
        "SELECT es.name, s.year FROM season s JOIN event_series es ON es.id = s.event_series_id ORDER BY es.name, s.year").fetchall()
    listing = "\n  ".join(f"{name} {season_year}" for name, season_year in available) or "(ei kausia)"
    sys.exit(f"Kautta \"{series}\" {year} ei löytynyt. Luo se ylläpidon Kaudet-sivulla. Olemassa olevat kaudet:\n  {listing}")


# --- Main --------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Tuo OLFresults-viennin tapahtumat ja tulokset kuntorastien tietokantaan.")
    parser.add_argument("--data", type=Path, required=True, help="vientikansio (tapahtumaluettelo.csv, kaikki_tulokset_*.csv)")
    parser.add_argument("--series", required=True, help="tapahtumasarjan nimi tietokannassa")
    parser.add_argument("--year", type=int, required=True, help="kauden vuosi")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="PostgreSQL-osoite (oletus: DATABASE_URL)")
    parser.add_argument("--apply", action="store_true", help="tallenna muutokset (oletuksena kuivaharjoitus)")
    parser.add_argument("--include-event", action="append", default=[], metavar="OLF_ID", help="tuo myös tapahtumaan, jolla on jo tuloksia")
    parser.add_argument("--start-time", default="17:00", help="uuden tapahtuman alkamisaika alkupäivänä (oletus 17:00)")
    parser.add_argument("--end-time", default="21:00", help="uuden tapahtuman päättymisaika loppupäivänä (oletus 21:00)")
    parser.add_argument("--report", type=Path, help="tallenna raportti tiedostoon (oletus: <data>/tuontiraportti.txt)")
    args = parser.parse_args()
    if not args.database_url:
        parser.error("anna --database-url tai aseta DATABASE_URL")
    start_clock, end_clock = time.fromisoformat(args.start_time), time.fromisoformat(args.end_time)

    report: list[str] = []
    normaliser = Normaliser(args.data)
    events, results, courses, skipped = load_export(args.data, normaliser, report)
    unknown_includes = set(args.include_event) - set(events)
    if unknown_includes:
        sys.exit(f"--include-event: tuntemattomat tapahtumat {', '.join(sorted(unknown_includes))}")

    # Prisma stores timestamps as UTC in "timestamp without time zone".
    with psycopg.connect(args.database_url, options="-c timezone=UTC") as connection:
        importer = Importer(connection, find_season(connection, args.series, args.year))
        existing = importer.existing_events()
        today = datetime.now(TIMEZONE).date()
        lines: list[str] = []
        dropped_lines: list[str] = []
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
                if performance_count and event.olf_id not in args.include_event:
                    lines.append(f"{label}: OHITETTU, tapahtumalla \"{existing_name}\" on jo {performance_count} tulosta (tuo silti: --include-event {event.olf_id})")
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
            for result in dropped:
                dropped_lines.append(f"{event.starts_on} {result.course}: {result.last_name} {result.first_name} \"{result.raw_status}\" (paremmin sijoittunut tulos jää voimaan)")
            statuses: Counter[str] = Counter()
            for result in kept:
                club_id = importer.club_id(result.club, None)
                person_id = importer.person_id(result.last_name, result.first_name, club_id)
                attendance_id = importer.attendance_id(event_id, person_id, starts_at)
                importer.performance(attendance_id, course_ids[result.course], result, starts_at)
                statuses[result.raw_status if result.seconds is None else "aika"] += 1
            for result in (item for item in event_results if item.status is None):
                club_id = importer.club_id(result.club, None)
                importer.registration(event_id, importer.person_id(result.last_name, result.first_name, club_id), course_ids[result.course], starts_at)
                statuses[result.raw_status] += 1
            totals["performances"] += len(kept)
            totals["dropped"] += len(dropped)
            summary = ", ".join(f"{key} {count}" for key, count in statuses.most_common())
            lines.append(f"{label}: {action}; ratoja {len(course_ids)} (uusia {created_courses}); tuloksia {len(kept)} — {summary}")

        # Source club spellings become aliases of the club they map to.
        for spelling, target in normaliser.spellings:
            if target and target.lower() in importer.club_ids:
                importer.club_id(target, spelling)

        header = [
            f"OLFresults-tuonti: {args.series} {args.year} — {'TALLENNETTU' if args.apply else 'KUIVAHARJOITUS (ei tallennettu)'}",
            f"Tapahtumia: luodaan {totals['created_events']}, päivitetään {totals['matched_events']}, ohitetaan {totals['skipped_events']}",
            f"Tuloksia: {totals['performances']}; saman radan päällekkäisiä ohitettu {totals['dropped']}; rivejä ohitettu {len(skipped)}",
            f"Uusia henkilöitä {importer.new_persons}, uusia seuroja {len(importer.new_clubs)}" + (f": {', '.join(sorted(importer.new_clubs))}" if importer.new_clubs else ""),
            "",
        ]
        output = header + report + ["Tapahtumat:"] + [f"  {line}" for line in lines]
        if skipped:
            output += ["", "Ohitetut rivit (korjaa nimikorjaukset.csv:ssä):"] + [f"  {line}" for line in skipped]
        if dropped_lines:
            output += ["", "Saman henkilön useampi tulos samalla radalla (vain paras tuodaan):"] + [f"  {line}" for line in dropped_lines]
        text = "\n".join(output) + "\n"
        report_path = args.report or args.data / "tuontiraportti.txt"
        report_path.write_text(text, encoding="utf-8")
        print("\n".join(header + report))
        print(f"Täysi raportti: {report_path}")

        if args.apply:
            connection.commit()
        else:
            connection.rollback()


if __name__ == "__main__":
    main()
