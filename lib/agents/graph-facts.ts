/**
 * Deterministic fact extraction over a session graph. Shared by the
 * text2cypher demo path, the insight cards, and the report digest.
 * No LLM calls in this file — facts are computed, never generated.
 */

import demoGraphJson from "@/fixtures/demo-graph.json";
import type { GraphNode, GraphLink, InsightCard } from "@/lib/types";
import { linkKey } from "@/lib/types";
import { isDemoMode } from "@/lib/env";
import { fetchGraph } from "@/lib/neo4j";

export interface SessionGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface FixtureGraph extends SessionGraph {
  insights: InsightCard[];
}

const fixture = demoGraphJson as unknown as FixtureGraph;

export function getFixtureGraph(): FixtureGraph {
  return fixture;
}

/**
 * The graph for a session: live Neo4j when configured, fixture otherwise.
 * Falls back to the fixture if the live read fails (demo insurance).
 */
export async function getSessionGraph(sessionId: string): Promise<SessionGraph> {
  if (!isDemoMode()) {
    try {
      return await fetchGraph(sessionId);
    } catch {
      // fall through to fixture
    }
  }
  return { nodes: fixture.nodes, links: fixture.links };
}

function byId(graph: SessionGraph): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  for (const n of graph.nodes) map.set(n.id, n);
  return map;
}

export function highlightFor(
  nodes: GraphNode[],
  links: GraphLink[],
): { nodeIds: string[]; linkKeys: string[] } {
  return {
    nodeIds: nodes.map((n) => n.id),
    linkKeys: links.map((l) => linkKey(l)),
  };
}

/* ------------------------------------------------------------------ */
/* Fact queries                                                        */
/* ------------------------------------------------------------------ */

export interface SharedInvestorFact {
  investor: GraphNode;
  companies: GraphNode[];
  links: GraphLink[];
}

/** Investors holding positions in two or more companies in this graph. */
export function sharedInvestors(graph: SessionGraph): SharedInvestorFact[] {
  const nodes = byId(graph);
  const perInvestor = new Map<string, GraphLink[]>();
  for (const l of graph.links) {
    if (l.type !== "INVESTED_IN") continue;
    const list = perInvestor.get(l.source) ?? [];
    list.push(l);
    perInvestor.set(l.source, list);
  }
  const facts: SharedInvestorFact[] = [];
  for (const [investorId, links] of perInvestor) {
    if (links.length < 2) continue;
    const investor = nodes.get(investorId);
    if (!investor) continue;
    const companies = links
      .map((l) => nodes.get(l.target))
      .filter((n): n is GraphNode => Boolean(n));
    facts.push({ investor, companies, links });
  }
  facts.sort((a, b) => b.companies.length - a.companies.length);
  return facts;
}

/** Segments with zero COMPETES_IN edges pointing at them: the white space. */
export function whiteSpaceSegments(graph: SessionGraph): GraphNode[] {
  const contested = new Set(
    graph.links.filter((l) => l.type === "COMPETES_IN").map((l) => l.target),
  );
  return graph.nodes.filter(
    (n) => n.label === "Segment" && !contested.has(n.id),
  );
}

export interface TableStakesFact {
  feature: GraphNode;
  count: number;
  links: GraphLink[];
}

/** Features held by at least `threshold` companies. */
export function tableStakesFeatures(
  graph: SessionGraph,
  threshold = 4,
): TableStakesFact[] {
  const nodes = byId(graph);
  const perFeature = new Map<string, GraphLink[]>();
  for (const l of graph.links) {
    if (l.type !== "HAS_FEATURE") continue;
    const list = perFeature.get(l.target) ?? [];
    list.push(l);
    perFeature.set(l.target, list);
  }
  const facts: TableStakesFact[] = [];
  for (const [featureId, links] of perFeature) {
    if (links.length < threshold) continue;
    const feature = nodes.get(featureId);
    if (!feature) continue;
    facts.push({ feature, count: links.length, links });
  }
  facts.sort((a, b) => b.count - a.count);
  return facts;
}

/** The company with the highest PageRank — the node everyone positions against. */
export function bossNode(graph: SessionGraph): GraphNode | undefined {
  return graph.nodes
    .filter((n) => n.label === "Company" && typeof n.pagerank === "number")
    .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))[0];
}

export interface LineageFact {
  origin: GraphNode;
  founders: GraphNode[];
  links: GraphLink[];
}

/** Prior employers shared by two or more founders in this graph. */
export function founderLineage(graph: SessionGraph): LineageFact[] {
  const nodes = byId(graph);
  const perOrigin = new Map<string, GraphLink[]>();
  for (const l of graph.links) {
    if (l.type !== "WORKED_AT") continue;
    const list = perOrigin.get(l.target) ?? [];
    list.push(l);
    perOrigin.set(l.target, list);
  }
  const facts: LineageFact[] = [];
  for (const [originId, links] of perOrigin) {
    if (links.length < 2) continue;
    const origin = nodes.get(originId);
    if (!origin) continue;
    const founders = links
      .map((l) => nodes.get(l.source))
      .filter((n): n is GraphNode => Boolean(n));
    facts.push({ origin, founders, links });
  }
  facts.sort((a, b) => b.founders.length - a.founders.length);
  return facts;
}

export interface MoatFact {
  claim: GraphNode;
  company?: GraphNode;
  links: GraphLink[];
}

/** MoatClaim nodes plus the company that claims them. */
export function moatClaims(graph: SessionGraph): MoatFact[] {
  const nodes = byId(graph);
  return graph.nodes
    .filter((n) => n.label === "MoatClaim")
    .map((claim) => {
      const links = graph.links.filter(
        (l) => l.type === "CLAIMS_MOAT" && l.target === claim.id,
      );
      const company = links[0] ? nodes.get(links[0].source) : undefined;
      return { claim, company, links };
    });
}

/** Company names grouped by Louvain community index. */
export function companiesByCommunity(
  graph: SessionGraph,
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const n of graph.nodes) {
    if (n.label !== "Company") continue;
    const key = String(n.community ?? "unassigned");
    (groups[key] ??= []).push(n.name);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Record-to-graph matching (for lighting up paths after a Cypher run) */
/* ------------------------------------------------------------------ */

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
}

/**
 * Map query result records back onto graph nodes by name/id so the UI can
 * highlight the path that produced the answer. Heuristic and best-effort.
 */
export function matchRecordsToGraph(
  records: Array<Record<string, unknown>>,
  graph: SessionGraph,
): { nodeIds: string[]; linkKeys: string[] } {
  const strings: string[] = [];
  collectStrings(records, strings);
  const wanted = new Set(strings.map((s) => s.toLowerCase()));

  const matched = graph.nodes.filter(
    (n) =>
      wanted.has(n.id.toLowerCase()) ||
      wanted.has(String(n.name ?? "").toLowerCase()),
  );
  const ids = new Set(matched.map((n) => n.id));
  const links = graph.links.filter(
    (l) => ids.has(l.source) && ids.has(l.target),
  );
  return {
    nodeIds: [...ids].slice(0, 40),
    linkKeys: links.slice(0, 60).map((l) => linkKey(l)),
  };
}
