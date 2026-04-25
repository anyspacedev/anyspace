import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { LayoutNode, Tab } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Pane } from "./Pane";

export function PaneGrid({ tab }: { tab: Tab }) {
  const setLayoutSizes = useWorkspaceStore((s) => s.setLayoutSizes);

  // Each pane has an owned host <div> that lives outside the layout tree.
  // Pane content is portaled into that host (target stays stable for the
  // pane's lifetime, so the Pane component never unmounts), and the layout
  // tree's PaneSlot adopts the host into its DOM via appendChild. This keeps
  // xterm/PTY state alive across split/close restructures.
  const hostsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const getHost = useCallback((paneId: string) => {
    let h = hostsRef.current.get(paneId);
    if (!h) {
      h = document.createElement("div");
      h.className = "pane-host";
      hostsRef.current.set(paneId, h);
    }
    return h;
  }, []);

  useEffect(() => {
    const live = new Set(Object.keys(tab.panes));
    for (const id of Array.from(hostsRef.current.keys())) {
      if (!live.has(id)) {
        const host = hostsRef.current.get(id);
        host?.remove();
        hostsRef.current.delete(id);
      }
    }
  }, [tab.panes]);

  return (
    <>
      <RenderNode
        node={tab.layout}
        tab={tab}
        path={[]}
        getHost={getHost}
        onResize={(path, sizes) => setLayoutSizes(tab.id, path, sizes)}
      />
      {Object.values(tab.panes).map((pane) =>
        createPortal(
          <Pane pane={pane} tabId={tab.id} />,
          getHost(pane.id),
          pane.id,
        ),
      )}
    </>
  );
}

function RenderNode({
  node,
  tab,
  path,
  getHost,
  onResize,
}: {
  node: LayoutNode;
  tab: Tab;
  path: number[];
  getHost: (paneId: string) => HTMLDivElement;
  onResize: (path: number[], sizes: number[]) => void;
}) {
  if (node.type === "leaf") {
    if (!tab.panes[node.paneId]) return null;
    return <PaneSlot paneId={node.paneId} getHost={getHost} />;
  }
  return (
    <PanelGroup
      direction={node.direction}
      onLayout={(sizes: number[]) => onResize(path, sizes)}
    >
      {node.children.map((child, i) => (
        <PanelFragment
          key={i}
          child={child}
          tab={tab}
          parentPath={path}
          index={i}
          defaultSize={node.sizes[i]}
          isLast={i === node.children.length - 1}
          getHost={getHost}
          onResize={onResize}
        />
      ))}
    </PanelGroup>
  );
}

function PanelFragment({
  child,
  tab,
  parentPath,
  index,
  defaultSize,
  isLast,
  getHost,
  onResize,
}: {
  child: LayoutNode;
  tab: Tab;
  parentPath: number[];
  index: number;
  defaultSize: number;
  isLast: boolean;
  getHost: (paneId: string) => HTMLDivElement;
  onResize: (path: number[], sizes: number[]) => void;
}) {
  return (
    <>
      <Panel defaultSize={defaultSize} minSize={5}>
        <RenderNode
          node={child}
          tab={tab}
          path={[...parentPath, index]}
          getHost={getHost}
          onResize={onResize}
        />
      </Panel>
      {!isLast && <PanelResizeHandle className="resize-handle" />}
    </>
  );
}

function PaneSlot({
  paneId,
  getHost,
}: {
  paneId: string;
  getHost: (paneId: string) => HTMLDivElement;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const host = getHost(paneId);
    slot.appendChild(host);
    return () => {
      if (host.parentElement === slot) slot.removeChild(host);
    };
  }, [paneId, getHost]);
  return <div ref={slotRef} className="pane-slot" />;
}
