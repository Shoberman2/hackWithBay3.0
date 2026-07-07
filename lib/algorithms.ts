/**
 * Client-side graph algorithms (graphology) — Aura Free has no GDS, so
 * NO gds.* procedures anywhere. Louvain runs over the Company-Feature-
 * Segment subgraph, PageRank + betweenness over the full graph, and the
 * scores are written back to Neo4j as node properties via UNWIND ... SET.
 *
 * DEMO MODE: runInsightPass returns values straight from the fixture.
 */

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank";
import betweenness from "graphology-metrics/centrality/betweenness";
import { env, hasNeo4j } from "@/lib/env";
import { fetchGraph, getDemoGraph, runWrite } from "@/lib/neo4j";
import { linkKey } from "@/lib/types";
import type { GraphLink, GraphNode, InsightCard } from "@/lib/types";

const COMMUNITY_SUBGRAPH_LABELS = new Set(["Company", "Feature", "Segment"]);
const COMMUNITY_SUBGRAPH_RELS = new Set(["HAS_FEATURE", "COMPETES_IN", "TARGETS"]);

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/**
 * Compute community / pagerank / betweenness over the given graph and
 * return the same node array with those properties assigned (mutates the
 * node references so react-force-graph keeps positions).
 */
export function assignGraphMetrics(
  nodes: GraphNode[],
  links: GraphLink[],
): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /* Louvain over the Company-Feature-Segment subgraph (undirected). */
  const sub = new Graph({ type: "undirected", multi: false });
  for (const n of nodes) {
    if (COMMUNITY_SUBGRAPH_LABELS.has(n.label)) sub.mergeNode(n.id);
  }
  for (const l of links) {
    if (COMMUNITY_SUBGRAPH_RELS.has(l.type) && sub.hasNode(l.source) && sub.hasNode(l.target)) {
      sub.mergeEdge(l.source, l.target);
    }
  }
  if (sub.size > 0) {
    louvain.assign(sub, { resolution: 1, nodeCommunityAttribute: "community" });
    sub.forEachNode((id, attrs) => {
      const node = byId.get(id);
      if (node) node.community = attrs.community as number;
    });
  }

  /* Propagate communities to the rest of the graph (few relaxation passes). */
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const l of links) {
      const a = byId.get(l.source);
      const b = byId.get(l.target);
      if (!a || !b) continue;
      if (a.community === undefined && b.community !== undefined) {
        a.community = b.community;
        changed = true;
      } else if (b.community === undefined && a.community !== undefined) {
        b.community = a.community;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const n of nodes) if (n.community === undefined) n.community = 0;

  /* PageRank + betweenness over the full directed graph. */
  const full = new Graph({ type: "directed", multi: false });
  for (const n of nodes) full.mergeNode(n.id);
  for (const l of links) {
    if (full.hasNode(l.source) && full.hasNode(l.target) && l.source !== l.target) {
      full.mergeEdge(l.source, l.target);
    }
  }
  if (full.order > 0) {
    pagerank.assign(full, { alpha: 0.85, getEdgeWeight: null, nodePagerankAttribute: "pagerank" });
    betweenness.assign(full, { normalized: true, nodeCentralityAttribute: "betweenness" });
    full.forEachNode((id, attrs) => {
      const node = byId.get(id);
      if (!node) return;
      node.pagerank = round4((attrs.pagerank as number) ?? 0);
      node.betweenness = round4((attrs.betweenness as number) ?? 0);
    });
  }

  return nodes;
}

/** Persist computed metrics back to Neo4j node properties. */
export async function writeMetricsBack(nodes: GraphNode[]): Promise<void> {
  if (!hasNeo4j()) {
    if (env.DEBUG) console.warn("[algorithms] demo mode: writeMetricsBack no-op");
    return;
  }
  const rows = nodes.map((n) => ({
    id: n.id,
    community: n.community ?? 0,
    pagerank: n.pagerank ?? 0,
    betweenness: (n.betweenness as number | undefined) ?? 0,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    await runWrite(
      `UNWIND $rows AS row
       MATCH (n {id: row.id})
       SET n.community = row.community,
           n.pagerank = row.pagerank,
           n.betweenness = row.betweenness`,
      { rows: rows.slice(i, i + 500) },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Insight cards                                                       */
/* ------------------------------------------------------------------ */

/**
 * Derive insight cards (investor collisions, white space, table stakes,
 * boss node, positioning drift, moats) from a metric-annotated graph.
 */
export function deriveInsights(
  nodes: GraphNode[],
  links: GraphLink[],
): InsightCard[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cards: InsightCard[] = [];
  const companies = nodes.filter((n) => n.label === "Company");

  /* investor-collision: one investor with edges into 2+ companies */
  const investedBy = new Map<string, GraphLink[]>();
  for (const l of links) {
    if (l.type !== "INVESTED_IN") continue;
    (investedBy.get(l.source) ?? investedBy.set(l.source, []).get(l.source))!.push(l);
  }
  const collisions = [...investedBy.entries()]
    .filter(([, ls]) => ls.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  if (collisions.length > 0) {
    const [investorId, ls] = collisions[0];
    const investor = byId.get(investorId);
    const names = ls.map((l) => byId.get(l.target)?.name ?? l.target);
    cards.push({
      kind: "investor-collision",
      title: `${investor?.name ?? investorId} backs ${ls.length} companies in this space`,
      body: `${investor?.name ?? investorId} holds positions in ${names.join(", ")}. A shared investor across direct competitors is consolidation pressure: expect warm intros in this space to route through the same partners, and expect at most one of these bets to be defended to the end.`,
      highlight: {
        nodeIds: [investorId, ...ls.map((l) => l.target)],
        linkKeys: ls.map((l) => linkKey(l)),
      },
    });
  }

  /* white-space: segments no company competes in */
  const competedSegments = new Set(
    links.filter((l) => l.type === "COMPETES_IN").map((l) => l.target),
  );
  const emptySegments = nodes.filter(
    (n) => n.label === "Segment" && !competedSegments.has(n.id),
  );
  if (emptySegments.length > 0) {
    const names = emptySegments.map((s) => s.name);
    cards.push({
      kind: "white-space",
      title: `White space: nobody competes in ${names.join(", ")}`,
      body: `${names.join(", ")} ${emptySegments.length === 1 ? "is a segment" : "are segments"} in this landscape with zero COMPETES_IN edges. Every mapped company clusters elsewhere. If your idea can credibly own ${names[0]}, you start without a direct incumbent.`,
      highlight: { nodeIds: emptySegments.map((s) => s.id), linkKeys: [] },
    });
  }

  /* table-stakes: features held by a large share of companies */
  const featureCount = new Map<string, GraphLink[]>();
  for (const l of links) {
    if (l.type !== "HAS_FEATURE") continue;
    (featureCount.get(l.target) ?? featureCount.set(l.target, []).get(l.target))!.push(l);
  }
  const threshold = Math.max(3, Math.ceil(companies.length * 0.3));
  const stakes = [...featureCount.entries()]
    .filter(([, ls]) => ls.length >= threshold)
    .sort((a, b) => b[1].length - a[1].length);
  if (stakes.length > 0) {
    const names = stakes.map(([id]) => byId.get(id)?.name ?? id);
    const stakeLinks = stakes.flatMap(([, ls]) => ls);
    cards.push({
      kind: "table-stakes",
      title: `Table stakes: ${names.join(", ")}`,
      body: `${names.join(", ")} appear${names.length === 1 ? "s" : ""} in ${threshold}+ competitors each. Treat these as the baseline users already expect, not as differentiation. Your pitch has to start one layer above them.`,
      highlight: {
        nodeIds: stakes.map(([id]) => id),
        linkKeys: stakeLinks.map((l) => linkKey(l)),
      },
    });
  }

  /* boss-node: highest-PageRank company */
  const boss = [...companies].sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))[0];
  if (boss && (boss.pagerank ?? 0) > 0) {
    const bossLinks = links.filter((l) => l.source === boss.id || l.target === boss.id);
    cards.push({
      kind: "boss-node",
      title: `${boss.name} is the company everyone is positioned against`,
      body: `${boss.name} carries the highest PageRank in the landscape (${boss.pagerank}). It is the most-connected node across investors, features, and segments — the default incumbent. Any positioning statement for this idea has to answer "why not ${boss.name}".`,
      highlight: {
        nodeIds: [boss.id],
        linkKeys: bossLinks.map((l) => linkKey(l)),
      },
    });
  }

  /* positioning-drift: NEXT_SNAPSHOT chains with messaging_changed */
  const drift = links.filter(
    (l) => l.type === "NEXT_SNAPSHOT" && l.props?.messaging_changed === true,
  );
  if (drift.length > 0) {
    const snapIds = new Set(drift.flatMap((l) => [l.source, l.target]));
    const ownerLinks = links.filter(
      (l) => l.type === "HAD_SNAPSHOT" && snapIds.has(l.target),
    );
    const owners = [...new Set(ownerLinks.map((l) => byId.get(l.source)?.name ?? l.source))];
    cards.push({
      kind: "positioning-drift",
      title: `${owners.join(", ")} changed positioning over time`,
      body: `Website snapshot history shows ${owners.join(", ")} rewrote their core messaging between captures. Positioning drift is a signal the original wedge did not hold — study what they moved away from before choosing yours.`,
      highlight: {
        nodeIds: [...snapIds, ...ownerLinks.map((l) => l.source)],
        linkKeys: [...drift, ...ownerLinks].map((l) => linkKey(l)),
      },
    });
  }

  /* moat: strongest claimed moat */
  const moatLinks = links.filter((l) => l.type === "CLAIMS_MOAT");
  if (moatLinks.length > 0) {
    const strongest = [...moatLinks].sort((a, b) => {
      const ca = (byId.get(a.target)?.confidence as number | undefined) ?? 0;
      const cb = (byId.get(b.target)?.confidence as number | undefined) ?? 0;
      return cb - ca;
    })[0];
    const claim = byId.get(strongest.target);
    const company = byId.get(strongest.source);
    if (claim && company) {
      cards.push({
        kind: "moat",
        title: `${company.name} claims a ${String(claim.type)} moat`,
        body: String(claim.summary ?? claim.name),
        highlight: {
          nodeIds: [company.id, claim.id],
          linkKeys: [linkKey(strongest)],
        },
      });
    }
  }

  return cards;
}

/* ------------------------------------------------------------------ */
/* Full insight pass                                                   */
/* ------------------------------------------------------------------ */

export interface InsightPassResult {
  /** Number of distinct communities found. */
  communities: number;
  /** Top nodes by PageRank (descending). */
  topPagerank: Array<{ id: string; name: string; label: string; pagerank: number }>;
  /** Derived insight cards for the UI. */
  insights: InsightCard[];
  /** Metric-annotated nodes (same refs the caller can stream). */
  nodes: GraphNode[];
}

function summarize(nodes: GraphNode[], insights: InsightCard[]): InsightPassResult {
  const communities = new Set(nodes.map((n) => n.community ?? 0)).size;
  const topPagerank = [...nodes]
    .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))
    .slice(0, 5)
    .map((n) => ({ id: n.id, name: n.name, label: n.label, pagerank: n.pagerank ?? 0 }));
  return { communities, topPagerank, insights, nodes };
}

/**
 * Pull the edge list from Neo4j, run Louvain / PageRank / betweenness
 * client-side, write scores back as node properties, and derive insight
 * cards. In DEMO MODE returns values straight from the fixture.
 */
export async function runInsightPass(sessionId: string): Promise<InsightPassResult> {
  if (env.DEMO_MODE || !hasNeo4j()) {
    const { nodes, insights } = getDemoGraph();
    return summarize(nodes, insights);
  }
  const { nodes, links } = await fetchGraph(sessionId);
  assignGraphMetrics(nodes, links);
  await writeMetricsBack(nodes);
  const insights = deriveInsights(nodes, links);
  return summarize(nodes, insights);
}
