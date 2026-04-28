fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    build_iossimstream();
}

// Compile the iOS Simulator capture helper (macOS-only). The compiled binary
// is referenced at runtime via the IOSSIMSTREAM_PATH compile-time env var.
//
// On macOS we treat swiftc failure as a hard build error so the user sees
// the actual Swift errors instead of getting a confusing runtime "Install
// Xcode Command Line Tools" message later.
#[cfg(target_os = "macos")]
fn build_iossimstream() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let src = std::path::PathBuf::from(&manifest_dir)
        .join("macos-helpers/iOSSimStream/main.swift");
    println!("cargo:rerun-if-changed={}", src.display());
    println!("cargo:rerun-if-changed=build.rs");

    if !src.exists() {
        panic!(
            "iossimstream source missing at {} — the iOS Simulator pane needs this Swift \
             helper. Either restore the file or remove the iOS pane code path.",
            src.display()
        );
    }

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let out_bin = std::path::PathBuf::from(&out_dir).join("iossimstream");

    let mut cmd = std::process::Command::new("swiftc");
    cmd.arg(src.as_os_str())
        .args([
            "-O",
            "-parse-as-library", // allows @main on the App struct
            "-o",
        ])
        .arg(out_bin.as_os_str())
        .args([
            "-framework", "ScreenCaptureKit",
            "-framework", "VideoToolbox",
            "-framework", "CoreMedia",
            "-framework", "CoreVideo",
            "-framework", "AppKit",
        ]);

    // Capture stderr so we can include it in the panic message; without this,
    // swiftc's diagnostics get lost in the cargo output stream.
    let output = match cmd.output() {
        Ok(o) => o,
        Err(err) => panic!(
            "swiftc not found on PATH: {err}\n\
             Install Xcode Command Line Tools (`xcode-select --install`) and retry."
        ),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        panic!(
            "swiftc failed (exit {}) compiling iossimstream:\n\
             ---- swiftc stderr ----\n{stderr}\n\
             ---- swiftc stdout ----\n{stdout}",
            output.status
        );
    }

    if !out_bin.exists() {
        panic!(
            "swiftc reported success but the binary doesn't exist at {}",
            out_bin.display()
        );
    }

    // Surface a yellow cargo:warning so the user can confirm in build output
    // that the helper actually compiled this run.
    println!(
        "cargo:warning=iossimstream compiled: {}",
        out_bin.display()
    );
    println!("cargo:rustc-env=IOSSIMSTREAM_PATH={}", out_bin.display());
}
