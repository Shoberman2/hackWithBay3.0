/**
 * Seed Neo4j from fixtures/demo-graph.json through the real writer
 * (writeEntities), proving the write path — never raw Cypher.
 * Converts GraphNode/GraphLink back into an ExtractedBatch, preserving
 * fixture node ids. Idempotent: running twice creates no duplicates.
 *
 * Run: npx tsx scripts/seed.ts
 */

import fs from "node:fs";
import path from "node:path";

/** Minimal .env.local loader (scripts run outside Next's env loading). */
function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}

/** Natural MERGE key per label, used to translate link ids -> batch keys. */
const KEY_PROP: Record<string, string> = {
  Idea: "session_id",
  Company: "name",
  Founder: "name",
  Investor: "name",
  Feature: "name",
  LaunchEvent: "event_id",
  Segment: "name",
  Source: "url",
  FundingRound: "round_id",
  WebsiteSnapshot: "snapshot_id",
  Post: "url",
  MoatClaim: "claim_id",
  TractionSignal: "signal_id",
};

const BATCH_KEY: Record<string, string> = {
  Company: "companies",
  Founder: "founders",
  Investor: "investors",
  Feature: "features",
  LaunchEvent: "launches",
  Segment: "segments",
  FundingRound: "funding_rounds",
  WebsiteSnapshot: "snapshots",
  Post: "posts",
  MoatClaim: "moat_claims",
  TractionSignal: "traction_signals",
};

async function main(): Promise<void> {
  loadEnvLocal();
  const { hasNeo4j } = await import("../lib/env");
  const { getDemoGraph, runRead, closeDriver } = await import("../lib/neo4j");
  const { writeEntities, writeIdea } = await import("../lib/pipeline/write");
  type AnyNode = Record<string, unknown> & { id: string; label: string; name: string };

  if (!hasNeo4j()) {
    console.log("[seed] DEMO MODE (no Neo4j credentials) — the app already serves the fixture directly; nothing to seed.");
    return;
  }

  const { nodes, links } = getDemoGraph();
  const byId = new Map<string, AnyNode>(nodes.map((n) => [n.id, n as AnyNode]));

  /* Idea node first (not part of ExtractedBatch). */
  const ideaNode = nodes.find((n) => n.label === "Idea") as AnyNode | undefined;
  if (ideaNode) {
    const { label: _label, ...ideaProps } = ideaNode;
    await writeIdea(ideaProps as never);
    console.log(`[seed] Idea node merged (${ideaNode.id}).`);
  }

  /* Entities: strip the viz-only `label` key, keep everything else
     (including id / community / pagerank — zod schemas are loose). */
  const batch: Record<string, unknown[]> = {
    companies: [], founders: [], investors: [], features: [], launches: [],
    segments: [], funding_rounds: [], snapshots: [], posts: [],
    moat_claims: [], traction_signals: [], relationships: [],
  };
  for (const node of nodes as AnyNode[]) {
    const key = BATCH_KEY[node.label];
    if (!key) continue; // Idea handled above; fixture has no Source nodes
    const { label: _label, ...props } = node;
    batch[key].push(props);
  }

  /* Relationships: translate node ids to natural keys per REL endpoints. */
  let skipped = 0;
  for (const link of links) {
    const from = byId.get(link.source);
    const to = byId.get(link.target);
    if (!from || !to) {
      skipped++;
      continue;
    }
    const fromKey = from[KEY_PROP[from.label]];
    const toKey = to[KEY_PROP[to.label]];
    if (typeof fromKey !== "string" || typeof toKey !== "string") {
      skipped++;
      continue;
    }
    batch.relationships.push({
      from: fromKey,
      to: toKey,
      type: link.type,
      props: link.props,
      source_url:
        (from.source_url as string | undefined) ??
        (to.source_url as string | undefined) ??
        "https://rivalry.local/demo",
    });
  }

  const written = await writeEntities(batch as never);
  console.log(
    `[seed] wrote ${written.nodes.length} entities and ${written.links.length} relationships` +
      (skipped ? ` (${skipped} links skipped: unresolvable endpoints)` : ""),
  );

  /* Verify counts + provenance. */
  const counts = await runRead<{ label: string; n: number }>(
    "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC",
  );
  for (const row of counts) console.log(`  ${row.label}: ${row.n}`);
  const orphans = await runRead<{ orphans: number }>(
    "MATCH (n) WHERE NOT n:Idea AND NOT n:Source AND NOT (n)--(:Source) RETURN count(n) AS orphans",
  );
  console.log(`[seed] provenance orphans: ${orphans[0]?.orphans ?? "?"} (expect 0)`);

  await closeDriver();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
