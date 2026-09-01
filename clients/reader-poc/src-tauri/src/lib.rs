use serde::Serialize;
use serialport::{DataBits, Parity, SerialPortType, StopBits};
use std::io::Read;
use std::time::{Duration, Instant};

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Emit250Read {
    port_name: String,
    bytes_received: usize,
    frame_found: bool,
    card_number: Option<u32>,
    raw_hex: String,
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
fn probe_emit250(port_name: String, seconds: Option<u64>) -> Result<Emit250Read, String> {
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

    Ok(Emit250Read {
        port_name,
        bytes_received: raw.len(),
        frame_found: decoded_frame.is_some(),
        card_number,
        raw_hex: raw.iter().take(512).map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" "),
    })
}

fn find_emit250_frame(raw: &[u8]) -> Option<Vec<u8>> {
    let decoded: Vec<u8> = raw.iter().map(|byte| byte ^ EMIT_OD).collect();

    decoded
        .windows(EMIT_250_FRAME_LENGTH)
        .find(|window| window[0] == 0xff && window[1] == 0xff)
        .map(|window| window.to_vec())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_serial_devices, probe_emit250])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
