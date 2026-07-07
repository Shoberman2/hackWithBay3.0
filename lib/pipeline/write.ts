/**
 * Batched graph writer: ExtractedBatch -> Neo4j via UNWIND ... MERGE.
 *
 * - Zod-validates the batch before writing; MERGE only, never CREATE.
 * - One UNWIND query per node label, one per relationship type, 500 rows
 *   per query. Idempotent — re-runs create no duplicates.
 * - Every entity row carries source_url; the writer always MERGEs the
 *   Source node and a CITED_BY provenance edge (no orphan facts,
 *   enforced here, not by convention).
 * - Relationship MERGE MATCHes both endpoints first; never MERGEs a full
 *   path pattern.
 * - Returns the written entities in react-force-graph shape so the
 *   conductor can stream them to the client without a re-read.
 * - Demo mode (!hasNeo4j()): skips the DB round-trips but still returns
 *   the graph-shaped result so the streaming path works without creds.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env, hasNeo4j } from "@/lib/env";
import { runWrite } from "@/lib/neo4j";
import type {
  ExtractedBatch,
  ExtractedRelationship,
  GraphLink,
  GraphNode,
  Idea,
  NodeLabel,
  RelationshipType,
} from "@/lib/types";

const BATCH_SIZE = 500;

/* ------------------------------------------------------------------ */
/* Zod validation (loose objects: extra props like id/community pass)  */
/* ------------------------------------------------------------------ */

const companySchema = z.looseObject({
  name: z.string().min(1),
  url: z.string().optional(),
  description: z.string().optional(),
  stage: z.string().optional(),
  founded_year: z.number().optional(),
  hq: z.string().optional(),
  status: z.enum(["active", "dead", "acquired"]).optional(),
  source_url: z.string().min(1),
});

const founderSchema = z.looseObject({
  name: z.string().min(1),
  linkedin_url: z.string().optional(),
  background_summary: z.string().optional(),
  source_url: z.string().min(1),
});

const investorSchema = z.looseObject({
  name: z.string().min(1),
  type: z.enum(["VC", "angel", "accelerator"]).optional(),
  notable: z.string().optional(),
  source_url: z.string().min(1),
});

const featureSchema = z.looseObject({
  name: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  source_url: z.string().min(1),
});

const launchSchema = z.looseObject({
  event_id: z.string().min(1),
  title: z.string().min(1),
  date: z.string().optional(),
  source: z.string().optional(),
  url: z.string().optional(),
  source_url: z.string().min(1),
});

const segmentSchema = z.looseObject({
  name: z.string().min(1),
  source_url: z.string().min(1),
});

const fundingRoundSchema = z.looseObject({
  round_id: z.string().min(1),
  round_type: z.string().min(1),
  amount_usd: z.number().optional(),
  announced_date: z.string().optional(),
  source_url: z.string().min(1),
});

const snapshotSchema = z.looseObject({
  snapshot_id: z.string().min(1),
  url: z.string().min(1),
  captured_at: z.string().min(1),
  positioning_summary: z.string().optional(),
  digest: z.string().optional(),
  source_url: z.string().min(1),
});

const postSchema = z.looseObject({
  title: z.string().min(1),
  url: z.string().min(1),
  platform: z.enum(["HN", "PH", "blog", "GitHub"]),
  posted_at: z.string().optional(),
  source_url: z.string().min(1),
});

const moatClaimSchema = z.looseObject({
  claim_id: z.string().min(1),
  type: z.enum(["network-effects", "data", "distribution", "brand", "switching-costs"]),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source_url: z.string().min(1),
});

const tractionSignalSchema = z.looseObject({
  signal_id: z.string().min(1),
  metric: z.enum(["users", "stars", "votes", "app_ratings", "web_rank"]),
  value: z.number(),
  observed_at: z.string().min(1),
  source_url: z.string().min(1),
});

const RELATIONSHIP_TYPES = [
  "COMPETES_IN", "FOUNDED", "WORKED_AT", "INVESTED_IN", "HAS_FEATURE",
  "SHIPPED", "SHIPPED_AFTER", "TARGETS", "RELEVANT_TO", "CITED_BY",
  "RAISED", "PARTICIPATED_IN", "HAD_SNAPSHOT", "NEXT_SNAPSHOT", "POSTED",
  "ABOUT", "CLAIMS_MOAT", "EVIDENCED_BY", "HAS_TRACTION",
] as const;

const relationshipSchema = z.looseObject({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(RELATIONSHIP_TYPES),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  source_url: z.string().min(1),
});

const batchSchema = z.object({
  companies: z.array(companySchema).default([]),
  founders: z.array(founderSchema).default([]),
  investors: z.array(investorSchema).default([]),
  features: z.array(featureSchema).default([]),
  launches: z.array(launchSchema).default([]),
  segments: z.array(segmentSchema).default([]),
  funding_rounds: z.array(fundingRoundSchema).default([]),
  snapshots: z.array(snapshotSchema).default([]),
  posts: z.array(postSchema).default([]),
  moat_claims: z.array(moatClaimSchema).default([]),
  traction_signals: z.array(tractionSignalSchema).default([]),
  relationships: z.array(relationshipSchema).default([]),
});

/* ------------------------------------------------------------------ */
/* Label / relationship specs                                          */
/* ------------------------------------------------------------------ */

type EntityRow = Record<string, unknown>;

interface LabelSpec {
  batchKey: keyof ExtractedBatch;
  label: NodeLabel;
  /** Node property used as the MERGE key (unique-constrained). */
  keyProp: string;
  /** id prefix matching fixtures/demo-graph.json conventions. */
  idPrefix: string;
  /** Value used to build the deterministic id slug. */
  idSource: (row: EntityRow) => string;
  displayName: (row: EntityRow) => string;
}

const LABEL_SPECS: LabelSpec[] = [
  { batchKey: "companies", label: "Company", keyProp: "name", idPrefix: "company", idSource: (r) => String(r.name), displayName: (r) => String(r.name) },
  { batchKey: "founders", label: "Founder", keyProp: "name", idPrefix: "founder", idSource: (r) => String(r.name), displayName: (r) => String(r.name) },
  { batchKey: "investors", label: "Investor", keyProp: "name", idPrefix: "investor", idSource: (r) => String(r.name), displayName: (r) => String(r.name) },
  { batchKey: "features", label: "Feature", keyProp: "name", idPrefix: "feature", idSource: (r) => String(r.name), displayName: (r) => String(r.name) },
  { batchKey: "launches", label: "LaunchEvent", keyProp: "event_id", idPrefix: "launch", idSource: (r) => String(r.event_id), displayName: (r) => String(r.title ?? r.event_id) },
  { batchKey: "segments", label: "Segment", keyProp: "name", idPrefix: "segment", idSource: (r) => String(r.name), displayName: (r) => String(r.name) },
  { batchKey: "funding_rounds", label: "FundingRound", keyProp: "round_id", idPrefix: "round", idSource: (r) => String(r.round_id), displayName: (r) => String(r.name ?? r.round_id) },
  { batchKey: "snapshots", label: "WebsiteSnapshot", keyProp: "snapshot_id", idPrefix: "snapshot", idSource: (r) => String(r.snapshot_id), displayName: (r) => String(r.name ?? r.snapshot_id) },
  { batchKey: "posts", label: "Post", keyProp: "url", idPrefix: "post", idSource: (r) => String(r.title ?? r.url), displayName: (r) => String(r.title) },
  { batchKey: "moat_claims", label: "MoatClaim", keyProp: "claim_id", idPrefix: "moat", idSource: (r) => String(r.claim_id), displayName: (r) => String(r.name ?? r.claim_id) },
  { batchKey: "traction_signals", label: "TractionSignal", keyProp: "signal_id", idPrefix: "traction", idSource: (r) => String(r.signal_id), displayName: (r) => String(r.name ?? r.signal_id) },
];

interface RelSpec {
  fromLabel: NodeLabel;
  fromKey: string;
  toLabel: NodeLabel;
  toKey: string;
}

const REL_SPECS: Record<RelationshipType, RelSpec> = {
  COMPETES_IN: { fromLabel: "Company", fromKey: "name", toLabel: "Segment", toKey: "name" },
  FOUNDED: { fromLabel: "Founder", fromKey: "name", toLabel: "Company", toKey: "name" },
  WORKED_AT: { fromLabel: "Founder", fromKey: "name", toLabel: "Company", toKey: "name" },
  INVESTED_IN: { fromLabel: "Investor", fromKey: "name", toLabel: "Company", toKey: "name" },
  HAS_FEATURE: { fromLabel: "Company", fromKey: "name", toLabel: "Feature", toKey: "name" },
  SHIPPED: { fromLabel: "Company", fromKey: "name", toLabel: "LaunchEvent", toKey: "event_id" },
  SHIPPED_AFTER: { fromLabel: "LaunchEvent", fromKey: "event_id", toLabel: "LaunchEvent", toKey: "event_id" },
  TARGETS: { fromLabel: "Company", fromKey: "name", toLabel: "Segment", toKey: "name" },
  RELEVANT_TO: { fromLabel: "Company", fromKey: "name", toLabel: "Idea", toKey: "session_id" },
  CITED_BY: { fromLabel: "LaunchEvent", fromKey: "event_id", toLabel: "Source", toKey: "url" },
  RAISED: { fromLabel: "Company", fromKey: "name", toLabel: "FundingRound", toKey: "round_id" },
  PARTICIPATED_IN: { fromLabel: "Investor", fromKey: "name", toLabel: "FundingRound", toKey: "round_id" },
  HAD_SNAPSHOT: { fromLabel: "Company", fromKey: "name", toLabel: "WebsiteSnapshot", toKey: "snapshot_id" },
  NEXT_SNAPSHOT: { fromLabel: "WebsiteSnapshot", fromKey: "snapshot_id", toLabel: "WebsiteSnapshot", toKey: "snapshot_id" },
  POSTED: { fromLabel: "Founder", fromKey: "name", toLabel: "Post", toKey: "url" },
  ABOUT: { fromLabel: "Post", fromKey: "url", toLabel: "Company", toKey: "name" },
  CLAIMS_MOAT: { fromLabel: "Company", fromKey: "name", toLabel: "MoatClaim", toKey: "claim_id" },
  EVIDENCED_BY: { fromLabel: "MoatClaim", fromKey: "claim_id", toLabel: "Source", toKey: "url" },
  HAS_TRACTION: { fromLabel: "Company", fromKey: "name", toLabel: "TractionSignal", toKey: "signal_id" },
};

const ID_PREFIX_BY_LABEL: Record<string, string> = {
  Idea: "idea", Company: "company", Founder: "founder", Investor: "investor",
  Feature: "feature", LaunchEvent: "launch", Segment: "segment", Source: "source",
  FundingRound: "round", WebsiteSnapshot: "snapshot", Post: "post",
  MoatClaim: "moat", TractionSignal: "traction",
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function guessSourceType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("news.ycombinator.com") || u.includes("hn.algolia.com")) return "HN";
  if (u.includes("producthunt.com")) return "PH";
  if (u.includes("github.com")) return "GitHub";
  if (u.includes("ycombinator.com") || u.includes("yc-oss")) return "YC";
  if (u.includes("web.archive.org")) return "wayback";
  if (u.includes("sec.gov")) return "EDGAR";
  if (u.includes("techcrunch.com") || u.includes("news.google.com")) return "news";
  if (u.includes("clay.com") || u === "clay") return "Clay";
  return "blog";
}

/** Neo4j properties must be primitives or arrays of primitives. */
function sanitizeProps(row: EntityRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) {
      out[k] = v;
    }
    // plain objects are dropped (not valid Neo4j property values)
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Idea node (not part of ExtractedBatch; created per session)         */
/* ------------------------------------------------------------------ */

/** MERGE the session's Idea node. Idempotent. */
export async function writeIdea(idea: Idea & { id?: string }): Promise<GraphNode> {
  const id = idea.id ?? `idea:${slugify(idea.text)}`;
  const props = sanitizeProps({ ...idea, id, name: idea.text });
  await runWrite(
    `MERGE (i:Idea {session_id: $session_id}) SET i += $props`,
    { session_id: idea.session_id, props },
  );
  return { ...props, id, label: "Idea", name: idea.text } as GraphNode;
}

/* ------------------------------------------------------------------ */
/* Main writer                                                         */
/* ------------------------------------------------------------------ */

export async function writeEntities(
  batch: Partial<ExtractedBatch>,
): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const parsed = batchSchema.parse(batch);
  const fetchedAt = new Date().toISOString();
  const outNodes: GraphNode[] = [];
  // natural key -> node id, per label (for building GraphLinks)
  const idByLabelKey = new Map<string, string>();
  const rememberId = (label: string, key: string, id: string) =>
    idByLabelKey.set(`${label}|${key}`, id);

  /* --- nodes, one UNWIND MERGE per label, provenance enforced --- */
  for (const spec of LABEL_SPECS) {
    const rows = parsed[spec.batchKey as keyof typeof parsed] as EntityRow[];
    if (!rows.length) continue;

    const dbRows = rows.map((row) => {
      const id = typeof row.id === "string" && row.id ? row.id : `${spec.idPrefix}:${slugify(spec.idSource(row))}`;
      const name = typeof row.name === "string" && row.name ? row.name : spec.displayName(row);
      const sourceUrl = String(row.source_url);
      const props = sanitizeProps({ ...row, id, name, label: undefined });
      delete props.label;
      rememberId(spec.label, String(row[spec.keyProp]), id);
      return {
        key: row[spec.keyProp],
        props,
        source_url: sourceUrl,
        source_id: `source:${slugify(sourceUrl)}`,
        source_type: guessSourceType(sourceUrl),
        fetched_at: fetchedAt,
      };
    });

    for (const rowsChunk of chunk(dbRows, BATCH_SIZE)) {
      await runWrite(
        `UNWIND $rows AS row
         MERGE (n:${spec.label} {${spec.keyProp}: row.key})
         SET n += row.props
         WITH n, row
         MERGE (s:Source {url: row.source_url})
           ON CREATE SET s.id = row.source_id, s.type = row.source_type, s.fetched_at = row.fetched_at
         MERGE (n)-[:CITED_BY]->(s)`,
        { rows: rowsChunk },
      );
    }

    for (const dbRow of dbRows) {
      outNodes.push({
        ...(dbRow.props as Record<string, unknown>),
        id: String((dbRow.props as EntityRow).id),
        label: spec.label,
        name: String((dbRow.props as EntityRow).name),
      } as GraphNode);
    }
  }

  /* --- relationships, one UNWIND per type --- */
  const outLinks: GraphLink[] = [];
  const byType = new Map<RelationshipType, ExtractedRelationship[]>();
  for (const rel of parsed.relationships as unknown as ExtractedRelationship[]) {
    const list = byType.get(rel.type) ?? [];
    list.push(rel);
    byType.set(rel.type, list);
  }

  for (const [type, rels] of byType) {
    const spec = REL_SPECS[type];
    const dbRows = rels.map((rel) => ({
      from: rel.from,
      to: rel.to,
      props: sanitizeProps({ ...(rel.props ?? {}), source_url: rel.source_url }),
    }));

    for (const rowsChunk of chunk(dbRows, BATCH_SIZE)) {
      await runWrite(
        `UNWIND $rows AS row
         MATCH (s:${spec.fromLabel} {${spec.fromKey}: row.from})
         MATCH (t:${spec.toLabel} {${spec.toKey}: row.to})
         MERGE (s)-[r:${type}]->(t)
         SET r += row.props`,
        { rows: rowsChunk },
      );
    }

    for (const rel of rels) {
      const sourceId =
        idByLabelKey.get(`${spec.fromLabel}|${rel.from}`) ??
        `${ID_PREFIX_BY_LABEL[spec.fromLabel]}:${slugify(rel.from)}`;
      const targetId =
        idByLabelKey.get(`${spec.toLabel}|${rel.to}`) ??
        `${ID_PREFIX_BY_LABEL[spec.toLabel]}:${slugify(rel.to)}`;
      outLinks.push({ source: sourceId, target: targetId, type, props: rel.props });
    }
  }

  if (env.DEBUG) {
    console.warn(`[write] merged ${outNodes.length} nodes, ${outLinks.length} links${hasNeo4j() ? "" : " (demo mode: no-op)"}`);
  }
  return { nodes: outNodes, links: outLinks };
}

/* ------------------------------------------------------------------ */
/* Schema constraints                                                  */
/* ------------------------------------------------------------------ */

/**
 * Apply uniqueness constraints from lib/schema.cypher (idempotent;
 * one executeQuery per statement — Aura rejects multi-statement strings).
 */
export async function applySchema(): Promise<string[]> {
  const file = path.join(process.cwd(), "lib", "schema.cypher");
  const raw = fs.readFileSync(file, "utf8");
  const statements = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await runWrite(statement);
  }
  return statements;
}
