"use client";

/**
 * useProgressiveGraph -- progressive-disclosure graph state.
 *
 * The full landscape is NOT shown at once. The graph seeds with the market
 * skeleton (the idea, the companies, and the segments they compete in) and
 * every other node -- founders, investors, funding rounds, features, moats,
 * traction -- stays hidden until the user taps a node to reveal its 1-hop
 * neighborhood. Node object references are created once and reused so
 * react-force-graph keeps positions across reveals.
 *
 * Source of truth is the bundled fixture (the same graph /api/graph/[id]
 * serves in demo mode). A live Neo4j deployment would swap `loadFull` for a
 * fetch; the reveal mechanics are unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphLink, GraphNode, InsightCard, NodeLabel } from "@/lib/types";
import { endpointId, linkKeyOf } from "@/components/graph/graph-utils";
import type {
  AddedCounts,
  GraphData,
  GraphStreamStatus,
  Highlight,
} from "@/hooks/useGraphStream";
import demoGraphRaw from "@/fixtures/demo-graph.json";

const fixture = demoGraphRaw as unknown as {
  nodes: GraphNode[];
  links: GraphLink[];
  insights: InsightCard[];
};

/** Node labels revealed up front -- the competitive skeleton. */
const SEED_LABELS = new Set<NodeLabel>(["Idea", "Company", "Segment"]);

export interface ProgressiveGraph {
  data: GraphData;
  status: GraphStreamStatus;
  insights: InsightCard[];
  highlight: Highlight | null;
  setHighlight: (highlight: Highlight | null) => void;
  /** Reveal a node's 1-hop neighborhood. Returns what was newly added. */
  expand: (node: GraphNode) => AddedCounts;
  revealedCount: number;
  totalCount: number;
}

export function useProgressiveGraph(sessionId: string): ProgressiveGraph {
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [status, setStatus] = useState<GraphStreamStatus>("connecting");
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [highlight, setHighlightState] = useState<Highlight | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const fullNodes = useRef<Map<string, GraphNode>>(new Map());
  const fullLinks = useRef<GraphLink[]>([]);
  const adjacency = useRef<Map<string, Set<string>>>(new Map());
  const nodeObjs = useRef<Map<string, GraphNode>>(new Map());
  const revealed = useRef<Set<string>>(new Set());
  const addedLinks = useRef<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** Append revealed nodes + any links now joining two revealed nodes. */
  const revealNodes = useCallback((ids: string[]): AddedCounts => {
    const freshNodes: GraphNode[] = [];
    for (const id of ids) {
      if (revealed.current.has(id)) continue;
      const src = fullNodes.current.get(id);
      if (!src) continue;
      revealed.current.add(id);
      let obj = nodeObjs.current.get(id);
      if (!obj) {
        obj = { ...src };
        nodeObjs.current.set(id, obj);
      }
      freshNodes.push(obj);
    }

    const freshLinks: GraphLink[] = [];
    for (const link of fullLinks.current) {
      const key = linkKeyOf(link);
      if (addedLinks.current.has(key)) continue;
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      if (revealed.current.has(s) && revealed.current.has(t)) {
        addedLinks.current.add(key);
        freshLinks.push({ ...link, source: s, target: t });
      }
    }

    if (freshNodes.length || freshLinks.length) {
      setData((prev) => ({
        nodes: freshNodes.length ? [...prev.nodes, ...freshNodes] : prev.nodes,
        links: freshLinks.length ? [...prev.links, ...freshLinks] : prev.links,
      }));
      if (freshNodes.length) setRevealedCount(revealed.current.size);
    }
    return { nodes: freshNodes.length, links: freshLinks.length };
  }, []);

  const expand = useCallback(
    (node: GraphNode): AddedCounts => {
      const neighbors = adjacency.current.get(node.id);
      if (!neighbors || neighbors.size === 0) return { nodes: 0, links: 0 };
      return revealNodes([node.id, ...neighbors]);
    },
    [revealNodes],
  );

  // Insight highlight also reveals its referenced nodes so a collapsed
  // graph still lights up the path when a card is clicked.
  const setHighlight = useCallback(
    (next: Highlight | null) => {
      if (next?.nodeIds?.length) revealNodes(next.nodeIds);
      setHighlightState(next);
    },
    [revealNodes],
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function load() {
      let nodes = fixture.nodes;
      let links = fixture.links;
      try {
        const res = await fetch(`/api/graph/${encodeURIComponent(sessionId)}`);
        if (res.ok) {
          const body = (await res.json()) as { nodes?: GraphNode[]; links?: GraphLink[] };
          if (Array.isArray(body.nodes) && body.nodes.length) {
            nodes = body.nodes;
            links = body.links ?? [];
          }
        }
      } catch {
        // fixture already holds the fallback
      }
      if (cancelled) return;

      fullNodes.current = new Map(nodes.map((n) => [n.id, n]));
      fullLinks.current = links;
      const adj = new Map<string, Set<string>>();
      for (const link of links) {
        const s = endpointId(link.source);
        const t = endpointId(link.target);
        if (!adj.has(s)) adj.set(s, new Set());
        if (!adj.has(t)) adj.set(t, new Set());
        adj.get(s)!.add(t);
        adj.get(t)!.add(s);
      }
      adjacency.current = adj;
      setTotalCount(nodes.length);
      setInsights(fixture.insights ?? []);

      const seedFor = (label: NodeLabel) =>
        nodes.filter((n) => n.label === label).map((n) => n.id);
      const ideas = seedFor("Idea");
      const companies = seedFor("Company");
      const segments = seedFor("Segment");
      const half = Math.ceil(companies.length / 2);

      setStatus("streaming");
      const step = (gap: number, fn: () => void) =>
        timers.current.push(setTimeout(fn, gap));

      step(0, () => revealNodes(ideas));
      step(350, () => revealNodes(companies.slice(0, half)));
      step(650, () => revealNodes(companies.slice(half)));
      step(950, () => revealNodes(segments));
      step(1250, () => setStatus("done"));
    }

    void load();
    return () => {
      cancelled = true;
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
    // SEED_LABELS/fixture are module constants; revealNodes is stable.
  }, [sessionId, revealNodes]);

  return {
    data,
    status,
    insights,
    highlight,
    setHighlight,
    expand,
    revealedCount,
    totalCount,
  };
}

/** Labels shown in the initial seed (exported for copy/legend hints). */
export { SEED_LABELS };
