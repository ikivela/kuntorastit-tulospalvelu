use serde::Serialize;
use serialport::{DataBits, Parity, SerialPort, SerialPortType, StopBits};
use std::io::Read;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ReaderState {
            listening: Arc::new(AtomicBool::new(false)),
            latest_read: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_devices,
            probe_emit250,
            start_emit250,
            stop_emit250,
            latest_emit250_read
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
