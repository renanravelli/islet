// Prevents an extra console window on Windows release builds; a no-op elsewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    islet_desktop::run();
}
