mod database;

use database::{ApiRegistration, Database, Participant, StoredCardRead};
use serde::Serialize;
use serialport::{DataBits, Parity, SerialPort, SerialPortType, StopBits};
use std::io::Read;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};

const EMIT_250_BAUD_RATE: u32 = 9_600;
const EMIT_250_FRAME_LENGTH: usize = 217;
const EMIT_OD: u8 = 255 - 32;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SerialDevice {
    port_name: String,
    port_type: String,
    vid: Option<u16>,
    pid: Option<u16>,
    manufacturer: Option<String>,
    product: Option<String>,
    serial_number: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Emit250Read {
    port_name: String,
    bytes_received: usize,
    frame_found: bool,
    card_number: Option<u32>,
    raw_hex: String,
    production_week: Option<u8>,
    production_year: Option<u8>,
    punches: Vec<Emit250Punch>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Emit250Punch {
    control_code: u8,
    time_seconds: u16,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Emit250Status {
    port_name: String,
    bytes_received: usize,
}

struct ReaderState {
    listening: Arc<AtomicBool>,
    latest_read: Arc<Mutex<Option<Emit250Read>>>,
}

#[tauri::command]
fn list_serial_devices() -> Result<Vec<SerialDevice>, String> {
    let ports = serialport::available_ports().map_err(|error| error.to_string())?;

    Ok(ports
        .into_iter()
        .map(|port| match port.port_type {
            SerialPortType::UsbPort(usb) => SerialDevice {
                port_name: port.port_name,
                port_type: "usb".into(),
                vid: Some(usb.vid),
                pid: Some(usb.pid),
                manufacturer: usb.manufacturer,
                product: usb.product,
                serial_number: usb.serial_number,
            },
            SerialPortType::BluetoothPort => SerialDevice {
                port_name: port.port_name,
                port_type: "bluetooth".into(),
                vid: None,
                pid: None,
                manufacturer: None,
                product: None,
                serial_number: None,
            },
            SerialPortType::PciPort => SerialDevice {
                port_name: port.port_name,
                port_type: "pci".into(),
                vid: None,
                pid: None,
                manufacturer: None,
                product: None,
                serial_number: None,
            },
            SerialPortType::Unknown => SerialDevice {
                port_name: port.port_name,
                port_type: "unknown".into(),
                vid: None,
                pid: None,
                manufacturer: None,
                product: None,
                serial_number: None,
            },
        })
        .collect())
}

#[tauri::command]
fn start_emit250(
    app: AppHandle,
    state: State<'_, ReaderState>,
    port_name: String,
) -> Result<(), String> {
    if state.listening.load(Ordering::SeqCst) {
        return Err("EMIT-kuuntelu on jo käynnissä.".into());
    }
    *state
        .latest_read
        .lock()
        .map_err(|_| "Lukutilan avaaminen epäonnistui.".to_string())? = None;
    let port = serialport::new(&port_name, EMIT_250_BAUD_RATE)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)
        .stop_bits(StopBits::Two)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|error| format!("Could not open {port_name}: {error}"))?;
    state.listening.store(true, Ordering::SeqCst);
    let listening = Arc::clone(&state.listening);
    let latest_read = Arc::clone(&state.latest_read);
    std::thread::spawn(move || {
        if let Err(error) = read_emit250_loop(&app, &port_name, port, &listening, &latest_read) {
            let _ = app.emit("emit250://error", error);
        }
        listening.store(false, Ordering::SeqCst);
        let _ = app.emit("emit250://stopped", ());
    });
    Ok(())
}

#[tauri::command]
fn stop_emit250(state: State<'_, ReaderState>) {
    state.listening.store(false, Ordering::SeqCst);
}

#[tauri::command]
fn latest_emit250_read(state: State<'_, ReaderState>) -> Result<Option<Emit250Read>, String> {
    state
        .latest_read
        .lock()
        .map(|result| result.clone())
        .map_err(|_| "Lukutilan lukeminen epäonnistui.".to_string())
}

fn read_emit250_loop(
    app: &AppHandle,
    port_name: &str,
    mut port: Box<dyn SerialPort>,
    listening: &AtomicBool,
    latest_read: &Mutex<Option<Emit250Read>>,
) -> Result<(), String> {
    app.emit("emit250://opened", port_name.to_owned())
        .map_err(|error| format!("Could not publish reader status: {error}"))?;
    let mut raw = Vec::new();
    let mut bytes_received = 0;
    let mut buffer = [0u8; 256];
    while listening.load(Ordering::SeqCst) {
        let available = port.bytes_to_read().unwrap_or(0);
        if available > 0 {
            match port.read(&mut buffer) {
                Ok(count) => {
                    bytes_received += count;
                    raw.extend_from_slice(&buffer[..count]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(error) => {
                    return Err(format!("Read failed on {port_name}: {error}"));
                }
            }
        } else {
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = app.emit(
            "emit250://status",
            Emit250Status {
                port_name: port_name.to_owned(),
                bytes_received,
            },
        );
        if let Some(frame) = find_emit250_frame(&raw) {
            let result = Emit250Read {
                port_name: port_name.to_owned(),
                bytes_received,
                frame_found: true,
                card_number: Some(
                    u32::from(frame[2]) | (u32::from(frame[3]) << 8) | (u32::from(frame[4]) << 16),
                ),
                raw_hex: frame
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect::<Vec<_>>()
                    .join(" "),
                production_week: Some(frame[6]),
                production_year: Some(frame[7]),
                punches: parse_punches(&frame),
            };
            if let Ok(mut latest) = latest_read.lock() {
                *latest = Some(result.clone());
            }
            app.emit("emit250://read", result)
                .map_err(|error| format!("Could not publish EMIT read: {error}"))?;
            raw.clear();
            listening.store(false, Ordering::SeqCst);
        }
        if raw.len() > EMIT_250_FRAME_LENGTH * 4 {
            raw.drain(..EMIT_250_FRAME_LENGTH);
        }
    }
    Ok(())
}

#[tauri::command]
async fn probe_emit250(port_name: String, seconds: Option<u64>) -> Result<Emit250Read, String> {
    tauri::async_runtime::spawn_blocking(move || read_emit250(port_name, seconds))
        .await
        .map_err(|error| format!("EMIT reader task failed: {error}"))?
}

fn read_emit250(port_name: String, seconds: Option<u64>) -> Result<Emit250Read, String> {
    let mut port = serialport::new(&port_name, EMIT_250_BAUD_RATE)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)
        .stop_bits(StopBits::Two)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|error| format!("Could not open {port_name}: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(seconds.unwrap_or(15).clamp(1, 60));
    let mut raw = Vec::new();
    let mut buffer = [0u8; 256];

    while Instant::now() < deadline && raw.len() < 4096 {
        match port.read(&mut buffer) {
            Ok(count) => raw.extend_from_slice(&buffer[..count]),
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(format!("Read failed on {port_name}: {error}")),
        }

        if find_emit250_frame(&raw).is_some() {
            break;
        }
    }

    let decoded_frame = find_emit250_frame(&raw);
    let card_number = decoded_frame.as_ref().map(|frame| {
        u32::from(frame[2]) | (u32::from(frame[3]) << 8) | (u32::from(frame[4]) << 16)
    });
    let punches = decoded_frame
        .as_ref()
        .map(|frame| parse_punches(frame))
        .unwrap_or_default();

    Ok(Emit250Read {
        port_name,
        bytes_received: raw.len(),
        frame_found: decoded_frame.is_some(),
        card_number,
        raw_hex: raw
            .iter()
            .take(512)
            .map(|b| format!("{b:02X}"))
            .collect::<Vec<_>>()
            .join(" "),
        production_week: decoded_frame.as_ref().map(|frame| frame[6]),
        production_year: decoded_frame.as_ref().map(|frame| frame[7]),
        punches,
    })
}

fn find_emit250_frame(raw: &[u8]) -> Option<Vec<u8>> {
    let decoded: Vec<u8> = raw.iter().map(|byte| byte ^ EMIT_OD).collect();

    decoded
        .windows(EMIT_250_FRAME_LENGTH)
        .find(|window| window[0] == 0xff && window[1] == 0xff && checksum_is_valid(window))
        .map(|window| window.to_vec())
}

fn checksum_is_valid(frame: &[u8]) -> bool {
    frame.len() == EMIT_250_FRAME_LENGTH
        && frame.iter().map(|byte| u16::from(*byte)).sum::<u16>() % 256 == 0
}

fn parse_punches(frame: &[u8]) -> Vec<Emit250Punch> {
    (0..50)
        .filter_map(|index| {
            let offset = 10 + index * 3;
            let control_code = frame[offset];
            let time_seconds = u16::from(frame[offset + 1]) | (u16::from(frame[offset + 2]) << 8);
            (control_code != 0 || time_seconds != 0).then_some(Emit250Punch {
                control_code,
                time_seconds,
            })
        })
        .collect()
}

#[tauri::command]
fn recent_card_reads(database: State<'_, Database>, event_id: String, limit: Option<usize>) -> Result<Vec<StoredCardRead>, String> {
    database.recent_reads(&event_id, limit.unwrap_or(20))
}

#[tauri::command]
fn database_path(database: State<'_, Database>) -> String {
    database.path().display().to_string()
}

#[tauri::command]
fn reader_port_setting(database: State<'_, Database>) -> Result<Option<String>, String> {
    database.setting("reader.port")
}

#[tauri::command]
fn set_reader_port_setting(database: State<'_, Database>, port_name: String) -> Result<(), String> {
    if port_name.trim().is_empty() {
        return Err("Sarjaportin polku ei voi olla tyhjä.".into());
    }
    database.set_setting("reader.port", port_name.trim())
}

const SETTING_KEYS: &[&str] = &["reader.installation_id", "reader.device_token", "reader.device_name"];

#[tauri::command]
fn setting_value(database: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err("Tuntematon asetusavain.".into());
    }
    database.setting(&key)
}

#[tauri::command]
fn set_setting_value(database: State<'_, Database>, key: String, value: String) -> Result<(), String> {
    if !SETTING_KEYS.contains(&key.as_str()) || value.trim().is_empty() {
        return Err("Virheellinen client-asetus.".into());
    }
    database.set_setting(&key, value.trim())
}

#[tauri::command]
fn clear_setting_value(database: State<'_, Database>, key: String) -> Result<(), String> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err("Tuntematon asetusavain.".into());
    }
    database.clear_setting(&key)
}

#[tauri::command]
fn participant_by_card(database: State<'_, Database>, card_number: u32) -> Result<Option<Participant>, String> {
    database.participant_by_card(card_number)
}

#[tauri::command]
fn participant_by_card_for_event(database: State<'_, Database>, event_id: String, card_number: u32) -> Result<Option<Participant>, String> {
    database.participant_by_card_for_event(&event_id, card_number)
}

#[tauri::command]
fn sync_event_registrations(database: State<'_, Database>, event_id: String, registrations: Vec<ApiRegistration>) -> Result<usize, String> {
    database.replace_event_registrations(&event_id, &registrations)
}

#[tauri::command]
fn search_participants(database: State<'_, Database>, query: String, limit: Option<usize>) -> Result<Vec<Participant>, String> {
    database.search_participants(&query, limit.unwrap_or(10))
}

#[tauri::command]
fn register_participant(
    database: State<'_, Database>,
    card_number: u32,
    first_name: String,
    last_name: String,
    club: Option<String>,
    event_id: Option<String>,
    course_id: Option<String>,
) -> Result<Participant, String> {
    if first_name.trim().is_empty() || last_name.trim().is_empty() {
        return Err("Etunimi ja sukunimi ovat pakollisia.".into());
    }
    let participant = database.create_participant(
        card_number,
        &first_name,
        &last_name,
        club.as_deref(),
    )?;
    if let Some(event_id) = event_id {
        database.link_participant_to_event(&event_id, participant.id, course_id.as_deref())?;
    }
    Ok(participant)
}

#[tauri::command]
fn add_manual_result(
    database: State<'_, Database>,
    event_id: String,
    course_id: Option<String>,
    first_name: String,
    last_name: String,
    club: Option<String>,
    person_id: Option<String>,
    duration_seconds: Option<i64>,
) -> Result<i64, String> {
    database.add_manual_result(&event_id, course_id.as_deref(), &first_name, &last_name, club.as_deref(), person_id.as_deref(), duration_seconds)
}

#[tauri::command]
fn update_participant_details(
    database: State<'_, Database>,
    participant_id: i64,
    first_name: String,
    last_name: String,
    club: Option<String>,
) -> Result<(), String> {
    if first_name.trim().is_empty() || last_name.trim().is_empty() {
        return Err("Etunimi ja sukunimi ovat pakollisia.".into());
    }
    database.update_participant_details(participant_id, &first_name, &last_name, club.as_deref())
}

#[tauri::command]
fn confirm_latest_emit250_read(
    reader: State<'_, ReaderState>,
    database: State<'_, Database>,
    participant_id: i64,
    event_id: String,
    course_id: Option<String>,
    result_status: String,
) -> Result<i64, String> {
    let latest = reader
        .latest_read
        .lock()
        .map_err(|_| "Lukutilan lukeminen epäonnistui.".to_string())?
        .clone()
        .ok_or_else(|| "Kuitattavaa korttilukua ei löytynyt.".to_string())?;
    let read_id = database.save_read(&latest, participant_id, &event_id, course_id.as_deref(), &result_status)?;
    *reader
        .latest_read
        .lock()
        .map_err(|_| "Lukutilan päivittäminen epäonnistui.".to_string())? = None;
    Ok(read_id)
}

#[tauri::command]
fn mark_card_read_sync(database: State<'_, Database>, read_id: i64, synced: bool, error: Option<String>) -> Result<(), String> {
    database.mark_read_sync(read_id, synced, error.as_deref())
}

#[tauri::command]
fn update_card_read_status(
    database: State<'_, Database>,
    read_id: i64,
    result_status: String,
) -> Result<(), String> {
    database.update_read_status(read_id, &result_status)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database_file = app.path().app_data_dir()?.join("reader.sqlite3");
            app.manage(Database::open(database_file).map_err(std::io::Error::other)?);
            if let Some(window) = app.get_webview_window("main") {
                let monitor = window.current_monitor()?.or(window.primary_monitor()?);
                if let Some(monitor) = monitor {
                    let scale = monitor.scale_factor();
                    let work_area = monitor.work_area().size;
                    let available_width = f64::from(work_area.width) / scale;
                    let available_height = f64::from(work_area.height) / scale;
                    let height = (available_height * 0.85).clamp(600.0, 1_000.0).min(available_height);
                    let width = (height * 1.35).clamp(850.0, 1_200.0).min(available_width * 0.94);
                    window.set_size(LogicalSize::new(width, height))?;
                    window.center()?;
                }
            }
            Ok(())
        })
        .manage(ReaderState {
            listening: Arc::new(AtomicBool::new(false)),
            latest_read: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_devices,
            probe_emit250,
            start_emit250,
            stop_emit250,
            latest_emit250_read,
            recent_card_reads,
            database_path,
            reader_port_setting,
            set_reader_port_setting,
            setting_value,
            set_setting_value,
            clear_setting_value,
            participant_by_card,
            participant_by_card_for_event,
            sync_event_registrations,
            search_participants,
            register_participant,
            add_manual_result,
            confirm_latest_emit250_read,
            mark_card_read_sync,
            update_card_read_status,
            update_participant_details
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(decoded: &[u8]) -> Vec<u8> {
        decoded.iter().map(|byte| byte ^ EMIT_OD).collect()
    }

    #[test]
    fn finds_frame_after_leading_noise() {
        let mut decoded = vec![0x01, 0x02, 0x03];
        let mut frame = vec![0_u8; EMIT_250_FRAME_LENGTH];
        frame[0] = 0xff;
        frame[1] = 0xff;
        frame[2] = 0x56;
        frame[3] = 0x34;
        frame[4] = 0x12;
        frame[10] = 31;
        frame[11] = 0x2c;
        frame[12] = 0x01;
        frame[216] = (0_u16.wrapping_sub(
            frame[..216]
                .iter()
                .map(|byte| u16::from(*byte))
                .sum::<u16>(),
        ) & 0xff) as u8;
        decoded.extend_from_slice(&frame);

        let found = find_emit250_frame(&encode(&decoded)).expect("frame should be found");

        assert_eq!(found.len(), EMIT_250_FRAME_LENGTH);
        assert_eq!(
            u32::from(found[2]) | (u32::from(found[3]) << 8) | (u32::from(found[4]) << 16),
            0x123456
        );
        assert_eq!(parse_punches(&found)[0].time_seconds, 300);
    }

    #[test]
    fn rejects_incomplete_frame() {
        let mut frame = vec![0_u8; EMIT_250_FRAME_LENGTH - 1];
        frame[0] = 0xff;
        frame[1] = 0xff;
        assert!(find_emit250_frame(&encode(&frame)).is_none());
    }

    #[test]
    fn rejects_data_without_header() {
        assert!(find_emit250_frame(&encode(&vec![0_u8; EMIT_250_FRAME_LENGTH])).is_none());
    }
}
