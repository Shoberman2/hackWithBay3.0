"use client";

/**
 * useGraphStream -- subscribes to the pipeline SSE endpoint and folds
 * entity/status/insight/done events into an append-only graph state.
 *
 * Node object references are NEVER rebuilt once created: updates merge
 * properties onto the existing object so react-force-graph keeps positions
 * across incremental adds.
 *
 * Demo insurance: if the EventSource errors before any event arrives
 * (endpoint missing, no credentials, offline), the hook replays
 * fixtures/demo-graph.json as a staged client-side stream so the product
 * moment works with zero backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GraphLink,
  GraphNode,
  InsightCard,
  PipelineStage,
} from "@/lib/types";
import { endpointId, linkKeyOf } from "@/components/graph/graph-utils";
import demoGraphRaw from "@/fixtures/demo-graph.json";

export type GraphStreamStatus = "connecting" | "streaming" | "done" | "error";

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface Highlight {
  nodeIds: string[];
  linkKeys: string[];
}

export interface AddedCounts {
  nodes: number;
  links: number;
}

const demoGraph = demoGraphRaw as unknown as {
  nodes: GraphNode[];
  links: GraphLink[];
  insights: InsightCard[];
};

const DEMO_BATCH_SIZE = 8;
const DEMO_BATCH_MS = 650;
const DEMO_INSIGHT_MS = 850;

interface RawEventPayload {
  type?: string;
  stage?: PipelineStage;
  message?: string;
  nodes?: GraphNode[];
  links?: GraphLink[];
  card?: InsightCard;
  kind?: string;
}

export function useGraphStream(sessionId: string) {
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [status, setStatus] = useState<GraphStreamStatus>("connecting");
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  const nodeIndexRef = useRef<Map<string, GraphNode>>(new Map());
  const linkIndexRef = useRef<Set<string>>(new Set());
  const pendingLinksRef = useRef<GraphLink[]>([]);
  const receivedRef = useRef(false);
  const demoRunningRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  /**
   * Append-only reducer. Existing node objects are mutated in place
   * (property merge) and new nodes are appended -- positions persist.
   * Links whose endpoints have not arrived yet are buffered and flushed
   * on a later call. Returns how many nodes/links were actually added.
   */
  const addEntities = useCallback(
    (nodes: GraphNode[], links: GraphLink[]): AddedCounts => {
      const freshNodes: GraphNode[] = [];
      let mergedExisting = false;

      for (const incoming of nodes ?? []) {
        if (!incoming || typeof incoming.id !== "string") continue;
        const existing = nodeIndexRef.current.get(incoming.id);
        if (existing) {
          for (const [key, value] of Object.entries(incoming)) {
            if (
              key === "id" ||
              key === "x" ||
              key === "y" ||
              key === "vx" ||
              key === "vy" ||
              key === "fx" ||
              key === "fy"
            ) {
              continue;
            }
            if (existing[key] !== value) {
              existing[key] = value;
              mergedExisting = true;
            }
          }
        } else {
          const copy: GraphNode = { ...incoming };
          nodeIndexRef.current.set(copy.id, copy);
          freshNodes.push(copy);
        }
      }

      const queue = [...pendingLinksRef.current, ...(links ?? [])];
      pendingLinksRef.current = [];
      const freshLinks: GraphLink[] = [];
      for (const incoming of queue) {
        if (!incoming) continue;
        const key = linkKeyOf(incoming);
        if (linkIndexRef.current.has(key)) continue;
        const source = endpointId(incoming.source);
        const target = endpointId(incoming.target);
        if (
          !nodeIndexRef.current.has(source) ||
          !nodeIndexRef.current.has(target)
        ) {
          pendingLinksRef.current.push(incoming);
          continue;
        }
        linkIndexRef.current.add(key);
        freshLinks.push({ ...incoming, source, target });
      }

      if (freshNodes.length || freshLinks.length || mergedExisting) {
        setData((prev) => ({
          nodes: freshNodes.length ? [...prev.nodes, ...freshNodes] : prev.nodes,
          links: freshLinks.length ? [...prev.links, ...freshLinks] : prev.links,
        }));
      }
      return { nodes: freshNodes.length, links: freshLinks.length };
    },
    [],
  );

  const pushInsight = useCallback((card: InsightCard | undefined) => {
    if (!card || !card.kind || !card.title) return;
    setInsights((prev) =>
      prev.some((c) => c.kind === card.kind && c.title === card.title)
        ? prev
        : [...prev, card],
    );
  }, []);

  /** Staged replay of the bundled fixture -- the zero-credential path. */
  const startDemoReplay = useCallback(() => {
    if (demoRunningRef.current) return;
    demoRunningRef.current = true;
    receivedRef.current = true;
    setStatus("streaming");

    let at = 0;
    const step = (gap: number, fn: () => void) => {
      at += gap;
      timersRef.current.push(setTimeout(fn, at));
    };

    step(0, () => setStage("expand"));
    step(500, () => setStage("discover"));

    // Batch nodes in fixture order; release each link once both of its
    // endpoints have been emitted.
    const emitted = new Set<string>();
    let pendingLinks = [...demoGraph.links];
    const batches: { nodes: GraphNode[]; links: GraphLink[] }[] = [];
    for (let i = 0; i < demoGraph.nodes.length; i += DEMO_BATCH_SIZE) {
      const batchNodes = demoGraph.nodes.slice(i, i + DEMO_BATCH_SIZE);
      for (const node of batchNodes) emitted.add(node.id);
      const ready: GraphLink[] = [];
      const rest: GraphLink[] = [];
      for (const link of pendingLinks) {
        if (
          emitted.has(endpointId(link.source)) &&
          emitted.has(endpointId(link.target))
        ) {
          ready.push(link);
        } else {
          rest.push(link);
        }
      }
      pendingLinks = rest;
      batches.push({ nodes: batchNodes, links: ready });
    }

    batches.forEach((batch, index) => {
      step(index === 0 ? 600 : DEMO_BATCH_MS, () => {
        if (index === 0) setStage("extract");
        if (index === Math.floor(batches.length / 2)) setStage("write");
        addEntities(batch.nodes, batch.links);
      });
    });

    step(700, () => setStage("insight"));
    demoGraph.insights.forEach((card) => {
      step(DEMO_INSIGHT_MS, () => pushInsight(card));
    });
    step(600, () => setStatus("done"));
  }, [addEntities, pushInsight]);

  useEffect(() => {
    if (!sessionId) return;

    let source: EventSource | null = null;

    const handle = (eventName: string, raw: unknown) => {
      let payload: RawEventPayload = {};
      if (typeof raw === "string" && raw.length) {
        try {
          payload = JSON.parse(raw) as RawEventPayload;
        } catch {
          payload = {};
        }
      }
      const type = payload.type ?? eventName;
      receivedRef.current = true;

      if (type === "status") {
        setStatus((prev) => (prev === "done" ? prev : "streaming"));
        if (payload.stage) setStage(payload.stage);
      } else if (type === "entity") {
        setStatus((prev) => (prev === "done" ? prev : "streaming"));
        addEntities(payload.nodes ?? [], payload.links ?? []);
      } else if (type === "insight") {
        // Route teams may send { card } or the card fields inline.
        pushInsight(payload.card ?? (payload as unknown as InsightCard));
      } else if (type === "done") {
        setStatus("done");
        source?.close();
      }
    };

    try {
      // The route reads `sessionId`; `session` is kept for compatibility
      // with earlier drafts of the contract. idea/tags/terms are forwarded
      // from the page URL so a live onboarding run reaches the pipeline.
      const query = new URLSearchParams();
      query.set("sessionId", sessionId);
      query.set("session", sessionId);
      if (typeof window !== "undefined") {
        const pageParams = new URLSearchParams(window.location.search);
        for (const key of ["idea", "tags", "terms"]) {
          const value = pageParams.get(key);
          if (value) query.set(key, value);
        }
      }
      source = new EventSource(`/api/pipeline/stream?${query.toString()}`);
    } catch {
      startDemoReplay();
      return () => {
        for (const timer of timersRef.current) clearTimeout(timer);
        timersRef.current = [];
        demoRunningRef.current = false;
      };
    }

    for (const eventName of ["status", "entity", "insight", "done"]) {
      source.addEventListener(eventName, (event) =>
        handle(eventName, (event as MessageEvent).data),
      );
    }
    source.onmessage = (event) => handle("message", event.data);
    source.onerror = () => {
      if (!receivedRef.current) {
        // Endpoint absent or unreachable before first byte: demo insurance.
        source?.close();
        startDemoReplay();
      } else if (source && source.readyState === EventSource.CLOSED) {
        setStatus((prev) => (prev === "done" ? prev : "error"));
      }
      // Otherwise the browser is reconnecting; keep streaming state.
    };

    return () => {
      source?.close();
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
      // Allow a strict-mode remount (or session change) to restart the
      // replay; addEntities/pushInsight dedupe, so re-runs are harmless.
      demoRunningRef.current = false;
    };
  }, [sessionId, addEntities, pushInsight, startDemoReplay]);

  return {
    data,
    status,
    stage,
    insights,
    addEntities,
    highlight,
    setHighlight,
  };
}

/**
 * 1-hop expansion from the bundled fixture -- fallback for /api/expand in
 * demo mode or when the route errors. Returns true if anything new landed.
 */
export function expandFromFixture(
  nodeId: string,
  addEntities: (nodes: GraphNode[], links: GraphLink[]) => AddedCounts,
): boolean {
  const touching = demoGraph.links.filter(
    (link) =>
      endpointId(link.source) === nodeId || endpointId(link.target) === nodeId,
  );
  if (!touching.length) return false;

  const neighborIds = new Set<string>();
  for (const link of touching) {
    neighborIds.add(endpointId(link.source));
    neighborIds.add(endpointId(link.target));
  }
  const neighbors = demoGraph.nodes.filter((node) => neighborIds.has(node.id));
  const added = addEntities(neighbors, touching);
  return added.nodes > 0 || added.links > 0;
}
