/**
 * Validate, deploy, and start the RocketRide Cloud extraction pipeline.
 *
 * Run:
 *   npx tsx scripts/deploy-rocketride.ts
 */

import fs from "node:fs";
import path from "node:path";
import { RocketRideClient } from "rocketride";
import {
  ROCKETRIDE_EXTRACTION_PROJECT_ID,
  ROCKETRIDE_EXTRACTION_SOURCE,
} from "../lib/rocketride";

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

function readPipeline(): Record<string, unknown> {
  const file = path.join(process.cwd(), "pipelines", "rivalry-extract.pipe");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const pipeline = "pipeline" in parsed ? parsed.pipeline : parsed;
  if (!pipeline || typeof pipeline !== "object") {
    throw new Error("pipelines/rivalry-extract.pipe did not contain a pipeline object");
  }
  return pipeline as Record<string, unknown>;
}

function substituteSecrets(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === "string") {
    return Object.entries(replacements).reduce(
      (next, [key, replacement]) => next.replaceAll(`\${${key}}`, replacement),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => substituteSecrets(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        substituteSecrets(item, replacements),
      ]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { env, hasGateway, hasRocketRide } = await import("../lib/env");
  if (!hasRocketRide()) throw new Error("ROCKETRIDE_APIKEY is required");
  if (!hasGateway()) throw new Error("BUTTERBASE_AI_KEY is required for the cloud pipe");

  const pipeline = substituteSecrets(readPipeline(), {
    ROCKETRIDE_BUTTERBASE_AI_KEY: env.BUTTERBASE_AI_KEY!,
  }) as Record<string, unknown>;
  const pipelineConfig = pipeline as never;

  const client = new RocketRideClient({
    auth: env.ROCKETRIDE_APIKEY,
    uri: env.ROCKETRIDE_URI,
  });

  await client.connect();
  try {
    const validation = await client.validate({
      pipeline: pipelineConfig,
      source: ROCKETRIDE_EXTRACTION_SOURCE,
    });
    const errors = Array.isArray(validation.errors) ? validation.errors : [];
    const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
    for (const warning of warnings) console.warn("[rocketride] validation warning:", warning);
    if (errors.length > 0) {
      for (const error of errors) console.error("[rocketride] validation error:", error);
      throw new Error(`RocketRide validation failed with ${errors.length} error(s)`);
    }
    console.log("[rocketride] validation passed");

    const deployments = await client.deploy.list();
    const exists = deployments.some(
      (deployment) => deployment.pipeline?.project_id === ROCKETRIDE_EXTRACTION_PROJECT_ID,
    );
    if (exists) {
      await client.deploy.update(ROCKETRIDE_EXTRACTION_PROJECT_ID, {
        pipeline: pipelineConfig,
        schedule: "manual",
      });
      console.log("[rocketride] deployment updated");
    } else {
      await client.deploy.add(pipelineConfig, { schedule: "manual" });
      console.log("[rocketride] deployment created");
    }

    const started = await client.use({
      pipeline: pipelineConfig,
      source: ROCKETRIDE_EXTRACTION_SOURCE,
      useExisting: true,
      ttl: 0,
      name: "rivalry-extract",
      pipelineTraceLevel: "summary",
    });
    console.log(`[rocketride] cloud task ready for ${ROCKETRIDE_EXTRACTION_PROJECT_ID}/${ROCKETRIDE_EXTRACTION_SOURCE}`);
    console.log(`[rocketride] task token: ${String(started.token).slice(0, 8)}...`);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error("[rocketride] deploy failed:", err);
  process.exit(1);
});
