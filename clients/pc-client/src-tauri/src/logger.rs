use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// When the log grows past this, it is moved to client.log.1 (replacing the
/// previous one) and a new file is started, so the log never fills the disk.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// Debug log in the OS log directory, written by the Rust side (serial port,
/// card frames) and the frontend (calendar, sync, confirmations) through the
/// `write_log` command, and opened from Asetukset. Logging never fails the
/// caller: a log that cannot be written is skipped.
pub struct Logger {
    path: PathBuf,
    file: Mutex<Option<File>>,
}

impl Logger {
    pub fn open(directory: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&directory);
        let path = directory.join("client.log");
        let file = OpenOptions::new().create(true).append(true).open(&path).ok();
        Self { path, file: Mutex::new(file) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn write(&self, level: &str, source: &str, message: &str) {
        let Ok(mut file) = self.file.lock() else { return };
        if file.as_ref().and_then(|current| current.metadata().ok()).is_some_and(|metadata| metadata.len() > MAX_LOG_BYTES) {
            *file = None;
            let _ = std::fs::rename(&self.path, self.path.with_extension("log.1"));
            *file = OpenOptions::new().create(true).append(true).open(&self.path).ok();
        }
        if let Some(file) = file.as_mut() {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn writes_single_line_entries() {
        let directory = std::env::temp_dir().join(format!(
            "kuntorastit-log-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let logger = Logger::open(directory.clone());
        logger.info("test", "first");
        logger.error("test", "two\nlines");
        let contents = std::fs::read_to_string(logger.path()).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("INFO  [test] first"));
        assert!(lines[1].ends_with("ERROR [test] two ⏎ lines"));
        let _ = std::fs::remove_dir_all(directory);
    }
}
