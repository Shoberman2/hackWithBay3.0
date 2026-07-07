/**
 * Apply lib/schema.cypher uniqueness constraints to the Aura instance.
 * One executeQuery per statement (Aura rejects multi-statement strings).
 *
 * Run: npx tsx scripts/apply-schema.ts
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
  // Import after env is loaded (lib/env.ts snapshots process.env on import).
  const { hasNeo4j } = await import("../lib/env");
  const { applySchema } = await import("../lib/pipeline/write");
  const { runRead, closeDriver } = await import("../lib/neo4j");

  if (!hasNeo4j()) {
    console.log("[apply-schema] DEMO MODE (no Neo4j credentials) — nothing to apply.");
    return;
  }

  const statements = await applySchema();
  console.log(`[apply-schema] applied ${statements.length} constraint statements.`);

  const constraints = await runRead<{ name: string }>("SHOW CONSTRAINTS YIELD name RETURN name");
  console.log(`[apply-schema] SHOW CONSTRAINTS -> ${constraints.length}:`);
  for (const c of constraints) console.log(`  - ${c.name}`);

  await closeDriver();
}

main().catch((err) => {
  console.error("[apply-schema] failed:", err);
  process.exit(1);
});
