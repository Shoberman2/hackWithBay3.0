/**
 * Pipeline conductor: expand -> discover -> extract -> dedupe -> write ->
 * insight, yielding PipelineEvents for the SSE route.
 *
 * - Extraction runs in batches of 5 docs so entities stream instead of
 *   dumping at the end.
 * - LLM stages go through RocketRide (lib/rocketride.ts) / the Butterbase
 *   gateway (lib/gateway.ts) — never raw provider keys. When RocketRide is
 *   unavailable the event stream notes that extraction ran locally.
 * - Demo mode: stream fixtures/demo-graph.json progressively (nodes in
 *   dependency order, 120ms apart, then insight cards) with the identical
 *   event shape — the on-stage graph always assembles, credentials or not.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { env, isDemoMode } from "@/lib/env";
import type {
  ExtractedBatch,
  GraphLink,
  GraphNode,
  InsightCard,
  NodeLabel,
  PipelineEvent,
  RawDoc,
  RelationshipType,
} from "@/lib/types";
import { linkKey } from "@/lib/types";
import { runExtraction, usesRemoteExtraction, expandQuery } from "@/lib/rocketride";
import { emptyBatch } from "@/lib/pipeline/extract";
import { dedupeBatch, emptyExisting, absorbBatch } from "@/lib/pipeline/dedupe";
import { writeEntities } from "@/lib/pipeline/write";
import { fetchAllSources } from "@/lib/sources";
import {
  assignGraphMetrics,
  writeMetricsBack,
  deriveInsights,
} from "@/lib/algorithms";

function debug(...args: unknown[]): void {
  if (env.DEBUG) console.error("[conductor]", ...args);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Fixture loading (demo insurance + fixture-backed API routes)        */
/* ------------------------------------------------------------------ */

export interface DemoGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  insights: InsightCard[];
}

let demoGraphCache: DemoGraph | undefined;

/** Load (and cache) fixtures/demo-graph.json. */
export function loadDemoGraph(): DemoGraph {
  if (!demoGraphCache) {
    const file = path.join(process.cwd(), "fixtures", "demo-graph.json");
    demoGraphCache = JSON.parse(readFileSync(file, "utf8")) as DemoGraph;
  }
  return demoGraphCache;
}

/* ------------------------------------------------------------------ */
/* ExtractedBatch -> GraphNode/GraphLink conversion                    */
/* ------------------------------------------------------------------ */

const ID_PREFIX: Record<NodeLabel, string> = {
  Idea: "idea",
  Company: "company",
  Founder: "founder",
  Investor: "investor",
  Feature: "feature",
  LaunchEvent: "launch",
  Segment: "segment",
  Source: "source",
  FundingRound: "round",
  WebsiteSnapshot: "snapshot",
  Post: "post",
  MoatClaim: "moat",
  TractionSignal: "traction",
};

/** [fromLabel, toLabel] per relationship type (README section 4). */
const REL_ENDPOINTS: Record<RelationshipType, [NodeLabel, NodeLabel]> = {
  COMPETES_IN: ["Company", "Segment"],
  FOUNDED: ["Founder", "Company"],
  WORKED_AT: ["Founder", "Company"],
  INVESTED_IN: ["Investor", "Company"],
  HAS_FEATURE: ["Company", "Feature"],
  SHIPPED: ["Company", "LaunchEvent"],
  SHIPPED_AFTER: ["LaunchEvent", "LaunchEvent"],
  TARGETS: ["Company", "Segment"],
  RELEVANT_TO: ["Company", "Idea"],
  CITED_BY: ["LaunchEvent", "Source"],
  RAISED: ["Company", "FundingRound"],
  PARTICIPATED_IN: ["Investor", "FundingRound"],
  HAD_SNAPSHOT: ["Company", "WebsiteSnapshot"],
  NEXT_SNAPSHOT: ["WebsiteSnapshot", "WebsiteSnapshot"],
  POSTED: ["Founder", "Post"],
  ABOUT: ["Post", "Company"],
  CLAIMS_MOAT: ["Company", "MoatClaim"],
  EVIDENCED_BY: ["MoatClaim", "Source"],
  HAS_TRACTION: ["Company", "TractionSignal"],
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

export function nodeId(label: NodeLabel, naturalKey: string): string {
  return `${ID_PREFIX[label]}:${slugify(naturalKey)}`;
}

/**
 * Company favicon via Google's favicon service, derived from the company
 * website host. Returns undefined when no usable host can be determined --
 * the graph renderer falls back to its lettered disc, never a broken image.
 */
export function companyLogoUrl(website?: string): string | undefined {
  if (!website) return undefined;
  let host: string;
  try {
    host = new URL(
      /^https?:\/\//i.test(website) ? website : `https://${website}`,
    ).hostname;
  } catch {
    return undefined;
  }
  host = host.replace(/^www\./i, "");
  if (!host || !host.includes(".")) return undefined;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

/**
 * Convert a validated ExtractedBatch to graph-view shapes.
 * Source nodes are not streamed (provenance lives on source_url props and
 * in the writer's Source/CITED_BY handling), so CITED_BY/EVIDENCED_BY
 * links are skipped here.
 */
export function batchToGraph(
  batch: ExtractedBatch,
  ideaNodeId: string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const push = (label: NodeLabel, key: string, name: string, props: object) => {
    nodes.push({ ...props, id: nodeId(label, key), label, name });
  };

  for (const c of batch.companies) {
    const logo_url = companyLogoUrl(c.url);
    push("Company", c.name, c.name, logo_url ? { ...c, logo_url } : c);
  }
  for (const f of batch.founders) push("Founder", f.name, f.name, f);
  for (const i of batch.investors) push("Investor", i.name, i.name, i);
  for (const f of batch.features) push("Feature", f.name, f.name, f);
  for (const s of batch.segments) push("Segment", s.name, s.name, s);
  for (const l of batch.launches) push("LaunchEvent", l.event_id, l.title, l);
  for (const r of batch.funding_rounds)
    push("FundingRound", r.round_id, r.round_type, r);
  for (const s of batch.snapshots)
    push("WebsiteSnapshot", s.snapshot_id, `${s.url} (${s.captured_at})`, s);
  for (const p of batch.posts) push("Post", p.url, p.title, p);
  for (const m of batch.moat_claims) push("MoatClaim", m.claim_id, m.type, m);
  for (const t of batch.traction_signals)
    push("TractionSignal", t.signal_id, t.metric, t);

  const nodeIds = new Set(nodes.map((n) => n.id));
  nodeIds.add(ideaNodeId);

  const links: GraphLink[] = [];
  for (const rel of batch.relationships) {
    const endpoints = REL_ENDPOINTS[rel.type];
    if (!endpoints) continue;
    const [fromLabel, toLabel] = endpoints;
    if (fromLabel === "Source" || toLabel === "Source") continue;
    const source = nodeId(fromLabel, rel.from);
    const target = toLabel === "Idea" ? ideaNodeId : nodeId(toLabel, rel.to);
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    links.push({ source, target, type: rel.type, props: rel.props });
  }

  return { nodes, links };
}

/* ------------------------------------------------------------------ */
/* Demo pipeline (fixture-backed stream)                               */
/* ------------------------------------------------------------------ */

/** Dependency order: referenced labels stream before their dependents. */
const DEMO_LABEL_ORDER: NodeLabel[] = [
  "Idea",
  "Company",
  "Founder",
  "Investor",
  "Segment",
  "Feature",
  "FundingRound",
  "LaunchEvent",
  "WebsiteSnapshot",
  "Post",
  "MoatClaim",
  "TractionSignal",
];

const DEMO_NODE_DELAY_MS = 120;
const DEMO_INSIGHT_DELAY_MS = 450;

/** Fixture-backed stream (demo insurance; also the DEMO_MODE path). */
export async function* runDemoPipeline(
  _sessionId: string,
): AsyncGenerator<PipelineEvent> {
  const graph = loadDemoGraph();

  yield {
    type: "status",
    stage: "expand",
    message: "Refining the idea into search queries",
  };
  await sleep(400);
  yield {
    type: "status",
    stage: "discover",
    message: "Scanning HN, Product Hunt, YC directory, and the open web",
  };
  await sleep(600);
  yield {
    type: "status",
    stage: "extract",
    message: "Extracting companies, founders, investors, and features",
  };

  const order = new Map(DEMO_LABEL_ORDER.map((label, i) => [label, i]));
  const nodes = [...graph.nodes].sort(
    (a, b) => (order.get(a.label) ?? 99) - (order.get(b.label) ?? 99),
  );

  const emitted = new Set<string>();
  const pending = [...graph.links];
  for (const node of nodes) {
    emitted.add(node.id);
    const ready: GraphLink[] = [];
    for (let i = pending.length - 1; i >= 0; i--) {
      const link = pending[i];
      if (emitted.has(link.source) && emitted.has(link.target)) {
        ready.push(link);
        pending.splice(i, 1);
      }
    }
    yield { type: "entity", nodes: [node], links: ready.reverse() };
    await sleep(DEMO_NODE_DELAY_MS);
  }
  // Safety: any links not satisfied by ordering (should be none).
  if (pending.length > 0) {
    yield { type: "entity", nodes: [], links: pending };
  }

  yield {
    type: "status",
    stage: "insight",
    message: "Running community detection and centrality over the landscape",
  };
  await sleep(700);
  for (const card of graph.insights) {
    yield { type: "insight", card };
    await sleep(DEMO_INSIGHT_DELAY_MS);
  }

  yield { type: "done" };
}

/* ------------------------------------------------------------------ */
/* Live pipeline                                                       */
/* ------------------------------------------------------------------ */

const EXTRACTION_BATCH_SIZE = 5;
/** Cap docs sent to extraction so the graph assembles responsively for
 *  any idea (each batch is one sequential LLM call). Discovery may return
 *  many more; the highest-signal ones are kept. */
const MAX_EXTRACTION_DOCS = 18;

/**
 * Run the full pipeline for a session, yielding PipelineEvents for the
 * SSE route. In demo mode (or when core services are unconfigured) this
 * streams the fixture graph with the identical event shape.
 */
export async function* runPipeline(
  idea: string,
  tags: string[],
  sessionId: string,
  searchTerms: string[] = [],
): AsyncGenerator<PipelineEvent> {
  if (isDemoMode()) {
    yield* runDemoPipeline(sessionId);
    return;
  }

  /* -------- expand -------- */
  yield {
    type: "status",
    stage: "expand",
    message: "Expanding the idea into search queries",
  };
  let terms = searchTerms.filter(Boolean);
  try {
    terms = await expandQuery({
      refined_idea: idea,
      tags,
      search_terms: terms,
    });
  } catch (err) {
    debug("expandQuery failed:", err);
    if (terms.length === 0) terms = [idea];
  }

  /* -------- discover -------- */
  yield {
    type: "status",
    stage: "discover",
    message: `Discovering the landscape across sources (${terms.length} queries)`,
  };
  let docs: Awaited<ReturnType<typeof fetchAllSources>> = [];
  try {
    docs = await fetchAllSources({ idea, searchTerms: terms, tags });
  } catch (err) {
    debug("fetchAllSources failed:", err);
  }
  if (docs.length === 0) {
    // No discoverable competitors for this idea (very niche, or a transient
    // source outage). Emit the idea node alone and finish honestly — NEVER
    // fall back to the internship demo fixture on a live, custom idea, or
    // the graph would show companies unrelated to what the user typed.
    yield {
      type: "entity",
      nodes: [
        {
          id: nodeId("Idea", sessionId),
          label: "Idea",
          name: idea,
          text: idea,
          session_id: sessionId,
          created_at: new Date().toISOString(),
          refined_tags: tags,
        },
      ],
      links: [],
    };
    yield {
      type: "status",
      stage: "discover",
      message:
        "No competitors surfaced for this idea yet — try broader or more specific search terms.",
    };
    yield { type: "done" };
    return;
  }
  // Keep the graph responsive for any idea: extraction is one sequential
  // LLM call per batch, so cap the doc set. Web search ("name the startups
  // competing in this space") and YC/news are the highest-signal sources
  // for real competitors; HN/PH keyword matches are the noisiest, so they
  // are trimmed first.
  if (docs.length > MAX_EXTRACTION_DOCS) {
    const rank = (t: string) =>
      t === "websearch" ? 0 : t === "YC" || t === "news" ? 1 : 2;
    docs = [...docs]
      .sort((a, b) => rank(a.source_type) - rank(b.source_type))
      .slice(0, MAX_EXTRACTION_DOCS);
  }

  /* -------- extract / dedupe / write (streaming batches) -------- */
  yield {
    type: "status",
    stage: "extract",
    message: usesRemoteExtraction()
      ? `Extracting entities from ${docs.length} documents on RocketRide Cloud`
      : `Extracting entities from ${docs.length} documents locally via the Butterbase gateway (RocketRide not configured)`,
  };

  const ideaNode: GraphNode = {
    id: nodeId("Idea", sessionId),
    label: "Idea",
    name: idea,
    text: idea,
    session_id: sessionId,
    created_at: new Date().toISOString(),
    refined_tags: tags,
  };
  yield { type: "entity", nodes: [ideaNode], links: [] };

  const existing = emptyExisting();
  const allNodes = new Map<string, GraphNode>([[ideaNode.id, ideaNode]]);
  const allLinks = new Map<string, GraphLink>();

  // Fire every batch's LLM extraction concurrently, then absorb+stream each
  // as it resolves. The extraction calls are independent, so this collapses
  // wall-clock time from sum-of-batches to slowest-single-batch. Dedupe and
  // graph-write still happen one batch at a time (in completion order) so
  // cross-batch dedup stays correct.
  const slices: RawDoc[][] = [];
  for (let i = 0; i < docs.length; i += EXTRACTION_BATCH_SIZE) {
    slices.push(docs.slice(i, i + EXTRACTION_BATCH_SIZE));
  }
  const pending = slices.map((slice) =>
    runExtraction(slice, idea, tags).catch((err) => {
      debug("batch extraction failed (continuing):", err);
      return emptyBatch();
    }),
  );
  let processed = 0;
  for (const batchPromise of pending) {
    const batch = await batchPromise;
    processed++;
    const deduped = dedupeBatch(batch, existing);
    absorbBatch(existing, deduped);

    try {
      await writeEntities(deduped);
    } catch (err) {
      debug("writeEntities failed (streaming continues):", err);
    }

    const { nodes, links } = batchToGraph(deduped, ideaNode.id);
    const newNodes = nodes.filter((n) => !allNodes.has(n.id));
    const newLinks = links.filter((l) => !allLinks.has(linkKey(l)));
    for (const n of newNodes) allNodes.set(n.id, n);
    for (const l of newLinks) allLinks.set(linkKey(l), l);
    if (newNodes.length > 0 || newLinks.length > 0) {
      yield { type: "entity", nodes: newNodes, links: newLinks };
    }
    yield {
      type: "status",
      stage: "extract",
      message: `Processed ${processed * EXTRACTION_BATCH_SIZE >= docs.length ? docs.length : processed * EXTRACTION_BATCH_SIZE} of ${docs.length} documents`,
    };
  }

  /* -------- insight pass -------- */
  yield {
    type: "status",
    stage: "insight",
    message: "Running community detection and centrality over the landscape",
  };
  const nodes = [...allNodes.values()];
  const links = [...allLinks.values()];
  let cards: InsightCard[] = [];
  try {
    assignGraphMetrics(nodes, links);
    // Re-send annotated nodes so the client can tint communities / scale
    // by pagerank (client merges by node id).
    yield { type: "entity", nodes, links: [] };
    try {
      await writeMetricsBack(nodes);
    } catch (err) {
      debug("writeMetricsBack failed:", err);
    }
    cards = deriveInsights(nodes, links);
  } catch (err) {
    debug("insight pass failed:", err);
  }
  for (const card of cards) {
    yield { type: "insight", card };
  }

  yield { type: "done" };
}
