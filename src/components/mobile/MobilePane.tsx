import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { Pane as PaneType } from "../../lib/types";
import { DeviceChooser } from "./DeviceChooser";
import { DeviceCanvas } from "./DeviceCanvas";
import { LogStrip } from "./LogStrip";

// Top-level mobile pane.
//
// Once a device is picked, we *always* render a PanelGroup with the canvas
// at children[0]. The LogStrip Panel is added/removed conditionally, but the
// canvas's React position never moves — so toggling logs (or waiting for
// `connectionId` to settle on the payload) doesn't unmount the canvas and
// kill the streaming session. Earlier the canvas swapped between
// `<DeviceCanvas/>` and `<PanelGroup>...<DeviceCanvas/>...</PanelGroup>`,
// which forced a remount and reconnect on every logs-toggle.

export function MobilePane({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const target = pane.payload?.target as string | undefined;
  const deviceId = pane.payload?.deviceId as string | undefined;
  const source = pane.payload?.source as string | undefined;
  const connectionId = pane.payload?.connectionId as string | undefined;
  const showLogs = pane.payload?.showLogs !== false; // default true
  const logsVisible = !!connectionId && showLogs;

  if (!target || !deviceId || !source) {
    return <DeviceChooser pane={pane} tabId={tabId} />;
  }

  return (
    <PanelGroup direction="vertical" autoSaveId={`mobile-${pane.id}`}>
      <Panel id="mobile-canvas" order={1} defaultSize={logsVisible ? 70 : 100} minSize={20}>
        <DeviceCanvas pane={pane} tabId={tabId} />
      </Panel>
      {logsVisible && (
        <>
          <PanelResizeHandle className="resize-handle" />
          <Panel id="mobile-logs" order={2} defaultSize={30} minSize={10}>
            <LogStrip connectionId={connectionId!} />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
