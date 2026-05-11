import { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeGraph } from "../../lib/knowledge";

type SimNode = {
  slug: string;
  title: string;
  backlinkCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  r: number;
};

type SimEdge = { source: number; target: number };

type Props = {
  graph: KnowledgeGraph | null;
  activeSlug: string | null;
  onOpen: (slug: string) => void;
};

const SPRING_LEN = 90;
const SPRING_K = 0.04;
const REPULSION = 1200;
const DAMPING = 0.78;
const CENTER_K = 0.012;
const STOP_KE = 0.02;

export function GraphView({ graph, activeSlug, onOpen }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ tx: 0, ty: 0, s: 1 });
  const [, forceRender] = useState(0);

  // Track container size so simulation centers correctly.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = containerRef.current!.getBoundingClientRect();
      setSize({ w: Math.max(100, r.width), h: Math.max(100, r.height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Build sim state from graph data. Recreated when the node set or edge set
  // structurally changes (slug list or edge count) — not on every render.
  const simRef = useRef<{ nodes: SimNode[]; edges: SimEdge[] } | null>(null);
  const graphKey = useMemo(() => {
    if (!graph) return "";
    return (
      graph.nodes.map((n) => n.slug).join(",") +
      "|" +
      graph.edges.map((e) => `${e.source}->${e.target}`).join(",")
    );
  }, [graph]);

  useEffect(() => {
    if (!graph) {
      simRef.current = null;
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const slugToIdx = new Map<string, number>();
    graph.nodes.forEach((n, i) => slugToIdx.set(n.slug, i));
    const cx = size.w / 2;
    const cy = size.h / 2;
    const nodes: SimNode[] = graph.nodes.map((n, i) => {
      // Seed positions on a circle around center for a stable settle.
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const radius = 40 + Math.min(180, graph.nodes.length * 6);
      return {
        slug: n.slug,
        title: n.title,
        backlinkCount: n.backlinkCount,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        pinned: false,
        r: 4 + Math.min(10, Math.sqrt(n.backlinkCount) * 2),
      };
    });
    const edges: SimEdge[] = [];
    for (const e of graph.edges) {
      const s = slugToIdx.get(e.source);
      const t = slugToIdx.get(e.target);
      if (s !== undefined && t !== undefined && s !== t) edges.push({ source: s, target: t });
    }
    simRef.current = { nodes, edges };

    // Pre-settle (or snap-settle for reduced motion).
    const steps = reduce ? 240 : 60;
    for (let i = 0; i < steps; i++) step(nodes, edges, cx, cy);
    forceRender((n) => n + 1);

    if (reduce) return;
    let running = true;
    let raf = 0;
    const tick = () => {
      if (!running || !simRef.current) return;
      step(simRef.current.nodes, simRef.current.edges, cx, cy);
      const ke = kineticEnergy(simRef.current.nodes);
      forceRender((n) => n + 1);
      if (ke > STOP_KE) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, size.w, size.h]);

  // ----- Pan / zoom -----
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const s = clamp(v.s * factor, 0.3, 4);
        // Zoom centered on cursor.
        const ratio = s / v.s;
        return {
          s,
          tx: px - (px - v.tx) * ratio,
          ty: py - (py - v.ty) * ratio,
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function onSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.target !== svgRef.current) return; // only empty-space drag
    (e.target as Element).setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    let lastY = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    };
    const up = () => {
      svgRef.current?.removeEventListener("pointermove", move);
      svgRef.current?.removeEventListener("pointerup", up);
    };
    svgRef.current?.addEventListener("pointermove", move);
    svgRef.current?.addEventListener("pointerup", up, { once: true });
  }

  function onNodePointerDown(e: React.PointerEvent<SVGGElement>, idx: number) {
    e.stopPropagation();
    const sim = simRef.current;
    if (!sim) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const node = sim.nodes[idx];
    node.pinned = true;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const originX = node.x;
    const originY = node.y;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / view.s;
      const dy = (ev.clientY - startY) / view.s;
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) {
        moved = true;
      }
      node.x = originX + dx;
      node.y = originY + dy;
      // Wake the sim — kick neighbors to recompute layout.
      node.vx = 0;
      node.vy = 0;
      forceRender((n) => n + 1);
    };
    const up = () => {
      svgRef.current?.removeEventListener("pointermove", move);
      svgRef.current?.removeEventListener("pointerup", up);
      if (!moved) {
        onOpen(node.slug);
      } else {
        // After drag, run a few more steps to ease neighbors.
        const cx = size.w / 2;
        const cy = size.h / 2;
        for (let i = 0; i < 30; i++) step(sim.nodes, sim.edges, cx, cy);
        forceRender((n) => n + 1);
      }
    };
    svgRef.current?.addEventListener("pointermove", move);
    svgRef.current?.addEventListener("pointerup", up, { once: true });
  }

  function onNodeDoubleClick(idx: number) {
    const sim = simRef.current;
    if (!sim) return;
    sim.nodes[idx].pinned = false;
    forceRender((n) => n + 1);
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div ref={containerRef} className="kn-graph">
        <div className="kn-graph-empty">
          <strong style={{ color: "var(--fg)" }}>No connections yet</strong>
          <div>
            Add <code>[[wikilinks]]</code> to your notes to see them form here.
          </div>
        </div>
      </div>
    );
  }

  const sim = simRef.current;

  return (
    <div ref={containerRef} className="kn-graph">
      <svg
        ref={svgRef}
        className="kn-graph-svg"
        width={size.w}
        height={size.h}
        onPointerDown={onSvgPointerDown}
        role="img"
        aria-label={`Knowledge graph with ${graph.nodes.length} notes and ${graph.edges.length} links. Switch to the list view for keyboard navigation.`}
      >
        <defs>
          <marker
            id="kn-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-strong)" />
          </marker>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
          {sim &&
            sim.edges.map((e, i) => {
              const a = sim.nodes[e.source];
              const b = sim.nodes[e.target];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / d;
              const uy = dy / d;
              // Trim the line to the edge of each node.
              const x1 = a.x + ux * a.r;
              const y1 = a.y + uy * a.r;
              const x2 = b.x - ux * (b.r + 4);
              const y2 = b.y - uy * (b.r + 4);
              return (
                <line
                  key={i}
                  className="kn-graph-edge"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  markerEnd="url(#kn-arrow)"
                />
              );
            })}
          {sim &&
            sim.nodes.map((n, i) => (
              <g
                key={n.slug}
                onPointerDown={(e) => onNodePointerDown(e, i)}
                onDoubleClick={() => onNodeDoubleClick(i)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  className={"kn-graph-node" + (n.slug === activeSlug ? " active" : "")}
                />
                {(n.slug === activeSlug || n.r >= 8) && (
                  <text
                    className="kn-graph-node-label"
                    x={n.x + n.r + 4}
                    y={n.y + 4}
                  >
                    {n.title}
                  </text>
                )}
              </g>
            ))}
        </g>
      </svg>
    </div>
  );
}

// ----- Force simulation step -----

function step(nodes: SimNode[], edges: SimEdge[], cx: number, cy: number): void {
  const fx = new Array(nodes.length).fill(0);
  const fy = new Array(nodes.length).fill(0);

  // Repulsion (Coulomb-ish, O(n²) — fine for v1 < ~500 nodes)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        // Jitter coincident nodes.
        dx = (Math.random() - 0.5) * 0.5;
        dy = (Math.random() - 0.5) * 0.5;
        d2 = dx * dx + dy * dy + 0.01;
      }
      const d = Math.sqrt(d2);
      const f = REPULSION / d2;
      const fxi = (dx / d) * f;
      const fyi = (dy / d) * f;
      fx[i] += fxi;
      fy[i] += fyi;
      fx[j] -= fxi;
      fy[j] -= fyi;
    }
  }

  // Springs
  for (const e of edges) {
    const a = nodes[e.source];
    const b = nodes[e.target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
    const f = (d - SPRING_LEN) * SPRING_K;
    const fxi = (dx / d) * f;
    const fyi = (dy / d) * f;
    fx[e.source] += fxi;
    fy[e.source] += fyi;
    fx[e.target] -= fxi;
    fy[e.target] -= fyi;
  }

  // Centering
  for (let i = 0; i < nodes.length; i++) {
    fx[i] += (cx - nodes[i].x) * CENTER_K;
    fy[i] += (cy - nodes[i].y) * CENTER_K;
  }

  // Integrate
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.pinned) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = (n.vx + fx[i]) * DAMPING;
    n.vy = (n.vy + fy[i]) * DAMPING;
    // Clamp velocity so a poorly-conditioned step can't fling nodes off-canvas.
    const vmag = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
    const vcap = 12;
    if (vmag > vcap) {
      n.vx = (n.vx / vmag) * vcap;
      n.vy = (n.vy / vmag) * vcap;
    }
    n.x += n.vx;
    n.y += n.vy;
  }
}

function kineticEnergy(nodes: SimNode[]): number {
  let ke = 0;
  for (const n of nodes) ke += n.vx * n.vx + n.vy * n.vy;
  return ke / Math.max(1, nodes.length);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
