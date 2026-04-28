// iOS Simulator discovery via `xcrun simctl list devices --json`.
//
// Gated to macOS — Apple licensing forbids running iOS Simulator anywhere
// else, so the non-Mac stub returns an empty list (the chooser shows the
// "iOS preview requires macOS" empty state on those hosts via a separate
// frontend platform check).

#[cfg(target_os = "macos")]
mod imp {
    use crate::mobile::commands::MobileDevice;
    use serde::Deserialize;
    use std::collections::HashMap;
    use std::time::Duration;
    use tokio::process::Command;
    use tokio::time::timeout;

    const SIMCTL_TIMEOUT: Duration = Duration::from_secs(5);

    #[derive(Deserialize)]
    struct Listing {
        devices: HashMap<String, Vec<Device>>,
    }

    #[derive(Deserialize)]
    struct Device {
        udid: String,
        name: String,
        state: String,
        #[serde(default, rename = "isAvailable")]
        is_available: bool,
    }

    pub async fn list_devices() -> Vec<MobileDevice> {
        let exec = async {
            let out = Command::new("xcrun")
                .args(["simctl", "list", "devices", "--json"])
                .output()
                .await
                .ok()?;
            if !out.status.success() {
                return None;
            }
            serde_json::from_slice::<Listing>(&out.stdout).ok()
        };

        let listing = match timeout(SIMCTL_TIMEOUT, exec).await {
            Ok(Some(l)) => l,
            _ => return Vec::new(),
        };

        let mut out = Vec::new();
        for (runtime, devices) in listing.devices {
            // simctl returns watchOS/tvOS/visionOS runtimes too — filter to iOS.
            if !runtime.contains("iOS") {
                continue;
            }
            for d in devices {
                if !d.is_available {
                    continue;
                }
                out.push(MobileDevice {
                    id: d.udid,
                    target: "ios".into(),
                    source: "emulator".into(),
                    name: d.name,
                    ready: d.state == "Booted",
                });
            }
        }
        out
    }
}

#[cfg(target_os = "macos")]
pub use imp::list_devices;

#[cfg(not(target_os = "macos"))]
pub async fn list_devices() -> Vec<crate::mobile::commands::MobileDevice> {
    Vec::new()
}
