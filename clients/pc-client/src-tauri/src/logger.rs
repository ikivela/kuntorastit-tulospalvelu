use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// When a day's log grows past this, it is moved to <file>.1 (replacing the
/// previous one) and a new file is started for the rest of the day.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Daily logs older than this are deleted when a new day's log is started.
const KEEP_DAYS: i64 = 60;

/// Debug log in the OS log directory, one file per day the client is used
/// (client-YYYY-MM-DD.log, created on the day's first entry), written by the
/// Rust side (serial port, card frames) and the frontend (calendar, sync,
/// confirmations) through the `write_log` command, and opened from
/// Asetukset. Logging never fails the caller: a log that cannot be written is
/// skipped.
pub struct Logger {
    directory: PathBuf,
    current: Mutex<Option<(String, File)>>,
}

impl Logger {
    pub fn open(directory: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&directory);
        Self { directory, current: Mutex::new(None) }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Today's log file (it exists once something has been logged today).
    pub fn path(&self) -> PathBuf {
        self.path_for(&today())
    }

    fn path_for(&self, day: &str) -> PathBuf {
        self.directory.join(format!("client-{day}.log"))
    }

    pub fn write(&self, level: &str, source: &str, message: &str) {
        let Ok(mut current) = self.current.lock() else { return };
        let day = today();
        let path = self.path_for(&day);
        if current.as_ref().map(|(open_day, _)| open_day != &day).unwrap_or(true) {
            // First entry of the day (or of this run): switch files, and clear
            // out old days now and then rather than on every write.
            *current = OpenOptions::new().create(true).append(true).open(&path).ok().map(|file| (day.clone(), file));
            self.remove_old_logs();
        }
        if current.as_ref().and_then(|(_, file)| file.metadata().ok()).is_some_and(|metadata| metadata.len() > MAX_LOG_BYTES) {
            *current = None;
            let _ = std::fs::rename(&path, path.with_extension("log.1"));
            *current = OpenOptions::new().create(true).append(true).open(&path).ok().map(|file| (day.clone(), file));
        }
        if let Some((_, file)) = current.as_mut() {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            // One line per entry, so a multi-line message cannot fake entries.
            let message = message.replace(['\r', '\n'], " ⏎ ");
            let _ = writeln!(file, "{timestamp} {level:<5} [{source}] {message}");
        }
    }

    pub fn info(&self, source: &str, message: &str) {
        self.write("INFO", source, message);
    }

    pub fn error(&self, source: &str, message: &str) {
        self.write("ERROR", source, message);
    }

    /// Deletes daily logs (and their .1 overflow files) older than KEEP_DAYS.
    fn remove_old_logs(&self) {
        let oldest = (chrono::Local::now().date_naive() - chrono::Duration::days(KEEP_DAYS)).format("%Y-%m-%d").to_string();
        let Ok(entries) = std::fs::read_dir(&self.directory) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let expired = name
                .strip_prefix("client-")
                .and_then(|rest| rest.get(..10))
                .is_some_and(|day| day < oldest.as_str());
            if expired {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn writes_single_line_entries_to_todays_file_and_drops_old_days() {
        let directory = std::env::temp_dir().join(format!(
            "kuntorastit-log-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let old = directory.join("client-2000-01-01.log");
        let recent = directory.join(format!("client-{}.log.1", today()));
        std::fs::write(&old, "old").unwrap();
        std::fs::write(&recent, "earlier today").unwrap();

        let logger = Logger::open(directory.clone());
        logger.info("test", "first");
        logger.error("test", "two\nlines");

        assert!(logger.path().ends_with(format!("client-{}.log", today())));
        let contents = std::fs::read_to_string(logger.path()).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("INFO  [test] first"));
        assert!(lines[1].ends_with("ERROR [test] two ⏎ lines"));
        assert!(!old.exists());
        assert!(recent.exists());
        let _ = std::fs::remove_dir_all(directory);
    }
}
