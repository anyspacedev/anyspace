use super::commands::MobileDevice;
use anyhow::{anyhow, Context};
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const ADB_TIMEOUT: Duration = Duration::from_secs(3);

fn adb_filename() -> &'static str {
    if cfg!(windows) {
        "adb.exe"
    } else {
        "adb"
    }
}

// Resolve the adb binary. Order: $PATH, then $ANDROID_HOME / $ANDROID_SDK_ROOT
// platform-tools. A user-overridable settings key can come later if this proves
// fragile across Android Studio installations.
pub fn locate_adb() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(adb_filename());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(home) = std::env::var(var) {
            let candidate = PathBuf::from(home)
                .join("platform-tools")
                .join(adb_filename());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// Returns connected Android devices via `adb devices -l`. Non-fatal: if adb is
// not installed, hangs, or returns an error, we yield an empty list so the
// chooser can render its "no devices" empty state instead of a hard error.
pub async fn list_devices() -> Vec<MobileDevice> {
    let Some(adb) = locate_adb() else {
        return Vec::new();
    };

    let exec = async {
        let out = Command::new(&adb)
            .arg("devices")
            .arg("-l")
            .output()
            .await
            .context("spawn adb")?;
        if !out.status.success() {
            return Err(anyhow!("adb devices exited with {}", out.status));
        }
        Ok::<_, anyhow::Error>(String::from_utf8_lossy(&out.stdout).into_owned())
    };

    let stdout = match timeout(ADB_TIMEOUT, exec).await {
        Ok(Ok(s)) => s,
        _ => return Vec::new(),
    };

    parse_adb_devices(&stdout)
}

fn parse_adb_devices(stdout: &str) -> Vec<MobileDevice> {
    let mut out = Vec::new();
    // First line is the "List of devices attached" header — skip it.
    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let serial = match parts.next() {
            Some(s) => s,
            None => continue,
        };
        let state = parts.next().unwrap_or("");
        // Remaining tokens are key:value pairs (model:..., device:..., transport_id:...).
        let mut model: Option<String> = None;
        for kv in parts {
            if let Some(rest) = kv.strip_prefix("model:") {
                // ADB encodes spaces as underscores.
                model = Some(rest.replace('_', " "));
            }
        }
        let source = if serial.starts_with("emulator-") {
            "emulator"
        } else {
            "usb"
        };
        // `device` is the only state where adb commands actually work; `offline`
        // and `unauthorized` show in chooser as "not ready" so the user knows
        // they need to accept the on-device USB-debug prompt.
        let ready = state == "device";
        let name = model.unwrap_or_else(|| serial.to_string());
        out.push(MobileDevice {
            id: serial.to_string(),
            target: "android".into(),
            source: source.into(),
            name,
            ready,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_emulator_usb_and_unauthorized() {
        let stdout = "List of devices attached\n\
            emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n\
            R5CR70XYZ              device product:r9q model:SM_G991U device:r9q transport_id:2\n\
            5C12345678             unauthorized usb:1-2 transport_id:3\n";
        let devs = parse_adb_devices(stdout);
        assert_eq!(devs.len(), 3);

        assert_eq!(devs[0].id, "emulator-5554");
        assert_eq!(devs[0].source, "emulator");
        assert_eq!(devs[0].target, "android");
        assert!(devs[0].ready);

        assert_eq!(devs[1].id, "R5CR70XYZ");
        assert_eq!(devs[1].source, "usb");
        assert_eq!(devs[1].name, "SM G991U");
        assert!(devs[1].ready);

        assert_eq!(devs[2].id, "5C12345678");
        assert!(!devs[2].ready);
    }

    #[test]
    fn empty_listing_returns_empty() {
        let stdout = "List of devices attached\n\n";
        assert!(parse_adb_devices(stdout).is_empty());
    }

    #[test]
    fn falls_back_to_serial_when_no_model() {
        let stdout = "List of devices attached\n\
            ABC123             device transport_id:1\n";
        let devs = parse_adb_devices(stdout);
        assert_eq!(devs.len(), 1);
        assert_eq!(devs[0].name, "ABC123");
    }
}
