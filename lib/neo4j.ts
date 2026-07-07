/**
 * Neo4j driver singleton + query helpers.
 *
 * - Module-scoped driver singleton (neo4j+s:// Aura URI), verifyConnectivity
 *   on first use.
 * - Aura Free: NO gds.* procedures. Algorithms run client-side
 *   (lib/algorithms.ts).
 * - DEMO MODE (!hasNeo4j()): read paths serve fixtures/demo-graph.json,
 *   writes become no-ops, so the app runs end-to-end with zero credentials.
 */

import neo4j from "neo4j-driver";
import type { Driver } from "neo4j-driver";
import { env, hasNeo4j } from "@/lib/env";
import type { GraphNode, GraphLink, InsightCard, NodeLabel, RelationshipType } from "@/lib/types";
import demoGraphJson from "@/fixtures/demo-graph.json";

/* ------------------------------------------------------------------ */
/* Demo fixture access                                                 */
/* ------------------------------------------------------------------ */

export interface DemoGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  insights: InsightCard[];
}

/**
 * Fresh copies of the fixture graph (react-force-graph mutates node
 * objects, so every caller gets its own references).
 */
export function getDemoGraph(): DemoGraph {
  const raw = demoGraphJson as unknown as DemoGraph;
  return {
    nodes: raw.nodes.map((n) => ({ ...n })),
    links: raw.links.map((l) => ({ ...l })),
    insights: raw.insights,
  };
}

/* ------------------------------------------------------------------ */
/* Driver singleton                                                    */
/* ------------------------------------------------------------------ */

let driver: Driver | null = null;
let connectivityVerified = false;

/** Lazily create (or return) the singleton driver. Throws if !hasNeo4j(). */
export function getDriver(): Driver {
  if (!hasNeo4j()) {
    throw new Error(
      "Neo4j credentials missing — demo mode is active; reads are served from fixtures. " +
        "Set NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD for a live graph.",
    );
  }
  if (!driver) {
    driver = neo4j.driver(
      env.NEO4J_URI as string,
      neo4j.auth.basic(env.NEO4J_USERNAME as string, env.NEO4J_PASSWORD as string),
    );
  }
  return driver;
}

async function ensureConnectivity(): Promise<void> {
  if (connectivityVerified) return;
  await getDriver().verifyConnectivity({ database: "neo4j" });
  connectivityVerified = true;
}

/** Close the singleton driver (scripts/tests only). */
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    connectivityVerified = false;
  }
}

/* ------------------------------------------------------------------ */
/* Value conversion (neo4j Integer -> number, recursively)             */
/* ------------------------------------------------------------------ */

function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (neo4j.isInt(value)) {
    const int = value as { inSafeRange(): boolean; toNumber(): number; toString(): string };
    return int.inSafeRange() ? int.toNumber() : int.toString();
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toPlain(v)]),
      );
    }
    // Node/Relationship/temporal objects: queries below always use map
    // projections, so these should not appear; stringify as a fallback.
    return String(value);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Query helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Run a read-only Cypher query. Returns plain record objects (neo4j
 * Integers converted to JS numbers). In demo mode returns [] — demo
 * reads for the UI go through fetchGraph/fetchNeighborhood/getDemoGraph.
 */
export async function runRead<T = Record<string, unknown>>(
  cypher: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  if (!hasNeo4j()) {
    if (env.DEBUG) console.warn("[neo4j] demo mode: runRead -> [] for:", cypher.slice(0, 120));
    return [];
  }
  await ensureConnectivity();
  const result = await getDriver().executeQuery(cypher, params ?? {}, {
    database: "neo4j",
    routing: neo4j.routing.READ,
  });
  return result.records.map((r) => toPlain(r.toObject()) as T);
}

/**
 * Run a write Cypher query (parameterized only — never concatenated).
 * In demo mode this is a no-op returning [].
 */
export async function runWrite<T = Record<string, unknown>>(
  cypher: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  if (!hasNeo4j()) {
    if (env.DEBUG) console.warn("[neo4j] demo mode: runWrite no-op for:", cypher.slice(0, 120));
    return [];
  }
  await ensureConnectivity();
  const result = await getDriver().executeQuery(cypher, params ?? {}, {
    database: "neo4j",
    routing: neo4j.routing.WRITE,
  });
  return result.records.map((r) => toPlain(r.toObject()) as T);
}

/* ------------------------------------------------------------------ */
/* Schema string for the text2Cypher agent prompt                      */
/* ------------------------------------------------------------------ */

const STATIC_SCHEMA = `Node labels and key properties:
(:Idea {id, session_id, text, refined_tags})
(:Company {id, name, url, description, stage, founded_year, hq, status, community, pagerank})
(:Founder {id, name, linkedin_url, background_summary})
(:Investor {id, name, type, notable})
(:Feature {id, name, category, description})
(:LaunchEvent {id, event_id, title, date, url})
(:Segment {id, name})
(:Source {id, url, type, fetched_at})
(:FundingRound {id, round_id, round_type, amount_usd, announced_date})
(:WebsiteSnapshot {id, snapshot_id, url, captured_at, positioning_summary})
(:Post {id, title, url, platform, posted_at})
(:MoatClaim {id, claim_id, type, summary, confidence})
(:TractionSignal {id, signal_id, metric, value, observed_at})

Relationships:
(:Company)-[:COMPETES_IN {confidence}]->(:Segment)
(:Founder)-[:FOUNDED {year, role}]->(:Company)
(:Founder)-[:WORKED_AT {years, role}]->(:Company)
(:Investor)-[:INVESTED_IN {round, year, lead}]->(:Company)
(:Company)-[:HAS_FEATURE {first_seen}]->(:Feature)
(:Company)-[:SHIPPED]->(:LaunchEvent)
(:LaunchEvent)-[:SHIPPED_AFTER {lag_days}]->(:LaunchEvent)
(:Company)-[:TARGETS]->(:Segment)
(:Company)-[:RELEVANT_TO {relevance_score}]->(:Idea)
(:LaunchEvent)-[:CITED_BY]->(:Source)
(:Company)-[:RAISED]->(:FundingRound)
(:Investor)-[:PARTICIPATED_IN {lead}]->(:FundingRound)
(:Company)-[:HAD_SNAPSHOT]->(:WebsiteSnapshot)
(:WebsiteSnapshot)-[:NEXT_SNAPSHOT {messaging_changed}]->(:WebsiteSnapshot)
(:Founder)-[:POSTED]->(:Post)
(:Post)-[:ABOUT]->(:Company)
(:Company)-[:CLAIMS_MOAT]->(:MoatClaim)
(:MoatClaim)-[:EVIDENCED_BY]->(:Source)
(:Company)-[:HAS_TRACTION]->(:TractionSignal)

Every non-Idea, non-Source node also has a [:CITED_BY]->(:Source) provenance edge.
All nodes carry a unique string property "id" (e.g. "company:handshake").`;

let cachedSchema: string | null = null;

/**
 * Serialized schema for the agent prompt; cached. Static contract schema,
 * augmented with live db.schema.visualization() triples when connected.
 */
export async function getSchemaString(): Promise<string> {
  if (cachedSchema) return cachedSchema;
  if (!hasNeo4j()) {
    cachedSchema = STATIC_SCHEMA;
    return cachedSchema;
  }
  try {
    const rows = await runRead<{ triples: string[] }>(
      `CALL db.schema.visualization() YIELD nodes, relationships
       UNWIND relationships AS rel
       WITH collect(DISTINCT
         "(:" + labels(startNode(rel))[0] + ")-[:" + type(rel) + "]->(:" + labels(endNode(rel))[0] + ")"
       ) AS triples
       RETURN triples`,
    );
    const live = rows[0]?.triples ?? [];
    cachedSchema =
      STATIC_SCHEMA + (live.length ? `\n\nLive schema triples:\n${live.join("\n")}` : "");
  } catch {
    cachedSchema = STATIC_SCHEMA;
  }
  return cachedSchema;
}

/* ------------------------------------------------------------------ */
/* Graph reads in react-force-graph shape                              */
/* ------------------------------------------------------------------ */

interface NodeRow {
  props: Record<string, unknown>;
  label: string;
}

interface LinkRow {
  source: string;
  target: string;
  type: string;
  props: Record<string, unknown>;
}

function rowToGraphNode(row: NodeRow): GraphNode {
  const props = row.props;
  return {
    ...props,
    id: String(props.id ?? props.name ?? props.url ?? ""),
    label: row.label as NodeLabel,
    name: String(props.name ?? props.title ?? props.url ?? props.id ?? ""),
  };
}

function rowToGraphLink(row: LinkRow): GraphLink {
  return {
    source: row.source,
    target: row.target,
    type: row.type as RelationshipType,
    props:
      row.props && Object.keys(row.props).length > 0
        ? (row.props as GraphLink["props"])
        : undefined,
  };
}

/**
 * Fetch the full session graph in react-force-graph shape. Source nodes
 * are excluded from the viz (each entity carries its source_url property).
 * In demo mode this returns the fixture graph.
 *
 * Note: the hackathon build keeps one graph per database, so sessionId is
 * currently not used as a filter.
 */
export async function fetchGraph(
  _sessionId: string,
): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  if (!hasNeo4j()) {
    const { nodes, links } = getDemoGraph();
    return { nodes, links };
  }
  const nodeRows = await runRead<NodeRow>(
    `MATCH (n) WHERE NOT n:Source
     RETURN n{.*} AS props, labels(n)[0] AS label`,
  );
  const linkRows = await runRead<LinkRow>(
    `MATCH (a)-[r]->(b)
     WHERE NOT a:Source AND NOT b:Source
     RETURN a.id AS source, b.id AS target, type(r) AS type, properties(r) AS props`,
  );
  return {
    nodes: nodeRows.map(rowToGraphNode),
    links: linkRows.filter((l) => l.source && l.target).map(rowToGraphLink),
  };
}

/** Fetch the 1-hop neighborhood of a node (click-to-expand). */
export async function fetchNeighborhood(
  nodeId: string,
): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  if (!hasNeo4j()) {
    const { nodes, links } = getDemoGraph();
    const hood = links.filter(
      (l) => l.source === nodeId || l.target === nodeId,
    );
    const ids = new Set<string>([nodeId]);
    for (const l of hood) {
      ids.add(l.source);
      ids.add(l.target);
    }
    return { nodes: nodes.filter((n) => ids.has(n.id)), links: hood };
  }
  const rows = await runRead<{
    nProps: Record<string, unknown>;
    nLabel: string;
    mProps: Record<string, unknown>;
    mLabel: string;
    relType: string;
    relProps: Record<string, unknown>;
    source: string;
    target: string;
  }>(
    `MATCH (n {id: $id})-[r]-(m)
     WHERE NOT m:Source
     RETURN n{.*} AS nProps, labels(n)[0] AS nLabel,
            m{.*} AS mProps, labels(m)[0] AS mLabel,
            type(r) AS relType, properties(r) AS relProps,
            startNode(r).id AS source, endNode(r).id AS target`,
    { id: nodeId },
  );
  const nodesById = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  for (const row of rows) {
    const n = rowToGraphNode({ props: row.nProps, label: row.nLabel });
    const m = rowToGraphNode({ props: row.mProps, label: row.mLabel });
    nodesById.set(n.id, n);
    nodesById.set(m.id, m);
    links.push(
      rowToGraphLink({
        source: row.source,
        target: row.target,
        type: row.relType,
        props: row.relProps,
      }),
    );
  }
  return { nodes: [...nodesById.values()], links };
}
