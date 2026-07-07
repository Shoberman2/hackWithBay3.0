"use client";

/**
 * LiveGraph -- the force-directed landscape canvas, rendered with the
 * Neo4j Visualization Library (NVL, @neo4j-nvl/react).
 *
 * NVL touches the DOM at mount time, so the wrapper module is loaded
 * client-side inside an effect (never statically, never through a server
 * component).
 *
 * Progressive-disclosure model:
 *  - default view: ONLY Company nodes (logo discs sized by pagerank, with
 *    always-visible names beneath) plus the Idea node as a small subtle
 *    center anchor. Everything else stays in `data` but is hidden.
 *  - click a company: toggles its expansion AND selects it in the detail
 *    panel. Expansion fans out its direct Founder / Investor / FundingRound
 *    neighbors as small type-colored satellites with small gray labels.
 *    Multiple companies can be expanded at once; a shared investor renders
 *    as ONE node linked to every visible company it backs.
 *  - click a satellite: selects it in the panel (no collapse).
 *  - insight highlight: auto-expands the companies on the path, force-shows
 *    every highlighted node, lights highlighted links rose, dims the rest,
 *    and frames the highlighted subset.
 *  - Feature / Segment / LaunchEvent / Post / MoatClaim / TractionSignal /
 *    WebsiteSnapshot / Source stay panel-only (visible transiently only
 *    while an insight highlight names them).
 *
 * Implementation notes (NVL specifics):
 *  - Names beneath nodes use the experimental Node.html overlay: NVL
 *    centers the element on the node (box of side 2*size) and scales it
 *    with zoom, so a child hung below the box tracks the node exactly.
 *    The element must arrive via an attribute UPDATE (node ADDs deep-clone
 *    DOM references away), hence the two-pass htmlTick dance below.
 *  - Company logos use Node.icon over a white disc. The Google favicon
 *    host sends no CORS headers and NVL loads icons with
 *    crossOrigin=anonymous, so logos are served through the same-origin
 *    /api/logo proxy and preloaded here first -- a URL is only handed to
 *    NVL once it is known to load, so a broken image is never drawn.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type NVL from "@neo4j-nvl/base";
import type {
  Node as NvlNode,
  Relationship as NvlRelationship,
} from "@neo4j-nvl/base";
import type { MouseEventCallbacks } from "@neo4j-nvl/react";
import type { GraphLink, GraphNode, NodeLabel } from "@/lib/types";
import type {
  GraphData,
  GraphStreamStatus,
  Highlight,
} from "@/hooks/useGraphStream";
import { endpointId, linkKeyOf, NODE_COLORS } from "./graph-utils";

type NvlWrapper = typeof import("@neo4j-nvl/react").InteractiveNvlWrapper;

const LABEL_FONT = "Geist, ui-sans-serif, system-ui, sans-serif";

/** Node types disclosed by expanding a company. Everything else that is
 *  not Idea/Company remains panel-only. */
const SATELLITE_LABELS = new Set<NodeLabel>([
  "Founder",
  "Investor",
  "FundingRound",
]);

const COMPANY_RADIUS_MIN = 8;
const COMPANY_RADIUS_MAX = 16;
const SATELLITE_RADIUS = 4.5;
const IDEA_RADIUS = 3.5;
const LABEL_MAX_CHARS = 18;

const IDEA_COLOR = "#B7B4AE";
const DIMMED_COLOR = "#EAEAEA";
const HIGHLIGHT_LINK_COLOR = "#A85D6E";
const BASE_LINK_COLOR = "rgba(0, 0, 0, 0.10)";
const EXPANDED_LINK_COLOR = "rgba(0, 0, 0, 0.28)";
const HOVER_LINK_COLOR = "rgba(0, 0, 0, 0.35)";
const FADED_LINK_COLOR = "rgba(234, 234, 234, 0.4)";

/** Gold crown marking the top-PageRank company, as an overlay icon. */
const CROWN_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path fill="#B8863B" d="M2 19h20v3H2zM2 17l1-11 5.5 5L12 3l3.5 8L21 6l1 11z"/>' +
      "</svg>",
  );
/** Stable reference: the react wrapper diffs node attributes by identity. */
const CROWN_OVERLAY = { url: CROWN_ICON, position: [0, -1.6], size: 0.7 };

/* ------------------------------------------------------------------ */
/* Company logo preloading (module-level, shared across mounts)        */
/* ------------------------------------------------------------------ */

type LogoStatus = "loading" | "ready" | "failed";

const logoStatusByUrl = new Map<string, LogoStatus>();
const logoListeners = new Set<() => void>();

function notifyLogoListeners(): void {
  for (const listener of logoListeners) listener();
}

/**
 * Kick off (once) and report the load state for a logo URL. NVL only ever
 * receives URLs in the "ready" state, so it never draws a broken image.
 */
function probeLogo(url: string): LogoStatus {
  const current = logoStatusByUrl.get(url);
  if (current) return current;
  logoStatusByUrl.set(url, "loading");
  const img = new Image();
  img.onload = () => {
    logoStatusByUrl.set(url, img.naturalWidth > 0 ? "ready" : "failed");
    notifyLogoListeners();
  };
  img.onerror = () => {
    logoStatusByUrl.set(url, "failed");
    notifyLogoListeners();
  };
  img.src = url;
  return "loading";
}

/**
 * Map a stored logo_url (Google favicon service) onto the same-origin
 * /api/logo proxy. Returns null when no proxied URL can be derived --
 * those companies keep the lettered-disc fallback.
 */
function proxiedLogoUrl(node: GraphNode): string | null {
  const raw = typeof node.logo_url === "string" ? node.logo_url : "";
  if (raw) {
    try {
      const domain = new URL(raw).searchParams.get("domain");
      if (domain) return `/api/logo?domain=${encodeURIComponent(domain)}`;
    } catch {
      /* fall through to the domain property */
    }
  }
  const domain = typeof node.domain === "string" ? node.domain : "";
  return domain ? `/api/logo?domain=${encodeURIComponent(domain)}` : null;
}

function ellipsize(text: string, max = LABEL_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

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
  const [Wrapper, setWrapper] = useState<NvlWrapper | null>(null);
  const nvlRef = useRef<NVL | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Companies currently fanned out. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** True once the user pans/zooms -- streaming auto-fit stops fighting
   *  them (explicit expand/collapse and highlight fits still run). */
  const userNavigatedRef = useRef(false);
  /** Bumped when a logo probe settles so discs swap to logos. */
  const [logoTick, setLogoTick] = useState(0);
  /** Bumped one render after nodes are first sent, to attach html labels
   *  (NVL drops DOM references on node ADD; they must arrive as UPDATE). */
  const [htmlTick, setHtmlTick] = useState(0);
  const sentNodeIdsRef = useRef<Set<string>>(new Set());
  const labelElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  /* Client-only module load (NVL needs the DOM). */
  useEffect(() => {
    let mounted = true;
    import("@neo4j-nvl/react").then((mod) => {
      if (mounted) setWrapper(() => mod.InteractiveNvlWrapper);
    });
    return () => {
      mounted = false;
    };
  }, []);

  /* Re-render when logo probes settle (module-level cache, local tick). */
  useEffect(() => {
    const listener = () => setLogoTick((t) => t + 1);
    logoListeners.add(listener);
    return () => {
      logoListeners.delete(listener);
    };
  }, []);

  /* Derived indexes -- cheap at hackathon graph sizes. */
  const nodeIndex = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of data.nodes) map.set(node.id, node);
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
      if (
        node.label === "Company" &&
        typeof node.pagerank === "number" &&
        node.pagerank > bestScore
      ) {
        bestScore = node.pagerank;
        best = node.id;
      }
    }
    return best;
  }, [data]);

  /* Company sizing: pagerank mapped onto [8, 16]px radius. */
  const pagerankExtent = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const node of data.nodes) {
      if (node.label === "Company" && typeof node.pagerank === "number") {
        if (node.pagerank < min) min = node.pagerank;
        if (node.pagerank > max) max = node.pagerank;
      }
    }
    return min <= max ? { min, max } : null;
  }, [data]);

  const nodeRadius = useCallback(
    (node: GraphNode): number => {
      if (node.label === "Idea") return IDEA_RADIUS;
      if (node.label !== "Company") return SATELLITE_RADIUS;
      if (
        !pagerankExtent ||
        typeof node.pagerank !== "number" ||
        pagerankExtent.max <= pagerankExtent.min
      ) {
        return (COMPANY_RADIUS_MIN + COMPANY_RADIUS_MAX) / 2;
      }
      const t =
        (node.pagerank - pagerankExtent.min) /
        (pagerankExtent.max - pagerankExtent.min);
      return (
        COMPANY_RADIUS_MIN + t * (COMPANY_RADIUS_MAX - COMPANY_RADIUS_MIN)
      );
    },
    [pagerankExtent],
  );

  const highlightNodes = useMemo(
    () => (highlight ? new Set(highlight.nodeIds) : null),
    [highlight],
  );
  const highlightLinks = useMemo(
    () => (highlight ? new Set(highlight.linkKeys) : null),
    [highlight],
  );

  /* ---------------------------------------------------------------- */
  /* Visible subgraph (progressive disclosure)                         */
  /* ---------------------------------------------------------------- */

  const visible = useMemo<GraphData>(() => {
    const visibleIds = new Set<string>();
    for (const node of data.nodes) {
      if (node.label === "Idea" || node.label === "Company") {
        visibleIds.add(node.id);
      }
    }
    // Satellites of expanded companies.
    for (const companyId of expanded) {
      for (const neighborId of adjacency.get(companyId) ?? []) {
        const neighbor = nodeIndex.get(neighborId);
        if (neighbor && SATELLITE_LABELS.has(neighbor.label)) {
          visibleIds.add(neighborId);
        }
      }
    }
    // Every highlighted node must be visible, whatever its type.
    if (highlightNodes) {
      for (const id of highlightNodes) {
        if (nodeIndex.has(id)) visibleIds.add(id);
      }
    }
    return {
      nodes: data.nodes.filter((node) => visibleIds.has(node.id)),
      links: data.links.filter(
        (link) =>
          visibleIds.has(endpointId(link.source)) &&
          visibleIds.has(endpointId(link.target)),
      ),
    };
  }, [data, expanded, adjacency, nodeIndex, highlightNodes]);

  const hoverHood = useMemo(() => {
    if (!hoverId) return null;
    return new Set([hoverId, ...(adjacency.get(hoverId) ?? [])]);
  }, [hoverId, adjacency]);

  /* Two-pass html attach: after nodes are first sent (ADD), re-render so
     the label element rides in as an attribute UPDATE. Ids of removed
     nodes are purged so a later re-add replays the dance. */
  useEffect(() => {
    const ids = new Set(visible.nodes.map((node) => node.id));
    const sent = sentNodeIdsRef.current;
    for (const id of [...sent]) {
      if (!ids.has(id)) sent.delete(id);
    }
    let added = false;
    for (const id of ids) {
      if (!sent.has(id)) {
        sent.add(id);
        added = true;
      }
    }
    if (added) setHtmlTick((t) => t + 1);
  }, [visible]);

  /* Seed layout positions. NVL's WebGL force layout piles brand-new nodes
     into a tiny blob near the center; a deterministic golden-angle ring for
     companies (and a jittered orbit near the parent company for satellites)
     gives the physics a non-degenerate start and keeps fan-outs local.
     Seeds ride the same second-pass UPDATE as the html labels because the
     layout only honors x/y arriving as node updates. */
  const seedPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const companySeedIndexRef = useRef(0);

  const seedPositionFor = useCallback(
    (node: GraphNode): { x: number; y: number } => {
      const cached = seedPositionsRef.current.get(node.id);
      if (cached) return cached;
      let seed: { x: number; y: number };
      if (node.label === "Idea") {
        seed = { x: 0, y: 0 };
      } else if (node.label === "Company") {
        const i = companySeedIndexRef.current++;
        const angle = i * 2.3999632297286533; // golden angle
        const radius = 200 + 30 * (i % 3);
        seed = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      } else {
        // Satellite: orbit the first adjacent company's current position.
        let anchor: { x: number; y: number } | null = null;
        for (const neighborId of adjacency.get(node.id) ?? []) {
          if (nodeIndex.get(neighborId)?.label !== "Company") continue;
          const pos = nvlRef.current?.getPositionById(neighborId) as
            | { x?: number; y?: number }
            | undefined;
          if (
            pos &&
            typeof pos.x === "number" &&
            typeof pos.y === "number"
          ) {
            anchor = { x: pos.x, y: pos.y };
            break;
          }
        }
        const angle = Math.random() * 2 * Math.PI;
        const distance = 70 + Math.random() * 40;
        seed = {
          x: (anchor?.x ?? 0) + distance * Math.cos(angle),
          y: (anchor?.y ?? 0) + distance * Math.sin(angle),
        };
      }
      seedPositionsRef.current.set(node.id, seed);
      return seed;
    },
    [adjacency, nodeIndex],
  );

  /** Create-or-update the cached beneath-node label element for a node. */
  const labelElementFor = useCallback(
    (node: GraphNode, dimmed: boolean): HTMLDivElement => {
      let holder = labelElementsRef.current.get(node.id);
      let label: HTMLDivElement;
      if (!holder) {
        holder = document.createElement("div");
        holder.style.cssText =
          "position:relative;width:100%;height:100%;pointer-events:none;";
        label = document.createElement("div");
        label.style.cssText =
          "position:absolute;top:100%;left:50%;transform:translateX(-50%);" +
          "margin-top:3px;white-space:nowrap;text-align:center;" +
          "text-shadow:0 0 3px #FFFFFF,0 0 3px #FFFFFF,0 0 3px #FFFFFF;";
        label.style.fontFamily = LABEL_FONT;
        holder.appendChild(label);
        labelElementsRef.current.set(node.id, holder);
      } else {
        label = holder.firstChild as HTMLDivElement;
      }
      const isCompany = node.label === "Company";
      label.textContent = ellipsize(String(node.name ?? node.id));
      label.style.fontSize = isCompany ? "11.5px" : "9.5px";
      label.style.fontWeight = isCompany ? "500" : "400";
      label.style.color = isCompany ? "#111111" : "#787774";
      label.style.opacity = dimmed ? "0.25" : "1";
      return holder;
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /* GraphData -> NVL nodes / rels                                     */
  /* ---------------------------------------------------------------- */

  const nvlNodes = useMemo<NvlNode[]>(() => {
    void logoTick; /* logo settles retrigger this memo */
    void htmlTick; /* html-attach pass retriggers this memo */
    return visible.nodes.map((node) => {
      const id = node.id;
      const inHighlight = highlightNodes?.has(id) ?? false;
      const dimmed = highlightNodes
        ? !inHighlight
        : hoverHood
          ? !hoverHood.has(id)
          : false;
      const size = nodeRadius(node);
      /* html labels only after first send -- see the effect above. */
      const withHtml = sentNodeIdsRef.current.has(id);

      if (node.label === "Idea") {
        // Small subtle center anchor.
        const nvlNode: NvlNode = {
          id,
          size,
          color: IDEA_COLOR,
          selected: selectedId === id,
          disabled: dimmed,
        };
        if (withHtml) {
          nvlNode.html = labelElementFor(node, dimmed);
          const seed = seedPositionFor(node);
          nvlNode.x = seed.x;
          nvlNode.y = seed.y;
        }
        return nvlNode;
      }

      if (node.label === "Company") {
        const logoUrl = proxiedLogoUrl(node);
        const logoReady = logoUrl !== null && probeLogo(logoUrl) === "ready";
        const nvlNode: NvlNode = {
          id,
          size,
          // White disc under the logo (also keeps NVL from inverting the
          // icon, which it does over dark fills); brand-colored lettered
          // disc until the logo loads -- or forever if it never does.
          color: logoReady ? "#FFFFFF" : NODE_COLORS.Company,
          selected: selectedId === id,
          disabled: dimmed,
          overlayIcon: topPagerankId === id ? CROWN_OVERLAY : undefined,
        };
        if (logoReady && logoUrl) {
          nvlNode.icon = logoUrl;
        } else {
          const letter =
            String(node.name ?? "").trim().charAt(0).toUpperCase() || "?";
          nvlNode.caption = letter;
          nvlNode.captionAlign = "center";
        }
        if (withHtml) {
          nvlNode.html = labelElementFor(node, dimmed);
          const seed = seedPositionFor(node);
          nvlNode.x = seed.x;
          nvlNode.y = seed.y;
        }
        return nvlNode;
      }

      // Satellites (and highlight-disclosed panel-only nodes): small
      // type-colored discs with small gray labels beneath.
      const nvlNode: NvlNode = {
        id,
        size,
        color: NODE_COLORS[node.label] ?? "#9CA3AF",
        selected: selectedId === id,
        disabled: dimmed,
      };
      if (withHtml) {
        nvlNode.html = labelElementFor(node, dimmed);
        const seed = seedPositionFor(node);
        nvlNode.x = seed.x;
        nvlNode.y = seed.y;
      }
      return nvlNode;
    });
  }, [
    visible,
    hoverHood,
    highlightNodes,
    selectedId,
    topPagerankId,
    nodeRadius,
    labelElementFor,
    seedPositionFor,
    logoTick,
    htmlTick,
  ]);

  const nvlRels = useMemo<NvlRelationship[]>(() => {
    return visible.links.map((link) => {
      const key = linkKeyOf(link as GraphLink);
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      const isHighlighted = highlightLinks?.has(key) ?? false;
      const touchesHover = hoverId !== null && (s === hoverId || t === hoverId);
      const touchesExpanded = expanded.has(s) || expanded.has(t);

      let color = BASE_LINK_COLOR;
      let width = 1;
      if (highlightLinks) {
        color = isHighlighted ? HIGHLIGHT_LINK_COLOR : FADED_LINK_COLOR;
        width = isHighlighted ? 2.5 : 1;
      } else if (touchesHover) {
        color = HOVER_LINK_COLOR;
        width = 1.5;
      } else if (touchesExpanded) {
        color = EXPANDED_LINK_COLOR;
      }

      return { id: key, from: s, to: t, type: link.type, color, width };
    });
  }, [visible, highlightLinks, hoverId, expanded]);

  /* ---------------------------------------------------------------- */
  /* Interaction                                                       */
  /* ---------------------------------------------------------------- */

  /** True if the graph already holds fan-out neighbors for this company. */
  const hasSatelliteNeighbors = useCallback(
    (companyId: string) => {
      for (const neighborId of adjacency.get(companyId) ?? []) {
        const neighbor = nodeIndex.get(neighborId);
        if (neighbor && SATELLITE_LABELS.has(neighbor.label)) return true;
      }
      return false;
    },
    [adjacency, nodeIndex],
  );

  /* One click does both: expand/collapse (companies) + select (panel). */
  const handleNodeClick = useCallback(
    (nvlNode: NvlNode) => {
      const node = nodeIndex.get(String(nvlNode.id));
      if (!node) return;
      if (node.label === "Company") {
        const wasExpanded = expanded.has(node.id);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        // Live sessions may not have streamed this company's satellites
        // yet -- ask the parent to fetch its 1-hop neighborhood.
        if (!wasExpanded && !hasSatelliteNeighbors(node.id)) onExpand(node);
      }
      onSelect(node);
    },
    [nodeIndex, expanded, hasSatelliteNeighbors, onExpand, onSelect],
  );

  const mouseEventCallbacks = useMemo<MouseEventCallbacks>(
    () => ({
      onNodeClick: handleNodeClick,
      onCanvasClick: () => {
        onSelect(null);
      },
      onHover: (element: NvlNode | NvlRelationship | undefined) => {
        const id = element && !("from" in element) ? String(element.id) : null;
        setHoverId((prev) => (prev === id ? prev : id));
        if (containerRef.current) {
          containerRef.current.style.cursor = id ? "pointer" : "default";
        }
      },
      onDragStart: true,
      onDrag: true,
      onDragEnd: true,
      // User pan/zoom takes over the viewport: streaming auto-fit stops.
      onPan: () => {
        userNavigatedRef.current = true;
      },
      onZoom: () => {
        userNavigatedRef.current = true;
      },
    }),
    [handleNodeClick, onSelect],
  );

  /* ---------------------------------------------------------------- */
  /* Framing (zoom-to-fit)                                             */
  /* ---------------------------------------------------------------- */

  const visibleIdsRef = useRef<string[]>([]);
  useEffect(() => {
    visibleIdsRef.current = visible.nodes.map((node) => node.id);
  }, [visible]);

  const fitVisible = useCallback(() => {
    const ids = visibleIdsRef.current;
    if (ids.length === 0) return;
    try {
      nvlRef.current?.fit(ids, { animated: true });
    } catch {
      /* fit on a mid-update scene can throw; framing is best-effort */
    }
  }, []);

  /* Streaming: frame the landscape whenever the layout settles, until the
     user takes over the viewport. */
  const fitToGraphAuto = useCallback(() => {
    if (userNavigatedRef.current) return;
    fitVisible();
  }, [fitVisible]);
  const nvlCallbacks = useMemo(
    () => ({ onLayoutDone: fitToGraphAuto }),
    [fitToGraphAuto],
  );

  /* One extra corrective frame shortly after the stream finishes. */
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(fitToGraphAuto, 800);
    return () => clearTimeout(timer);
  }, [status, fitToGraphAuto]);

  /* Re-frame after each expand/collapse -- an explicit interaction, so it
     runs even after user navigation (highlight framing wins below). */
  const highlightRef = useRef(highlight);
  useEffect(() => {
    highlightRef.current = highlight;
  }, [highlight]);
  const expandFitSkipRef = useRef(true);
  useEffect(() => {
    if (expandFitSkipRef.current) {
      expandFitSkipRef.current = false;
      return;
    }
    if (highlightRef.current) return;
    const timer = setTimeout(fitVisible, 450);
    return () => clearTimeout(timer);
  }, [expanded, fitVisible]);

  /* Insight highlight: auto-expand the companies on the path so every
     highlighted node is visible, then frame the highlighted subset. */
  useEffect(() => {
    if (!highlight) return;
    const companies = new Set<string>();
    for (const id of highlight.nodeIds) {
      const node = nodeIndex.get(id);
      if (!node) continue;
      if (node.label === "Company") {
        companies.add(id);
        continue;
      }
      for (const neighborId of adjacency.get(id) ?? []) {
        if (nodeIndex.get(neighborId)?.label === "Company") {
          companies.add(neighborId);
        }
      }
    }
    if (companies.size > 0) {
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of companies) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    const ids = highlight.nodeIds.filter((id) => nodeIndex.has(id));
    if (ids.length === 0) return;
    const timer = setTimeout(() => {
      try {
        nvlRef.current?.fit(ids, { animated: true });
      } catch {
        /* best-effort framing */
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [highlight, nodeIndex, adjacency]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const ready = Wrapper !== null;
  const empty =
    data.nodes.length === 0 && (status === "done" || status === "error");
  const waiting =
    data.nodes.length === 0 &&
    (status === "connecting" || status === "streaming");

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-canvas"
    >
      {ready && Wrapper && visible.nodes.length > 0 && (
        <Wrapper
          ref={nvlRef}
          nodes={nvlNodes}
          rels={nvlRels}
          layout="forceDirected"
          nvlOptions={{
            // Canvas renderer: captions and html overlays only work on
            // 'canvas', and the minimalist flat look matches the design
            // system better than the WebGL default.
            renderer: "canvas",
            initialZoom: 0.75,
            minZoom: 0.15,
            maxZoom: 6,
            relationshipThreshold: 0.3,
            disableTelemetry: true,
            // ROOT-CAUSE FIX: for graphs <= 100 nodes NVL's forceDirected
            // layout silently hands off to its CoseBilkent web worker,
            // which never returns positions in this bundling -- every node
            // then freezes at its initial near-origin seed (the all-nodes-
            // at-one-point bug). Disabling the cytoscape handoff keeps the
            // WebGL physics layout, which demonstrably works here.
            layoutOptions: { enableCytoscape: false },
            styling: {
              nodeDefaultBorderColor: "#EAEAEA",
              selectedBorderColor: "#111111",
              selectedInnerBorderColor: "#FFFFFF",
              disabledItemColor: DIMMED_COLOR,
              disabledItemFontColor: "#C4C1BB",
              dropShadowColor: "rgba(0,0,0,0)",
            },
          }}
          mouseEventCallbacks={mouseEventCallbacks}
          nvlCallbacks={nvlCallbacks}
          style={{ width: "100%", height: "100%" }}
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
