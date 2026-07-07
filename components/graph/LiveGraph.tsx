"use client";

/**
 * LiveGraph -- the force-directed landscape canvas.
 *
 * react-force-graph-2d touches window at import time, so the module is
 * loaded client-side inside an effect (never statically, never through a
 * server component). The effect-based import also gives us a working ref
 * to the graph methods, which next/dynamic would swallow.
 *
 * Interaction model:
 *  - hover: node grows, name label appears, 1-hop neighborhood emphasized,
 *    everything else fades to 25% opacity
 *  - click: select (opens the detail panel); double-click: expand
 *  - drag: repositions and pins the node
 *  - insight highlight: named nodes/links stay full strength, links turn
 *    rose and carry more directional particles; the rest fades
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-2d";
import type { GraphLink, GraphNode, NodeLabel } from "@/lib/types";
import type {
  GraphData,
  GraphStreamStatus,
  Highlight,
} from "@/hooks/useGraphStream";
import {
  COMMUNITY_TINTS,
  endpointId,
  linkKeyOf,
  NODE_COLORS,
} from "./graph-utils";

type FGNode = NodeObject<GraphNode>;
type FGLink = LinkObject<GraphNode, GraphLink>;
type FGMethods = ForceGraphMethods<FGNode, FGLink>;
type FGComponent = typeof import("react-force-graph-2d").default;

const LABEL_FONT = "Geist, ui-sans-serif, system-ui, sans-serif";

interface LiveGraphProps {
  data: GraphData;
  status: GraphStreamStatus;
  highlight: Highlight | null;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
  onExpand: (node: GraphNode) => void;
}

export default function LiveGraph({
  data,
  status,
  highlight,
  selectedId,
  onSelect,
  onExpand,
}: LiveGraphProps) {
  const [ForceGraph, setForceGraph] = useState<FGComponent | null>(null);
  const fgRef = useRef<FGMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastClickRef = useRef<{ id: string; time: number }>({ id: "", time: 0 });
  const prevNodeCountRef = useRef(0);

  /* Client-only module load (the lib crashes if imported during SSR). */
  useEffect(() => {
    let mounted = true;
    import("react-force-graph-2d").then((mod) => {
      if (mounted) setForceGraph(() => mod.default);
    });
    return () => {
      mounted = false;
    };
  }, []);

  /* Fluid sizing via ResizeObserver. */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  /* Derived indexes -- cheap at hackathon graph sizes. */
  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of data.links) {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      map.set(s, (map.get(s) ?? 0) + 1);
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return map;
  }, [data]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const connect = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      map.get(a)?.add(b);
    };
    for (const link of data.links) {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      connect(s, t);
      connect(t, s);
    }
    return map;
  }, [data]);

  const topPagerankId = useMemo(() => {
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const node of data.nodes) {
      if (typeof node.pagerank === "number" && node.pagerank > bestScore) {
        bestScore = node.pagerank;
        best = node.id;
      }
    }
    return best;
  }, [data]);

  const highlightNodes = useMemo(
    () => (highlight ? new Set(highlight.nodeIds) : null),
    [highlight],
  );
  const highlightLinks = useMemo(
    () => (highlight ? new Set(highlight.linkKeys) : null),
    [highlight],
  );
  const hoverHood = useMemo(() => {
    if (!hoverId) return null;
    return new Set([hoverId, ...(adjacency.get(hoverId) ?? [])]);
  }, [hoverId, adjacency]);

  const radiusFor = useCallback(
    (id: string) => Math.min(3 + Math.sqrt(degree.get(id) ?? 0) * 1.35, 11),
    [degree],
  );

  /* ---------------------------------------------------------------- */
  /* Canvas painting                                                   */
  /* ---------------------------------------------------------------- */

  const paintNode = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const id = String(node.id ?? "");
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      let radius = radiusFor(id);
      const hovered = hoverId === id;
      if (hovered) radius *= 1.3;

      const inHighlight = highlightNodes?.has(id) ?? false;
      const dimmed = highlightNodes
        ? !inHighlight
        : hoverHood
          ? !hoverHood.has(id)
          : false;
      ctx.globalAlpha = dimmed ? 0.25 : 1;

      // Community tint halo (once the insight pass writes `community`).
      if (typeof node.community === "number" && !dimmed) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 3.5, 0, 2 * Math.PI);
        ctx.fillStyle =
          COMMUNITY_TINTS[Math.abs(node.community) % COMMUNITY_TINTS.length];
        ctx.fill();
      }

      // Node body.
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = NODE_COLORS[node.label as NodeLabel] ?? "#9CA3AF";
      ctx.fill();

      // Selection ring.
      if (selectedId === id) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 2.2, 0, 2 * Math.PI);
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = Math.max(1.5 / scale, 0.4);
        ctx.stroke();
      }

      // Crown on the top-PageRank node -- the company everyone is
      // positioned against.
      if (topPagerankId === id) {
        drawCrown(ctx, x, y - radius - 2, Math.max(radius * 1.1, 6));
      }

      // Name label: hover, selection, highlight membership, or deep zoom.
      const showLabel =
        hovered || selectedId === id || inHighlight || scale > 2.6;
      if (showLabel) {
        const fontSize = Math.max(12 / scale, 2.5);
        ctx.font = `500 ${fontSize}px ${LABEL_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = String(node.name ?? id);
        ctx.lineWidth = Math.max(3 / scale, 1);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.strokeText(label, x, y + radius + 2);
        ctx.fillStyle = "#111111";
        ctx.fillText(label, x, y + radius + 2);
      }

      ctx.globalAlpha = 1;
    },
    [radiusFor, hoverId, hoverHood, highlightNodes, selectedId, topPagerankId],
  );

  const paintPointerArea = useCallback(
    (node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
      const id = String(node.id ?? "");
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radiusFor(id) + 3, 0, 2 * Math.PI);
      ctx.fill();
    },
    [radiusFor],
  );

  const linkTouchesHover = useCallback(
    (link: FGLink) =>
      hoverId !== null &&
      (endpointId(link.source) === hoverId ||
        endpointId(link.target) === hoverId),
    [hoverId],
  );

  const linkIsHighlighted = useCallback(
    (link: FGLink) => highlightLinks?.has(linkKeyOf(link)) ?? false,
    [highlightLinks],
  );

  const linkColor = useCallback(
    (link: FGLink) => {
      if (highlightLinks) {
        return linkIsHighlighted(link)
          ? "#A85D6E"
          : "rgba(234, 234, 234, 0.35)";
      }
      if (hoverId) {
        return linkTouchesHover(link)
          ? "rgba(120, 119, 116, 0.7)"
          : "rgba(234, 234, 234, 0.35)";
      }
      return "#EAEAEA";
    },
    [highlightLinks, linkIsHighlighted, hoverId, linkTouchesHover],
  );

  const linkWidth = useCallback(
    (link: FGLink) => {
      if (linkIsHighlighted(link)) return 2.5;
      if (linkTouchesHover(link)) return 1.5;
      return 1;
    },
    [linkIsHighlighted, linkTouchesHover],
  );

  const linkParticles = useCallback(
    (link: FGLink) => (linkIsHighlighted(link) ? 3 : 1),
    [linkIsHighlighted],
  );

  const linkParticleWidth = useCallback(
    (link: FGLink) => (linkIsHighlighted(link) ? 3 : 1.5),
    [linkIsHighlighted],
  );

  const linkParticleColor = useCallback(
    (link: FGLink) =>
      linkIsHighlighted(link) ? "#A85D6E" : "rgba(120, 119, 116, 0.35)",
    [linkIsHighlighted],
  );

  /* ---------------------------------------------------------------- */
  /* Interaction                                                       */
  /* ---------------------------------------------------------------- */

  const handleNodeHover = useCallback((node: FGNode | null) => {
    setHoverId(node ? String(node.id ?? "") : null);
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, []);

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      const id = String(node.id ?? "");
      const now = Date.now();
      const isDouble =
        lastClickRef.current.id === id && now - lastClickRef.current.time < 350;
      lastClickRef.current = { id, time: now };
      if (isDouble) {
        onExpand(node as GraphNode);
      } else {
        onSelect(node as GraphNode);
      }
    },
    [onExpand, onSelect],
  );

  const handleBackgroundClick = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

  const handleNodeDragEnd = useCallback((node: FGNode) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  /* Pin settled nodes so later batches do not shove the whole layout. */
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const settledFitRef = useRef(false);

  const handleEngineStop = useCallback(() => {
    for (const node of data.nodes as FGNode[]) {
      if (typeof node.x === "number" && typeof node.y === "number") {
        node.fx = node.x;
        node.fy = node.y;
      }
    }
    // One corrective frame once the finished landscape fully settles
    // (the status-driven fit below can catch mid-settle positions).
    if (statusRef.current === "done" && !settledFitRef.current) {
      settledFitRef.current = true;
      fgRef.current?.zoomToFit(600, 60);
    }
  }, [data]);

  /* Reheat after batches land so new nodes settle into place. Also cap
     charge repulsion range so disconnected nodes (e.g. a white-space
     segment with zero edges) stay near the cluster instead of drifting
     off-frame. Idempotent, so it can run on every data change. */
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as
      | { distanceMax?: (distance: number) => void }
      | undefined;
    charge?.distanceMax?.(260);
    const grew = data.nodes.length - prevNodeCountRef.current;
    prevNodeCountRef.current = data.nodes.length;
    if (grew > 0) {
      fg.d3ReheatSimulation();
    }
  }, [data]);

  /* Frame the finished landscape. */
  useEffect(() => {
    if (status !== "done" || !fgRef.current) return;
    const timer = setTimeout(() => fgRef.current?.zoomToFit(600, 48), 500);
    return () => clearTimeout(timer);
  }, [status]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const ready = ForceGraph !== null && size.width > 0 && size.height > 0;
  const empty =
    data.nodes.length === 0 && (status === "done" || status === "error");
  const waiting =
    data.nodes.length === 0 && (status === "connecting" || status === "streaming");

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-canvas"
    >
      {ready && ForceGraph && (
        <ForceGraph
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="#FFFFFF"
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.6}
          cooldownTicks={100}
          autoPauseRedraw={false}
          nodeLabel={() => ""}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkDirectionalParticles={linkParticles}
          linkDirectionalParticleWidth={linkParticleWidth}
          linkDirectionalParticleColor={linkParticleColor}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          onNodeDragEnd={handleNodeDragEnd}
          onEngineStop={handleEngineStop}
        />
      )}

      {(!ready || waiting) && !empty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="shimmer h-24 w-24 rounded-full" />
            <p className="font-mono text-xs text-ink-2">
              Assembling the landscape
            </p>
          </div>
        </div>
      )}

      {empty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="max-w-xs text-center">
            <div className="mx-auto mb-4 h-3 w-3 rounded-full border border-line" />
            <h2 className="text-sm font-medium tracking-tight text-ink">
              No landscape yet
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-ink-2">
              The pipeline returned no entities for this session. Start a new
              search from the home page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small filled crown above the highest-PageRank node. */
function drawCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  width: number,
) {
  const h = width * 0.62;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, baseY);
  ctx.lineTo(cx - width / 2, baseY - h * 0.9);
  ctx.lineTo(cx - width / 6, baseY - h * 0.45);
  ctx.lineTo(cx, baseY - h);
  ctx.lineTo(cx + width / 6, baseY - h * 0.45);
  ctx.lineTo(cx + width / 2, baseY - h * 0.9);
  ctx.lineTo(cx + width / 2, baseY);
  ctx.closePath();
  ctx.fillStyle = "#B8863B";
  ctx.fill();
}
