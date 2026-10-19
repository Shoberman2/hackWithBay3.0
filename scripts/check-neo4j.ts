/**
 * Validate live Neo4j/Aura configuration without printing secrets.
 *
 * Run: npm run neo4j:check
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

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "<invalid-uri>";
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const { env, hasNeo4j, missingNeo4jConfig, neo4jConfigErrorMessage } = await import("../lib/env");
  const { getDriver, runRead, closeDriver } = await import("../lib/neo4j");

  if (!hasNeo4j()) {
    console.error(`[neo4j:check] missing: ${missingNeo4jConfig().join(", ")}`);
    throw new Error(neo4jConfigErrorMessage());
  }

  console.log(`[neo4j:check] host: ${safeHost(env.NEO4J_URI as string)}`);
  console.log(`[neo4j:check] username: ${env.NEO4J_USERNAME}`);

  await getDriver().verifyConnectivity({ database: "neo4j" });
  console.log("[neo4j:check] connectivity: ok");

  const ping = await runRead<{ ok: number }>("RETURN 1 AS ok");
  if (ping[0]?.ok !== 1) throw new Error("Neo4j ping query returned an unexpected result");
  console.log("[neo4j:check] query: ok");

  const constraints = await runRead<{ name: string }>("SHOW CONSTRAINTS YIELD name RETURN name");
  console.log(`[neo4j:check] constraints: ${constraints.length} found`);

  await closeDriver();
}

main().catch((err) => {
  console.error("[neo4j:check] failed:", err);
  process.exit(1);
});
