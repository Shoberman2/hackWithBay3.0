/**
 * Provision Butterbase Data API tables and realtime for Rivalry.
 *
 * Run:
 *   npx tsx scripts/provision-butterbase.ts --dry-run
 *   npx tsx scripts/provision-butterbase.ts --apply
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@butterbase/sdk";
import { butterbaseSchema, BUTTERBASE_TABLES } from "../lib/butterbase-schema";

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
  const { env, hasButterbaseServiceKey } = await import("../lib/env");
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;

  if (!hasButterbaseServiceKey()) {
    throw new Error("BUTTERBASE_APP_ID and BUTTERBASE_SERVICE_KEY are required to provision tables");
  }

  const client = createClient({
    appId: env.BUTTERBASE_APP_ID!,
    apiUrl: env.BUTTERBASE_API_URL,
    anonKey: env.BUTTERBASE_SERVICE_KEY!,
    persistSession: false,
    detectSessionFromUrl: false,
  });

  const result = await client.admin.schema.apply(butterbaseSchema, {
    dryRun,
    name: dryRun ? "rivalry-schema-dry-run" : "rivalry-schema",
  });
  if (result.error || !result.data) throw result.error ?? new Error("Schema apply returned no data");
  console.log(`[butterbase] schema ${dryRun ? "dry-run" : "apply"}: ${result.data.message}`);
  for (const statement of result.data.statements ?? []) {
    console.log(`  ${statement}`);
  }

  if (dryRun) return;

  const realtime = await client.admin.realtime.configure([...BUTTERBASE_TABLES]);
  if (realtime.error) throw realtime.error;
  console.log(`[butterbase] realtime configured for: ${BUTTERBASE_TABLES.join(", ")}`);
}

main().catch((err) => {
  console.error("[butterbase] provision failed:", err);
  process.exit(1);
});
