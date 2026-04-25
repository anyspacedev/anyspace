import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { LayoutNode, Tab } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Pane } from "./Pane";

export function PaneGrid({ tab }: { tab: Tab }) {
  const setLayoutSizes = useWorkspaceStore((s) => s.setLayoutSizes);

  return (
    <RenderNode
      node={tab.layout}
      tab={tab}
      path={[]}
      onResize={(path, sizes) => setLayoutSizes(tab.id, path, sizes)}
    />
  );
}

function RenderNode({
  node,
  tab,
  path,
  onResize,
}: {
  node: LayoutNode;
  tab: Tab;
  path: number[];
  onResize: (path: number[], sizes: number[]) => void;
}) {
  if (node.type === "leaf") {
    const pane = tab.panes[node.paneId];
    if (!pane) return null;
    return <Pane pane={pane} tabId={tab.id} />;
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
  onResize,
}: {
  child: LayoutNode;
  tab: Tab;
  parentPath: number[];
  index: number;
  defaultSize: number;
  isLast: boolean;
  onResize: (path: number[], sizes: number[]) => void;
}) {
  return (
    <>
      <Panel defaultSize={defaultSize} minSize={5}>
        <RenderNode
          node={child}
          tab={tab}
          path={[...parentPath, index]}
          onResize={onResize}
        />
      </Panel>
      {!isLast && <PanelResizeHandle className="resize-handle" />}
    </>
  );
}
