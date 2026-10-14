// Release builds are a GUI app on Windows: no console window next to it.
// Debug builds (`tauri dev`) keep the console for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pc_client_lib::run();
}
