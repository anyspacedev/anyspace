import { useEffect, useState } from "react";
import type { Pane as PaneType } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { mobileListDevices, type MobileDevice, type MobileTarget } from "../../lib/mobile";
import { Icon } from "../ui/Icon";
import { isMacPlatform } from "../../lib/platform";

const IOS_HOST_SUPPORTED = isMacPlatform();

// Device chooser. Lists Android (scrcpy / adb) and iOS (Simulator / idb)
// devices grouped by target. Polling is fine here — `mobile_list_devices`
// is cheap (it shells out to `adb devices` / `xcrun simctl list`).
//
// Stage 1: lists devices and stores the chosen `target` + `deviceId` on the
// pane payload, but does NOT call `mobile_connect` yet — the streaming
// pipeline lands in a follow-up commit.

const POLL_MS = 2000;

export function DeviceChooser({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const [target, setTarget] = useState<MobileTarget>(() => {
    const raw = pane.payload?.target as MobileTarget | undefined;
    // Coerce a stale "ios" payload on non-macOS hosts (e.g. moved a workspace
    // from a Mac to a Windows machine) so we don't render an iOS tab that
    // can't be selected once we hide it below.
    if (raw === "ios" && !IOS_HOST_SUPPORTED) return "android";
    return raw ?? "android";
  });
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const list = await mobileListDevices();
        if (cancelled) return;
        setDevices(list);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  const filtered = (devices ?? []).filter((d) => d.target === target);

  const onPick = (device: MobileDevice) => {
    setPanePayload(tabId, pane.id, {
      target: device.target,
      deviceId: device.id,
      source: device.source,
      title: device.name,
    });
  };

  return (
    <div className="mobile-chooser">
      <div className="mobile-chooser-header">
        <div className="mobile-chooser-title">
          <Icon name="smartphone" size={18} />
          <span>Mobile device</span>
        </div>
        <div className="mobile-chooser-tabs">
          <button
            className={"chooser-tab" + (target === "android" ? " active" : "")}
            onClick={() => setTarget("android")}
          >
            Android
          </button>
          {IOS_HOST_SUPPORTED && (
            <button
              className={"chooser-tab" + (target === "ios" ? " active" : "")}
              onClick={() => setTarget("ios")}
            >
              iOS
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="mobile-chooser-empty">
          <Icon name="alert-circle" size={20} />
          <div>
            <div className="mobile-chooser-empty-title">Couldn't list devices</div>
            <div className="mobile-chooser-empty-hint">{error}</div>
          </div>
        </div>
      ) : devices == null ? (
        <div className="mobile-chooser-empty">Scanning for devices…</div>
      ) : filtered.length === 0 ? (
        <div className="mobile-chooser-empty">
          <Icon name="alert-circle" size={20} />
          <div>
            <div className="mobile-chooser-empty-title">
              No {target === "android" ? "Android" : "iOS"} devices
            </div>
            <div className="mobile-chooser-empty-hint">
              {target === "android"
                ? "Boot an AVD (`emulator -avd …`) or plug in a USB device with USB debugging enabled."
                : "Boot a simulator (`xcrun simctl boot …`) or connect a developer-mode iPhone."}
            </div>
          </div>
        </div>
      ) : (
        <ul className="mobile-chooser-list">
          {filtered.map((d) => (
            <li key={d.id}>
              <button
                className="mobile-chooser-row"
                disabled={!d.ready}
                onClick={() => onPick(d)}
              >
                <Icon name="smartphone" size={16} />
                <span className="mobile-chooser-name">{d.name}</span>
                <span className="mobile-chooser-source">{d.source}</span>
                <span className="mobile-chooser-ready">
                  {d.ready ? "ready" : "not ready"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
