"use client";

/**
 * useProgressiveGraph -- progressive-disclosure graph state backed by
 * the live pipeline stream when a new search starts, and by /api/graph
 * when an existing session is reopened.
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

const ALLOW_FIXTURE_FALLBACK =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const fixture = demoGraphRaw as unknown as {
  nodes: GraphNode[];
  links: GraphLink[];
  insights: InsightCard[];
};

const POSITION_KEYS = new Set(["x", "y", "vx", "vy", "fx", "fy", "index"]);

/** Node labels revealed up front -- the competitive skeleton. */
const SEED_LABELS = new Set<NodeLabel>(["Idea", "Company", "Segment"]);

interface RawEventPayload {
  type?: string;
  stage?: PipelineStage;
  message?: string;
  nodes?: GraphNode[];
  links?: GraphLink[];
  card?: InsightCard;
  error?: string;
  kind?: string;
  title?: string;
}

export interface ProgressiveGraph {
  data: GraphData;
  status: GraphStreamStatus;
  stage: PipelineStage | null;
  insights: InsightCard[];
  highlight: Highlight | null;
  setHighlight: (highlight: Highlight | null) => void;
  /** Reveal a node's 1-hop neighborhood. Returns what was newly added. */
  expand: (node: GraphNode) => AddedCounts;
  revealedCount: number;
  totalCount: number;
}

function mergeNode(target: GraphNode, incoming: GraphNode): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "id") continue;
    if (POSITION_KEYS.has(key) && target[key] !== undefined) continue;
    if (target[key] !== value) {
      target[key] = value;
      changed = true;
    }
  }
  return changed;
}

function addAdjacency(
  adjacency: Map<string, Set<string>>,
  source: string,
  target: string,
) {
  if (!adjacency.has(source)) adjacency.set(source, new Set());
  if (!adjacency.has(target)) adjacency.set(target, new Set());
  adjacency.get(source)!.add(target);
  adjacency.get(target)!.add(source);
}

export function useProgressiveGraph(sessionId: string): ProgressiveGraph {
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [status, setStatus] = useState<GraphStreamStatus>("connecting");
  const [stage, setStage] = useState<PipelineStage | null>(null);
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

  const reset = useCallback(() => {
    fullNodes.current = new Map();
    fullLinks.current = [];
    fullLinkKeys.current = new Set();
    adjacency.current = new Map();
    nodeObjs.current = new Map();
    revealed.current = new Set();
    addedLinks.current = new Set();
    setData({ nodes: [], links: [] });
    setStatus("connecting");
    setStage(null);
    setInsights([]);
    setHighlightState(null);
    setRevealedCount(0);
    setTotalCount(0);
  }, []);

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
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (revealed.current.has(source) && revealed.current.has(target)) {
        addedLinks.current.add(key);
        freshLinks.push({ ...link, source, target });
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

  const absorbEntities = useCallback(
    (nodes: GraphNode[] = [], links: GraphLink[] = []) => {
      let visibleNodeChanged = false;
      const seedIds: string[] = [];

      for (const incoming of nodes) {
        if (!incoming?.id) continue;
        const existing = fullNodes.current.get(incoming.id);
        if (existing) {
          mergeNode(existing, incoming);
        } else {
          fullNodes.current.set(incoming.id, { ...incoming });
        }
        const visible = nodeObjs.current.get(incoming.id);
        if (visible && mergeNode(visible, incoming)) visibleNodeChanged = true;
        if (SEED_LABELS.has(incoming.label)) seedIds.push(incoming.id);
      }

      for (const link of links) {
        const source = endpointId(link.source);
        const target = endpointId(link.target);
        if (!source || !target) continue;
        const normalized = { ...link, source, target };
        const key = linkKeyOf(normalized);
        if (fullLinkKeys.current.has(key)) continue;
        fullLinkKeys.current.add(key);
        fullLinks.current.push(normalized);
        addAdjacency(adjacency.current, source, target);
      }

      setTotalCount(fullNodes.current.size);
      if (visibleNodeChanged) {
        setData((prev) => ({ nodes: [...prev.nodes], links: prev.links }));
      }
      revealNodes(seedIds);
      revealNodes([]);
    },
    [revealNodes],
  );

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

  const loadFixture = useCallback(() => {
    absorbEntities(fixture.nodes, fixture.links);
    setInsights(fixture.insights ?? []);
    setStatus("done");
  }, [absorbEntities]);

  useEffect(() => {
    if (!sessionId) return;
    reset();

    let cancelled = false;
    let source: EventSource | null = null;

    const handle = (eventName: string, raw: unknown) => {
      if (cancelled) return;
      let payload: RawEventPayload = {};
      if (typeof raw === "string" && raw.length) {
        try {
          payload = JSON.parse(raw) as RawEventPayload;
        } catch {
          payload = {};
        }
      }
      const type = payload.type ?? eventName;

      if (type === "status") {
        if (payload.stage) setStage(payload.stage);
        if (payload.error || payload.message?.startsWith("Pipeline error")) {
          setStatus("error");
          source?.close();
        } else {
          setStatus((prev) => (prev === "done" ? prev : "streaming"));
        }
      } else if (type === "entity") {
        setStatus((prev) => (prev === "done" ? prev : "streaming"));
        absorbEntities(payload.nodes ?? [], payload.links ?? []);
      } else if (type === "insight") {
        const card = payload.card ?? (payload as unknown as InsightCard);
        if (card?.kind && card.title) {
          setInsights((prev) =>
            prev.some((c) => c.kind === card.kind && c.title === card.title)
              ? prev
              : [...prev, card],
          );
        }
      } else if (type === "pipeline-error") {
        if (payload.stage) setStage(payload.stage);
        setStatus("error");
        source?.close();
      } else if (type === "done") {
        setStatus("done");
        source?.close();
      }
    };

    const loadSnapshot = async () => {
      try {
        const res = await fetch(`/api/graph/${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(`graph returned ${res.status}`);
        const body = (await res.json()) as {
          nodes?: GraphNode[];
          links?: GraphLink[];
        };
        if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
          throw new Error("graph returned no nodes");
        }
        if (cancelled) return;
        absorbEntities(body.nodes, body.links ?? []);
        setStatus("done");
      } catch {
        if (cancelled) return;
        if (ALLOW_FIXTURE_FALLBACK) {
          loadFixture();
        } else {
          setStatus("error");
        }
      }
    };

    const params =
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search);
    const shouldStream =
      params.has("idea") || params.has("tags") || params.has("terms");

    if (!shouldStream) {
      void loadSnapshot();
      return () => {
        cancelled = true;
        source?.close();
      };
    }

    const query = new URLSearchParams();
    query.set("sessionId", sessionId);
    query.set("session", sessionId);
    for (const key of ["idea", "tags", "terms"]) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }

    try {
      source = new EventSource(`/api/pipeline/stream?${query.toString()}`);
      for (const eventName of [
        "status",
        "entity",
        "insight",
        "pipeline-error",
        "done",
      ]) {
        source.addEventListener(eventName, (event) =>
          handle(eventName, (event as MessageEvent).data),
        );
      }
      source.onmessage = (event) => handle("message", event.data);
      source.onerror = () => {
        if (cancelled) return;
        if (fullNodes.current.size === 0 && ALLOW_FIXTURE_FALLBACK) {
          source?.close();
          loadFixture();
          return;
        }
        setStatus((prev) => (prev === "done" ? prev : "error"));
      };
    } catch {
      if (ALLOW_FIXTURE_FALLBACK) {
        loadFixture();
      } else {
        setStatus("error");
      }
    }

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [sessionId, absorbEntities, loadFixture, reset]);

  return {
    data,
    status,
    stage,
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
