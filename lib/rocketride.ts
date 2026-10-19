/**
 * RocketRide Cloud client wrapper (pipeline invocation).
 *
 * Invocation is WebSocket via the `rocketride` SDK (RocketRideClient),
 * never plain fetch() against cloud.rocketride.ai:
 *   connect -> use({ filepath }) -> send(token, payload) -> terminate -> disconnect.
 *
 * In live mode the cloud pipeline is required. Local extraction is only a
 * demo-mode helper; a local-only pipeline does not satisfy the submission.
 */

import { env, hasGateway, hasRocketRide } from "@/lib/env";
import type { ExtractedBatch, OnboardingResult, RawDoc } from "@/lib/types";
import {
  emptyBatch,
  extractBatch,
  parseExtractedBatch,
} from "@/lib/pipeline/extract";
import { chat } from "@/lib/gateway";

function debug(...args: unknown[]): void {
  if (env.DEBUG) console.error("[rocketride]", ...args);
}

// Vercel's serverless bundling can include an incompatible optional
// `bufferutil` export for ws, which crashes RocketRide sends with
// "mask is not a function". Force ws onto its portable JS implementation
// before dynamically importing the RocketRide client.
process.env.WS_NO_BUFFER_UTIL ??= "1";

export interface ExtractionInput {
  idea: string;
  tags: string[];
  raw_documents: RawDoc[];
}

export const ROCKETRIDE_EXTRACTION_PROJECT_ID =
  "2849d160-3b2a-4119-a6d1-b070070c18d3";
export const ROCKETRIDE_EXTRACTION_SOURCE = "webhook_1";

/** True when extraction will run on the deployed RocketRide cloud pipe. */
export function usesRemoteExtraction(): boolean {
  return hasRocketRide() && !env.DEMO_MODE;
}

/* ------------------------------------------------------------------ */
/* Remote invocation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Pull a JSON value out of a PIPELINE_RESULT-ish response. The response
 * node emits the LLM output on a text lane; depending on engine version
 * that arrives as a string, a string[], or a nested field.
 */
function coerceResultToJson(result: unknown): unknown {
  if (result == null) throw new Error("rocketride: empty pipeline result");
  if (typeof result === "string") return JSON.parse(stripFences(result));
  if (typeof result !== "object") {
    throw new Error("rocketride: unexpected pipeline result type");
  }
  const record = result as Record<string, unknown>;
  // Already the batch itself?
  if (Array.isArray(record.companies) && Array.isArray(record.relationships)) {
    return record;
  }
  for (const key of ["text", "data", "json", "response", "answers", "answer"]) {
    const value = record[key];
    if (typeof value === "string") return JSON.parse(stripFences(value));
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return JSON.parse(stripFences(value.join("")));
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      try {
        return coerceResultToJson(value);
      } catch {
        // keep scanning other fields
      }
    }
  }
  throw new Error("rocketride: no JSON payload found in pipeline result");
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

async function runRemoteExtraction(
  input: ExtractionInput,
): Promise<ExtractedBatch> {
  const { RocketRideClient } = await import("rocketride");
  const client = new RocketRideClient({
    auth: env.ROCKETRIDE_APIKEY,
    uri: env.ROCKETRIDE_URI,
  });
  await client.connect();
  try {
    const token = await client.getTaskToken({
      projectId: ROCKETRIDE_EXTRACTION_PROJECT_ID,
      source: ROCKETRIDE_EXTRACTION_SOURCE,
    });
    if (!token) {
      throw new Error(
        `RocketRide deployment is not running for ${ROCKETRIDE_EXTRACTION_PROJECT_ID}/${ROCKETRIDE_EXTRACTION_SOURCE}. Run npm run rocketride:deploy.`,
      );
    }
    const result = await client.send(
      token,
      JSON.stringify(input),
      { name: "input.json" },
      "application/json",
    );
    return parseExtractedBatch(coerceResultToJson(result));
  } finally {
    try {
      await client.disconnect();
    } catch (err) {
      debug("disconnect failed", err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

/** Run the deployed extraction .pipe over a batch of raw documents. */
export async function extractEntities(
  input: ExtractionInput,
): Promise<ExtractedBatch> {
  if (input.raw_documents.length === 0) return emptyBatch();
  if (env.DEMO_MODE) {
    return extractBatch(input.raw_documents, input.idea, input.tags);
  }
  if (!hasRocketRide()) {
    throw new Error("RocketRide Cloud is not configured (ROCKETRIDE_APIKEY)");
  }
  if (!hasGateway()) {
    throw new Error("Butterbase AI gateway is not configured for the RocketRide pipe");
  }
  try {
    return await runRemoteExtraction(input);
  } catch (err) {
    debug("remote extraction failed:", err);
    throw err;
  }
}

/** Convenience form matching the pipeline conductor's call site. */
export async function runExtraction(
  docs: RawDoc[],
  idea: string,
  tags: string[],
): Promise<ExtractedBatch> {
  return extractEntities({ idea, tags, raw_documents: docs });
}

/* ------------------------------------------------------------------ */
/* Query expansion                                                     */
/* ------------------------------------------------------------------ */

function cannedSearchTerms(onboarding: OnboardingResult): string[] {
  const terms = new Set<string>();
  for (const t of onboarding.search_terms) terms.add(t.trim());
  terms.add(onboarding.refined_idea.trim());
  for (const tag of onboarding.tags) {
    terms.add(`${onboarding.refined_idea} ${tag}`.trim());
  }
  return [...terms].filter(Boolean).slice(0, 8);
}

/**
 * Query expansion: refined idea + tags -> concrete search terms for the
 * discovery connectors. Gateway-backed; canned expansion in demo mode.
 */
export async function expandQuery(
  onboarding: OnboardingResult,
): Promise<string[]> {
  if (env.DEMO_MODE) return cannedSearchTerms(onboarding);
  if (!hasGateway()) {
    throw new Error("Butterbase AI gateway is not configured for query expansion");
  }
  const raw = await chat(
    [
      {
        role: "system",
        content:
          "You expand a startup idea into search queries for competitive discovery. " +
          'Respond with ONLY JSON: {"search_terms": string[]} - 5 to 8 short queries ' +
          "covering the idea itself, adjacent phrasings, and each provided tag. No prose.",
      },
      {
        role: "user",
        content: JSON.stringify({
          refined_idea: onboarding.refined_idea,
          tags: onboarding.tags,
          seed_terms: onboarding.search_terms,
        }),
      },
    ],
    { json: true, temperature: 0.2 },
  );
  const parsed = JSON.parse(stripFences(raw)) as { search_terms?: unknown };
  if (
    Array.isArray(parsed.search_terms) &&
    parsed.search_terms.every((t) => typeof t === "string")
  ) {
    const terms = (parsed.search_terms as string[])
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length > 0) return terms.slice(0, 8);
  }
  throw new Error("Butterbase AI gateway returned no query expansion terms");
}
