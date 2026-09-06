use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{Emit250Punch, Emit250Read};

pub struct Database {
    connection: Mutex<Connection>,
    path: PathBuf,
}

/// Local card numbers for manually added participants are allocated from this
/// range so they stay unique against the `participants.card_number` column
/// without colliding with real EMIT card numbers. They never leave this
/// client; manual results sync to the API without a card number.
const MANUAL_CARD_NUMBER_BASE: u32 = 900_000_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_participant_read_and_punches() {
        let path = std::env::temp_dir().join(format!(
            "kuntorastit-reader-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let database = Database::open(path.clone()).unwrap();
        let participant = database.create_participant(123456, "Maija", "Meikäläinen", Some("MR")).unwrap();
        let read = Emit250Read {
            port_name: "test-port".into(),
            bytes_received: 217,
            frame_found: true,
            card_number: Some(123456),
            raw_hex: "FF FF".into(),
            production_week: Some(20),
            production_year: Some(126),
            punches: vec![Emit250Punch { control_code: 31, time_seconds: 300 }],
        };
        database.save_read(&read, participant.id, "event-1", Some("course-1"), "OK").unwrap();
        let history = database.recent_reads("event-1", 20).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].participant_name, "Maija Meikäläinen");
        assert_eq!(history[0].punches[0].control_code, 31);
        assert_eq!(database.setting("reader.port").unwrap(), None);
        database.set_setting("reader.port", "/dev/test-port").unwrap();
        assert_eq!(database.setting("reader.port").unwrap().as_deref(), Some("/dev/test-port"));
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn searches_participants_locally_case_and_word_order_insensitively() {
        let path = std::env::temp_dir().join(format!(
            "kuntorastit-reader-search-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let database = Database::open(path.clone()).unwrap();
        database.create_participant(111111, "Maija", "Meikäläinen", Some("MR")).unwrap();
        database.create_participant(222222, "Pekka", "Peloton", None).unwrap();

        let by_last_name = database.search_participants("meikäl", 10).unwrap();
        assert_eq!(by_last_name.len(), 1);
        assert_eq!(by_last_name[0].first_name, "Maija");

        let by_full_name_reversed = database.search_participants("meikäläinen maija", 10).unwrap();
        assert_eq!(by_full_name_reversed.len(), 1);

        let too_short = database.search_participants("m", 10).unwrap();
        assert!(too_short.is_empty());

        let no_match = database.search_participants("nokonen", 10).unwrap();
        assert!(no_match.is_empty());

        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn adds_manual_result_without_card() {
        let path = std::env::temp_dir().join(format!(
            "kuntorastit-reader-manual-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let database = Database::open(path.clone()).unwrap();
        let read_id = database.add_manual_result("event-1", Some("course-1"), "Maija", "Meikäläinen", Some("MR"), Some("person-uuid-1"), None).unwrap();
        let history = database.recent_reads("event-1", 20).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, read_id);
        assert_eq!(history[0].participant_name, "Maija Meikäläinen");
        assert_eq!(history[0].result_status, "NO_TIME");
        assert_eq!(history[0].source, "MANUAL");
        assert_eq!(history[0].person_id.as_deref(), Some("person-uuid-1"));
        assert_eq!(history[0].manual_duration_seconds, None);
        assert!(history[0].card_number.unwrap() >= MANUAL_CARD_NUMBER_BASE);
        let second_id = database.add_manual_result("event-1", Some("course-1"), "Pekka", "Peloton", None, None, Some(2322)).unwrap();
        assert_ne!(read_id, second_id);
        let history = database.recent_reads("event-1", 20).unwrap();
        let pekka = history.iter().find(|item| item.id == second_id).unwrap();
        assert_eq!(pekka.result_status, "OK");
        assert_eq!(pekka.manual_duration_seconds, Some(2322));
        drop(database);
        let _ = std::fs::remove_file(path);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCardRead {
    pub id: i64,
    pub event_id: String,
    pub course_id: Option<String>,
    pub card_number: Option<u32>,
    pub port_name: String,
    pub read_at_ms: i64,
    pub production_week: Option<u8>,
    pub production_year: Option<u8>,
    pub punches: Vec<Emit250Punch>,
    pub participant_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub participant_name: String,
    pub club: Option<String>,
    pub result_status: String,
    pub sync_status: String,
    pub sync_error: Option<String>,
    pub source: String,
    pub person_id: Option<String>,
    pub manual_duration_seconds: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: i64,
    pub card_number: u32,
    pub first_name: String,
    pub last_name: String,
    pub club: Option<String>,
    pub api_person_id: Option<String>,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let connection = Connection::open(&path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS participants (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   card_number INTEGER NOT NULL UNIQUE,
                   first_name TEXT NOT NULL,
                   last_name TEXT NOT NULL,
                   club TEXT,
                   created_at_ms INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS settings (
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL,
                   updated_at_ms INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS card_reads (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   event_id TEXT,
                   course_id TEXT,
                   participant_id INTEGER REFERENCES participants(id),
                   card_number INTEGER,
                   port_name TEXT NOT NULL,
                   bytes_received INTEGER NOT NULL,
                   frame_found INTEGER NOT NULL,
                   raw_hex TEXT NOT NULL,
                   production_week INTEGER,
                   production_year INTEGER,
                   result_status TEXT NOT NULL DEFAULT 'OK',
                   sync_status TEXT NOT NULL DEFAULT 'PENDING',
                   sync_error TEXT,
                   read_at_ms INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS punches (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   card_read_id INTEGER NOT NULL REFERENCES card_reads(id) ON DELETE CASCADE,
                   sequence INTEGER NOT NULL,
                   control_code INTEGER NOT NULL,
                   time_seconds INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS event_registrations (
                   event_id TEXT NOT NULL,
                   participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
                   api_registration_id TEXT,
                   api_person_id TEXT,
                   course_id TEXT,
                   synced_at_ms INTEGER NOT NULL,
                   PRIMARY KEY (event_id, participant_id)
                 );
                 CREATE INDEX IF NOT EXISTS idx_card_reads_read_at ON card_reads(read_at_ms DESC);
                 CREATE INDEX IF NOT EXISTS idx_punches_card_read ON punches(card_read_id, sequence);",
            )
            .map_err(|error| error.to_string())?;
        let has_participant_id = connection
            .prepare("PRAGMA table_info(card_reads)")
            .and_then(|mut statement| {
                let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(columns.filter_map(Result::ok).any(|name| name == "participant_id"))
            })
            .map_err(|error| error.to_string())?;
        if !has_participant_id {
            connection
                .execute("ALTER TABLE card_reads ADD COLUMN participant_id INTEGER REFERENCES participants(id)", [])
                .map_err(|error| error.to_string())?;
        }
        let has_result_status = connection
            .prepare("PRAGMA table_info(card_reads)")
            .and_then(|mut statement| {
                let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(columns.filter_map(Result::ok).any(|name| name == "result_status"))
            })
            .map_err(|error| error.to_string())?;
        if !has_result_status {
            connection
                .execute("ALTER TABLE card_reads ADD COLUMN result_status TEXT NOT NULL DEFAULT 'OK'", [])
                .map_err(|error| error.to_string())?;
        }
        let has_event_id = connection
            .prepare("PRAGMA table_info(card_reads)")
            .and_then(|mut statement| {
                let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(columns.filter_map(Result::ok).any(|name| name == "event_id"))
            })
            .map_err(|error| error.to_string())?;
        if !has_event_id {
            connection
                .execute("ALTER TABLE card_reads ADD COLUMN event_id TEXT", [])
                .map_err(|error| error.to_string())?;
        }
        for (column, definition) in [
            ("course_id", "TEXT"),
            ("sync_status", "TEXT NOT NULL DEFAULT 'PENDING'"),
            ("sync_error", "TEXT"),
            ("source", "TEXT NOT NULL DEFAULT 'EMIT'"),
            ("person_id", "TEXT"),
            ("manual_duration_seconds", "INTEGER"),
        ] {
            let exists = connection
                .prepare("PRAGMA table_info(card_reads)")
                .and_then(|mut statement| {
                    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                    Ok(columns.filter_map(Result::ok).any(|name| name == column))
                })
                .map_err(|error| error.to_string())?;
            if !exists {
                connection
                    .execute(&format!("ALTER TABLE card_reads ADD COLUMN {column} {definition}"), [])
                    .map_err(|error| error.to_string())?;
            }
        }
        let has_api_person_id = connection
            .prepare("PRAGMA table_info(participants)")
            .and_then(|mut statement| {
                let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(columns.filter_map(Result::ok).any(|name| name == "api_person_id"))
            })
            .map_err(|error| error.to_string())?;
        if !has_api_person_id {
            connection
                .execute("ALTER TABLE participants ADD COLUMN api_person_id TEXT", [])
                .map_err(|error| error.to_string())?;
        }
        connection
            .execute("CREATE INDEX IF NOT EXISTS idx_card_reads_event_time ON card_reads(event_id, read_at_ms DESC)", [])
            .map_err(|error| error.to_string())?;
        Ok(Self {
            connection: Mutex::new(connection),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let mut statement = connection
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .map_err(|error| error.to_string())?;
        let mut rows = statement.query([key]).map_err(|error| error.to_string())?;
        Ok(rows
            .next()
            .map_err(|error| error.to_string())?
            .map(|row| row.get(0).map_err(|error| error.to_string()))
            .transpose()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let updated_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis() as i64;
        connection
            .execute(
                "INSERT INTO settings (key, value, updated_at_ms) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms",
                params![key, value, updated_at_ms],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn clear_setting(&self, key: &str) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        connection
            .execute("DELETE FROM settings WHERE key = ?1", [key])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn participant_by_card(&self, card_number: u32) -> Result<Option<Participant>, String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let mut statement = connection
            .prepare("SELECT id, card_number, first_name, last_name, club, api_person_id FROM participants WHERE card_number = ?1")
            .map_err(|error| error.to_string())?;
        let mut rows = statement.query([card_number]).map_err(|error| error.to_string())?;
        let Some(row) = rows.next().map_err(|error| error.to_string())? else { return Ok(None) };
        Ok(Some(Participant {
            id: row.get(0).map_err(|error| error.to_string())?,
            card_number: row.get(1).map_err(|error| error.to_string())?,
            first_name: row.get(2).map_err(|error| error.to_string())?,
            last_name: row.get(3).map_err(|error| error.to_string())?,
            club: row.get(4).map_err(|error| error.to_string())?,
            api_person_id: row.get(5).map_err(|error| error.to_string())?,
        }))
    }

    pub fn participant_by_card_for_event(&self, event_id: &str, card_number: u32) -> Result<Option<Participant>, String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let mut statement = connection.prepare(
            "SELECT p.id, p.card_number, p.first_name, p.last_name, p.club, p.api_person_id
             FROM participants p
             JOIN event_registrations er ON er.participant_id = p.id
             WHERE er.event_id = ?1 AND p.card_number = ?2",
        ).map_err(|error| error.to_string())?;
        let mut rows = statement.query(params![event_id, card_number]).map_err(|error| error.to_string())?;
        let Some(row) = rows.next().map_err(|error| error.to_string())? else { return Ok(None) };
        Ok(Some(Participant {
            id: row.get(0).map_err(|error| error.to_string())?,
            card_number: row.get(1).map_err(|error| error.to_string())?,
            first_name: row.get(2).map_err(|error| error.to_string())?,
            last_name: row.get(3).map_err(|error| error.to_string())?,
            club: row.get(4).map_err(|error| error.to_string())?,
            api_person_id: row.get(5).map_err(|error| error.to_string())?,
        }))
    }

    /// Finds locally known participants (from EMIT registration sync, prior
    /// card reads, or earlier manual entries) whose name contains `query`.
    /// Used for the "Hae henkilöä" find-as-you-type box, kept local so it
    /// works without a network connection.
    pub fn search_participants(&self, query: &str, limit: usize) -> Result<Vec<Participant>, String> {
        let trimmed = query.trim();
        if trimmed.chars().count() < 2 {
            return Ok(Vec::new());
        }
        let needle = trimmed.to_lowercase();
        let words: Vec<String> = needle.split_whitespace().map(str::to_string).collect();
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let mut statement = connection
            .prepare("SELECT id, card_number, first_name, last_name, club, api_person_id FROM participants ORDER BY last_name, first_name")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(Participant {
                    id: row.get(0)?,
                    card_number: row.get(1)?,
                    first_name: row.get(2)?,
                    last_name: row.get(3)?,
                    club: row.get(4)?,
                    api_person_id: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?;
        let mut matches = Vec::new();
        for participant in rows {
            let participant = participant.map_err(|error| error.to_string())?;
            let first = participant.first_name.to_lowercase();
            let last = participant.last_name.to_lowercase();
            let matched = if words.len() > 1 {
                let rest = words[1..].join(" ");
                (first.contains(&words[0]) && last.contains(&rest)) || (last.contains(&words[0]) && first.contains(&rest))
            } else {
                first.contains(&needle) || last.contains(&needle)
            };
            if matched {
                matches.push(participant);
                if matches.len() >= limit {
                    break;
                }
            }
        }
        Ok(matches)
    }

    pub fn link_participant_to_event(&self, event_id: &str, participant_id: i64, course_id: Option<&str>) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let synced_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis() as i64;
        connection.execute(
            "INSERT INTO event_registrations (event_id, participant_id, course_id, synced_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(event_id, participant_id) DO UPDATE SET course_id = excluded.course_id, synced_at_ms = excluded.synced_at_ms",
            params![event_id, participant_id, course_id, synced_at_ms],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn create_participant(&self, card_number: u32, first_name: &str, last_name: &str, club: Option<&str>) -> Result<Participant, String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let created_at_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis() as i64;
        connection.execute(
            "INSERT INTO participants (card_number, first_name, last_name, club, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(card_number) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, club = excluded.club",
            params![card_number, first_name.trim(), last_name.trim(), club.filter(|value| !value.trim().is_empty()).map(str::trim), created_at_ms],
        ).map_err(|error| error.to_string())?;
        let id = connection.query_row("SELECT id FROM participants WHERE card_number = ?1", [card_number], |row| row.get(0)).map_err(|error| error.to_string())?;
        Ok(Participant { id, card_number, first_name: first_name.trim().into(), last_name: last_name.trim().into(), club: club.filter(|value| !value.trim().is_empty()).map(|value| value.trim().into()), api_person_id: None })
    }

    /// Corrects a participant's name/club before confirming a result, since the
    /// name cached locally for a card can be stale or was mistyped originally.
    pub fn update_participant_details(&self, participant_id: i64, first_name: &str, last_name: &str, club: Option<&str>) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        connection.execute(
            "UPDATE participants SET first_name = ?1, last_name = ?2, club = ?3 WHERE id = ?4",
            params![first_name.trim(), last_name.trim(), club.filter(|value| !value.trim().is_empty()).map(str::trim), participant_id],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    /// Adds a participant directly to the results without a card read, e.g. when
    /// the reader missed them or they need to be entered by hand. If
    /// `duration_seconds` is given the result is stored as an accepted time
    /// (`OK`); otherwise it is stored as `NO_TIME`. Allocates a local-only
    /// placeholder card number to satisfy the participants table constraint;
    /// this number is never sent to the API.
    pub fn add_manual_result(&self, event_id: &str, course_id: Option<&str>, first_name: &str, last_name: &str, club: Option<&str>, person_id: Option<&str>, duration_seconds: Option<i64>) -> Result<i64, String> {
        if first_name.trim().is_empty() || last_name.trim().is_empty() {
            return Err("Etunimi ja sukunimi ovat pakollisia.".into());
        }
        let result_status = if duration_seconds.is_some() { "OK" } else { "NO_TIME" };
        let mut connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis() as i64;
        let next_card_number: u32 = transaction
            .query_row(
                "SELECT COALESCE(MAX(card_number), ?1) + 1 FROM participants WHERE card_number >= ?1",
                [MANUAL_CARD_NUMBER_BASE],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO participants (card_number, first_name, last_name, club, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![next_card_number, first_name.trim(), last_name.trim(), club.filter(|value| !value.trim().is_empty()).map(str::trim), now_ms],
        ).map_err(|error| error.to_string())?;
        let participant_id = transaction.last_insert_rowid();
        transaction.execute(
            "INSERT INTO event_registrations (event_id, participant_id, course_id, synced_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(event_id, participant_id) DO UPDATE SET course_id = excluded.course_id, synced_at_ms = excluded.synced_at_ms",
            params![event_id, participant_id, course_id, now_ms],
        ).map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO card_reads
             (event_id, course_id, participant_id, card_number, port_name, bytes_received, frame_found, raw_hex,
              result_status, sync_status, source, person_id, manual_duration_seconds, read_at_ms)
             VALUES (?1, ?2, ?3, ?4, 'manual', 0, 0, '', ?5, 'PENDING', 'MANUAL', ?6, ?7, ?8)",
            params![event_id, course_id, participant_id, next_card_number, result_status, person_id, duration_seconds, now_ms],
        ).map_err(|error| error.to_string())?;
        let read_id = transaction.last_insert_rowid();
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(read_id)
    }

    pub fn save_read(&self, read: &Emit250Read, participant_id: i64, event_id: &str, course_id: Option<&str>, result_status: &str) -> Result<i64, String> {
        if !matches!(result_status, "OK" | "NO_TIME" | "DISQUALIFIED" | "MISSING_CONTROL") {
            return Err("Tuntematon tuloksen tila.".into());
        }
        let mut connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let read_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis() as i64;
        transaction
            .execute(
                "INSERT INTO card_reads
                 (event_id, course_id, participant_id, card_number, port_name, bytes_received, frame_found, raw_hex,
                  production_week, production_year, result_status, sync_status, read_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'PENDING', ?12)",
                params![
                    event_id,
                    course_id,
                    participant_id,
                    read.card_number,
                    read.port_name,
                    read.bytes_received as i64,
                    read.frame_found,
                    read.raw_hex,
                    read.production_week,
                    read.production_year,
                    result_status,
                    read_at_ms
                ],
            )
            .map_err(|error| error.to_string())?;
        let read_id = transaction.last_insert_rowid();
        for (sequence, punch) in read.punches.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO punches (card_read_id, sequence, control_code, time_seconds)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![read_id, sequence as i64, punch.control_code, punch.time_seconds],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(read_id)
    }

    pub fn update_read_status(&self, read_id: i64, result_status: &str) -> Result<(), String> {
        if !matches!(result_status, "OK" | "NO_TIME" | "DISQUALIFIED" | "MISSING_CONTROL") {
            return Err("Tuntematon tuloksen tila.".into());
        }
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let changed = connection
            .execute(
                "UPDATE card_reads SET result_status = ?1, sync_status = 'PENDING', sync_error = NULL WHERE id = ?2",
                params![result_status, read_id],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("Lukutulosta ei löytynyt.".into());
        }
        Ok(())
    }

    pub fn mark_read_sync(&self, read_id: i64, synced: bool, error: Option<&str>) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        connection.execute(
            "UPDATE card_reads SET sync_status = ?1, sync_error = ?2 WHERE id = ?3",
            params![if synced { "SYNCED" } else { "ERROR" }, error, read_id],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn recent_reads(&self, event_id: &str, limit: usize) -> Result<Vec<StoredCardRead>, String> {
        let connection = self.connection.lock().map_err(|_| "Tietokanta on lukittu")?;
        let mut statement = connection
            .prepare(
                "SELECT r.id, r.event_id, r.course_id, r.card_number, r.port_name, r.read_at_ms, r.production_week,
                        r.production_year, p.id, p.first_name, p.last_name, p.club,
                        r.result_status, r.sync_status, r.sync_error, r.source, r.person_id, r.manual_duration_seconds
                 FROM card_reads r JOIN participants p ON p.id = r.participant_id
                 WHERE r.event_id = ?1
                 ORDER BY r.read_at_ms DESC LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![event_id, limit.min(300) as i64], |row| {
                Ok(StoredCardRead {
                    id: row.get(0)?,
                    event_id: row.get(1)?,
                    course_id: row.get(2)?,
                    card_number: row.get(3)?,
                    port_name: row.get(4)?,
                    read_at_ms: row.get(5)?,
                    production_week: row.get(6)?,
                    production_year: row.get(7)?,
                    punches: Vec::new(),
                    participant_id: row.get(8)?,
                    first_name: row.get(9)?,
                    last_name: row.get(10)?,
                    participant_name: format!("{} {}", row.get::<_, String>(9)?, row.get::<_, String>(10)?),
                    club: row.get(11)?,
                    result_status: row.get(12)?,
                    sync_status: row.get(13)?,
                    sync_error: row.get(14)?,
                    source: row.get(15)?,
                    person_id: row.get(16)?,
                    manual_duration_seconds: row.get(17)?,
                })
            })
            .map_err(|error| error.to_string())?;
        let mut reads = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        for read in &mut reads {
            let mut punches = connection
                .prepare(
                    "SELECT control_code, time_seconds FROM punches
                     WHERE card_read_id = ?1 ORDER BY sequence",
                )
                .map_err(|error| error.to_string())?;
            read.punches = punches
                .query_map([read.id], |row| {
                    Ok(Emit250Punch {
                        control_code: row.get(0)?,
                        time_seconds: row.get(1)?,
                    })
                })
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
        }
        Ok(reads)
    }
}
