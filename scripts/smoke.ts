/**
 * Smoke test: connectivity + per-label counts + provenance check
 * ("no orphan facts": every non-Idea, non-Source node touches a Source).
 * In demo mode, validates fixture integrity instead and exits green.
 *
 * Run: npx tsx scripts/smoke.ts
 * Exit code 0 = healthy, 1 = failure.
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

async function main(): Promise<void> {
  loadEnvLocal();
  const { hasNeo4j } = await import("../lib/env");
  const { getDemoGraph, getDriver, runRead, closeDriver } = await import("../lib/neo4j");
  const { linkKey } = await import("../lib/types");

  let failed = false;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed = true;
  };

  if (!hasNeo4j()) {
    console.log("[smoke] DEMO MODE (no Neo4j credentials) — validating fixture integrity instead.\n");
    const { nodes, links, insights } = getDemoGraph();
    const ids = new Set(nodes.map((n) => n.id));
    const dangling = links.filter((l) => !ids.has(l.source) || !ids.has(l.target));
    check(dangling.length === 0, "fixture links resolve", `${dangling.length} dangling`);
    const keys = new Set(links.map((l) => linkKey(l)));
    const badCards = insights.filter(
      (c) =>
        c.highlight.nodeIds.some((id) => !ids.has(id)) ||
        c.highlight.linkKeys.some((k) => !keys.has(k)),
    );
    check(badCards.length === 0, "insight highlights resolve", `${badCards.length} bad cards`);
    const noSource = nodes.filter((n) => n.label !== "Idea" && !n.source_url);
    check(noSource.length === 0, "every fixture node has source_url", `${noSource.length} missing`);
    console.log(`\n[smoke] fixture: ${nodes.length} nodes, ${links.length} links, ${insights.length} insights.`);
    process.exit(failed ? 1 : 0);
  }

  /* 1. Connectivity */
  try {
    await getDriver().verifyConnectivity({ database: "neo4j" });
    check(true, "verifyConnectivity");
  } catch (err) {
    check(false, "verifyConnectivity", String(err));
    process.exit(1);
  }

  /* 2. Counts */
  const nodeCounts = await runRead<{ label: string; n: number }>(
    "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY n DESC",
  );
  const totalNodes = nodeCounts.reduce((sum, r) => sum + r.n, 0);
  check(totalNodes > 0, "node count > 0", `${totalNodes} nodes`);
  for (const row of nodeCounts) console.log(`      ${row.label}: ${row.n}`);
  const relCounts = await runRead<{ type: string; n: number }>(
    "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS n ORDER BY n DESC",
  );
  const totalRels = relCounts.reduce((sum, r) => sum + r.n, 0);
  check(totalRels > 0, "relationship count > 0", `${totalRels} relationships`);

  /* 3. Provenance: no orphan facts */
  const orphans = await runRead<{ orphans: number }>(
    "MATCH (n) WHERE NOT n:Idea AND NOT n:Source AND NOT (n)--(:Source) RETURN count(n) AS orphans",
  );
  check((orphans[0]?.orphans ?? -1) === 0, "no orphan facts", `${orphans[0]?.orphans} nodes without a Source edge`);

  /* 4. Constraints present */
  const constraints = await runRead<{ name: string }>("SHOW CONSTRAINTS YIELD name RETURN name");
  check(constraints.length >= 13, "constraints applied", `${constraints.length} found (expect >= 13)`);

  await closeDriver();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
