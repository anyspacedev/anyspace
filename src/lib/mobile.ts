import { invoke as rawInvoke, Channel } from "@tauri-apps/api/core";

// Typed wrappers for the mobile (Android / iOS) pane Rust commands.
//
// Stage 1 ships skeleton commands only — `mobile_connect` and friends return
// "not implemented" until the scrcpy launcher (Android) and ScreenCaptureKit
// helper (iOS) land. The shape is locked here so the React side can be wired
// up against a stable contract while the Rust layer fills in.

export type MobileTarget = "android" | "ios";

export type MobileDeviceSource = "emulator" | "usb";

export type MobileDevice = {
  /** ADB serial (Android) or simulator UDID / iOS device UDID (iOS). */
  id: string;
  target: MobileTarget;
  source: MobileDeviceSource;
  /** Human-readable label shown in the chooser. */
  name: string;
  /** Booted state — only ready devices can be connected to. */
  ready: boolean;
};

export async function mobileListDevices(): Promise<MobileDevice[]> {
  return rawInvoke<MobileDevice[]>("mobile_list_devices");
}

export type MobileConnectArgs = {
  paneId: string;
  target: MobileTarget;
  deviceId: string;
  source: MobileDeviceSource;
  /** Required for iOS — the iossimstream helper uses it to find the
   *  Simulator window by title. Optional for Android. */
  deviceName?: string;
  bitrate?: number;
  maxSize?: number;
};

export type MobileConnection = {
  connectionId: string;
  width: number;
  height: number;
  /** "annexb" today; opaque to the frontend besides config-supported probing. */
  codec: string;
};

export async function mobileConnect(
  args: MobileConnectArgs,
  onVideo: Channel<Uint8Array>,
): Promise<MobileConnection> {
  return rawInvoke<MobileConnection>("mobile_connect", { args, onVideo });
}

export async function mobileDisconnect(connectionId: string): Promise<void> {
  return rawInvoke("mobile_disconnect", { connectionId });
}

// Touch / scroll / nav-button inputs — the discriminator is `kind`; the rest
// of the fields depend on the variant. The Rust side encodes these onto the
// scrcpy control socket (Android). x/y are in canvas-pixel space; the same
// space `screenWidth`/`screenHeight` describe — scrcpy scales to the device's
// real screen size on the device side.
export type MobileInputEvent =
  | {
      kind: "touch";
      action: "down" | "up" | "move";
      x: number;
      y: number;
      pointerId: number;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      kind: "scroll";
      x: number;
      y: number;
      screenWidth: number;
      screenHeight: number;
      // hscroll / vscroll, both clamped to [-1, 1] (full tick = ±1).
      dx: number;
      dy: number;
    }
  | { kind: "back" }
  | { kind: "home" }
  | { kind: "appSwitch" };

export async function mobileInput(
  connectionId: string,
  event: MobileInputEvent,
): Promise<void> {
  return rawInvoke("mobile_input", { connectionId, event });
}

export type MobileLogLine = {
  /** Raw "MM-DD HH:MM:SS.mmm" string from `logcat -v threadtime`. */
  ts: string;
  pid: number;
  tid: number;
  level: "V" | "D" | "I" | "W" | "E" | "F";
  tag: string;
  message: string;
};

export async function mobileLogsStart(
  connectionId: string,
  onLine: Channel<MobileLogLine>,
): Promise<void> {
  return rawInvoke("mobile_logs_start", { connectionId, onLine });
}

export async function mobileLogsStop(connectionId: string): Promise<void> {
  return rawInvoke("mobile_logs_stop", { connectionId });
}
