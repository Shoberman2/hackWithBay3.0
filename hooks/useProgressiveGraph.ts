"use client";

/**
 * useProgressiveGraph -- progressive-disclosure graph state over the LIVE
 * pipeline.
 *
 * The full landscape is NOT shown at once. The graph seeds with the market
 * skeleton (the idea, the companies, and the segments they compete in) and
 * every other node -- founders, investors, funding rounds, features, moats,
 * traction -- stays hidden until the user taps a node to reveal its 1-hop
 * neighborhood. Node object references are created once and reused so the
 * graph view keeps positions across reveals.
 *
 * Data source:
 *  - When the page URL carries an `idea` (a real onboarding run), the hook
 *    subscribes to /api/pipeline/stream and accumulates the streamed graph
 *    for THAT idea, revealing the seed labels as they arrive. This is what
 *    makes every idea produce its own custom landscape.
 *  - With no `idea` (the /session/demo link), it replays the bundled
 *    fixture so the curated demo still works offline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GraphLink,
  GraphNode,
  InsightCard,
  NodeLabel,
  PipelineStage,
} from "@/lib/types";
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

interface RawEventPayload {
  type?: string;
  stage?: PipelineStage;
  message?: string;
  nodes?: GraphNode[];
  links?: GraphLink[];
  card?: InsightCard;
}

export interface ProgressiveGraph {
  data: GraphData;
  /** The complete accumulated landscape (all labels), for the table view. */
  fullData: GraphData;
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
  const [fullData, setFullData] = useState<GraphData>({ nodes: [], links: [] });
  const [status, setStatus] = useState<GraphStreamStatus>("connecting");
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [highlight, setHighlightState] = useState<Highlight | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const fullNodes = useRef<Map<string, GraphNode>>(new Map());
  const fullLinks = useRef<GraphLink[]>([]);
  const fullLinkKeys = useRef<Set<string>>(new Set());
  const adjacency = useRef<Map<string, Set<string>>>(new Map());
  const nodeObjs = useRef<Map<string, GraphNode>>(new Map());
  const revealed = useRef<Set<string>>(new Set());
  const addedLinks = useRef<Set<string>>(new Set());
  const insightKeys = useRef<Set<string>>(new Set());
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

  /**
   * Fold a batch of streamed (or fixture) entities into the full graph,
   * update adjacency, and auto-reveal seed-label nodes. Property updates
   * merge onto the stored node (the insight pass re-sends annotated nodes).
   */
  const ingest = useCallback(
    (nodes: GraphNode[], links: GraphLink[]) => {
      for (const n of nodes) {
        const existing = fullNodes.current.get(n.id);
        if (existing) {
          Object.assign(existing, n);
          const obj = nodeObjs.current.get(n.id);
          if (obj) Object.assign(obj, n);
        } else {
          fullNodes.current.set(n.id, { ...n });
        }
      }
      for (const link of links) {
        const key = linkKeyOf(link);
        if (fullLinkKeys.current.has(key)) continue;
        fullLinkKeys.current.add(key);
        fullLinks.current.push(link);
        const s = endpointId(link.source);
        const t = endpointId(link.target);
        if (!adjacency.current.has(s)) adjacency.current.set(s, new Set());
        if (!adjacency.current.has(t)) adjacency.current.set(t, new Set());
        adjacency.current.get(s)!.add(t);
        adjacency.current.get(t)!.add(s);
      }
      setTotalCount(fullNodes.current.size);
      setFullData({
        nodes: [...fullNodes.current.values()],
        links: [...fullLinks.current],
      });

      const seedIds: string[] = [];
      for (const n of nodes) {
        if (SEED_LABELS.has(n.label)) seedIds.push(n.id);
      }
      // Always re-run reveal: newly arrived links may now join two nodes
      // that were already revealed (e.g. a company to an earlier segment).
      revealNodes(seedIds);
    },
    [revealNodes],
  );

  const pushInsight = useCallback((card?: InsightCard) => {
    if (!card) return;
    const key = `${card.kind}|${card.title}`;
    if (insightKeys.current.has(key)) return;
    insightKeys.current.add(key);
    if (card.highlight?.nodeIds?.length) revealNodes(card.highlight.nodeIds);
    setInsights((prev) => [...prev, card]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNodes]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    // Read the idea/tags/terms the onboarding forwarded in the page URL.
    const pageParams =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const idea = pageParams.get("idea");

    /* -------- fixture replay (no idea: the /session/demo link) -------- */
    function replayFixture() {
      ingest(fixture.nodes, fixture.links);
      setStatus("streaming");
      const step = (gap: number, fn: () => void) =>
        timers.current.push(setTimeout(fn, gap));
      for (const card of fixture.insights ?? []) {
        step(900, () => pushInsight(card));
      }
      step(1250, () => setStatus("done"));
    }

    if (!idea) {
      replayFixture();
      return () => {
        cancelled = true;
        for (const t of timers.current) clearTimeout(t);
        timers.current = [];
      };
    }

    /* -------- live pipeline stream (real per-idea landscape) -------- */
    const query = new URLSearchParams();
    query.set("sessionId", sessionId);
    query.set("session", sessionId);
    for (const key of ["idea", "tags", "terms"]) {
      const value = pageParams.get(key);
      if (value) query.set(key, value);
    }

    let source: EventSource | null = null;
    let receivedEntities = false;

    const handle = (eventName: string, raw: string) => {
      if (cancelled) return;
      let payload: RawEventPayload;
      try {
        payload = JSON.parse(raw) as RawEventPayload;
      } catch {
        payload = {};
      }
      const type = payload.type ?? eventName;
      if (type === "status") {
        setStatus((prev) => (prev === "done" ? prev : "streaming"));
      } else if (type === "entity") {
        setStatus((prev) => (prev === "done" ? prev : "streaming"));
        if ((payload.nodes?.length ?? 0) > 0) receivedEntities = true;
        ingest(payload.nodes ?? [], payload.links ?? []);
      } else if (type === "insight") {
        pushInsight(payload.card ?? (payload as unknown as InsightCard));
      } else if (type === "done") {
        setStatus("done");
        source?.close();
      }
    };

    try {
      source = new EventSource(`/api/pipeline/stream?${query.toString()}`);
    } catch {
      // Could not open the stream at all: show the idea alone rather than
      // an unrelated fixture.
      setStatus("done");
      return () => {
        cancelled = true;
      };
    }

    for (const eventName of ["status", "entity", "insight", "done"]) {
      source.addEventListener(eventName, (event) =>
        handle(eventName, (event as MessageEvent).data),
      );
    }
    source.onmessage = (event) => handle("message", event.data);
    source.onerror = () => {
      // Never fall back to the internship fixture on a real idea; keep
      // whatever streamed so the graph stays about the user's own idea.
      if (source && source.readyState === EventSource.CLOSED) {
        setStatus((prev) => (prev === "done" ? prev : receivedEntities ? "done" : "error"));
      }
    };

    return () => {
      cancelled = true;
      source?.close();
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, [sessionId, ingest, pushInsight]);

  return {
    data,
    fullData,
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
