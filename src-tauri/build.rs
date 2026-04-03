fn main() {
    // Ensure the sidecar exe placeholder exists for dev builds.
    // tauri_build::build() validates resource paths at compile time,
    // so cargo check / cargo build would fail without the exe.
    // In production, PyInstaller creates the real exe before `tauri build`.
    let sidecar_exe = std::path::Path::new("../python-sidecar/dist/eduplan-sidecar.exe");
    if !sidecar_exe.exists() {
        if let Some(parent) = sidecar_exe.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // Minimal valid PE header is unnecessary; an empty file suffices for resource validation.
        let _ = std::fs::write(sidecar_exe, b"placeholder");
        println!("cargo:warning=Created placeholder sidecar exe for dev build");
    }

    tauri_build::build()
}
