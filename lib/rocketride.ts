/**
 * RocketRide Cloud client wrapper (pipeline invocation).
 *
 * Two remote invocation paths, tried in this order:
 *
 * 1. Deployed endpoint (preferred, "managed production endpoint"): when
 *    ROCKETRIDE_ENDPOINT is set, POST the JSON payload over HTTP to the
 *    pipeline's deployed webhook trigger URL on cloud.rocketride.ai. The
 *    pipe is already deployed — nothing is uploaded per call. This is the
 *    hackathon-mandated "running as a managed, production endpoint" path.
 *    The installed rocketride@1.3.0 SDK has NO way to invoke a deployed
 *    pipeline by id/slug for a synchronous result (see below), so the
 *    deployed webhook is called with plain fetch().
 *
 * 2. SDK filepath upload (fallback): WebSocket via the `rocketride` SDK
 *    (RocketRideClient): connect -> use({ filepath }) -> send(token, payload)
 *    -> terminate -> disconnect. This UPLOADS the local .pipe on every call.
 *
 * SDK surface note (rocketride@1.3.0, dist/types/client.d.ts + deploy.d.ts):
 * `use()` accepts only `filepath` or an inline `pipeline` object — there is
 * no `pipeline_id`/`slug` reference option. `client.deploy.{add,list,status,
 * update,remove}` MANAGE server-side deployments (scheduled/manual via cron),
 * and `DeploymentRecord` exposes no trigger/webhook URL and no synchronous
 * invoke. So a deployed pipeline is only callable as a production endpoint
 * over its HTTP webhook URL — hence path 1 above.
 *
 * Fallback ladder (demo insurance):
 * - deployed endpoint -> SDK filepath upload -> local extraction.
 * - !hasRocketRide() or DEMO_MODE -> local extraction via lib/pipeline/extract.ts
 *   (the conductor notes in the event stream that extraction ran locally).
 * - Any remote call that throws or returns unparseable output -> next rung.
 */

import path from "node:path";
import { RocketRideClient } from "rocketride";
import { env, hasGateway, hasRocketRide, hasRocketRideEndpoint } from "@/lib/env";
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

export interface ExtractionInput {
  idea: string;
  tags: string[];
  raw_documents: RawDoc[];
}

const PIPE_PATH = path.join(process.cwd(), "pipelines", "rivalry-extract.pipe");

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

/** Extraction is slow (LLM over a batch of docs); give the endpoint 60s. */
const ENDPOINT_TIMEOUT_MS = 60_000;

/**
 * Invoke the deployed pipeline over its HTTP webhook trigger URL.
 *
 * Webhook contract: JSON in -> JSON out. The deployed webhook node feeds the
 * LLM node, and the response node returns the ExtractedBatch JSON as the HTTP
 * body. The auth token is carried in the URL's `?auth=` query param (baked
 * into ROCKETRIDE_ENDPOINT), so no extra header is required; secrets like the
 * Butterbase key are interpolated (`${VAR}`) server-side at deploy time.
 *
 * The response body may be the ExtractedBatch directly or a PIPELINE_RESULT-
 * shaped envelope (result_types + text/data/answers lanes); coerceResultToJson
 * handles both, exactly like the SDK path.
 */
async function runEndpointExtraction(
  input: ExtractionInput,
): Promise<ExtractedBatch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT_MS);
  try {
    const res = await fetch(env.ROCKETRIDE_ENDPOINT as string, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `rocketride endpoint ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    // Prefer JSON; fall back to text (some webhook nodes return text/plain).
    const contentType = res.headers.get("content-type") ?? "";
    const payload: unknown = contentType.includes("application/json")
      ? await res.json()
      : await res.text();
    return parseExtractedBatch(coerceResultToJson(payload));
  } finally {
    clearTimeout(timer);
  }
}

async function runRemoteExtraction(
  input: ExtractionInput,
): Promise<ExtractedBatch> {
  const client = new RocketRideClient({
    auth: env.ROCKETRIDE_APIKEY,
    uri: env.ROCKETRIDE_URI,
  });
  await client.connect();
  let token: string | undefined;
  try {
    const useResult = await client.use({
      filepath: PIPE_PATH,
      name: "rivalry-extract",
      // The .pipe references ${ROCKETRIDE_BUTTERBASE_AI_KEY} so the LLM
      // node talks to the Butterbase gateway (never raw provider keys).
      env: env.BUTTERBASE_AI_KEY
        ? { ROCKETRIDE_BUTTERBASE_AI_KEY: env.BUTTERBASE_AI_KEY }
        : undefined,
    });
    token = useResult.token;
    const result = await client.send(
      token,
      JSON.stringify(input),
      { name: "input.json" },
      "application/json",
    );
    return parseExtractedBatch(coerceResultToJson(result));
  } finally {
    if (token) {
      try {
        await client.terminate(token);
      } catch (err) {
        debug("terminate failed", err);
      }
    }
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

/** Run the deployed extraction pipeline over a batch of raw documents. */
export async function extractEntities(
  input: ExtractionInput,
): Promise<ExtractedBatch> {
  if (input.raw_documents.length === 0) return emptyBatch();
  if (!usesRemoteExtraction()) {
    debug("extracting locally via the Butterbase gateway (RocketRide not configured)");
    return extractBatch(input.raw_documents, input.idea, input.tags);
  }

  // Rung 1: deployed managed endpoint (HTTP webhook trigger URL).
  if (hasRocketRideEndpoint()) {
    try {
      debug("extracting via deployed RocketRide Cloud endpoint (HTTP webhook)");
      return await runEndpointExtraction(input);
    } catch (err) {
      debug("deployed endpoint failed, falling back to SDK filepath upload:", err);
    }
  }

  // Rung 2: SDK filepath upload (only when an API key is configured).
  if (hasRocketRide() && env.ROCKETRIDE_APIKEY) {
    try {
      debug("extracting via RocketRide SDK filepath upload (use({ filepath }))");
      return await runRemoteExtraction(input);
    } catch (err) {
      debug("SDK filepath upload failed, falling back to local:", err);
    }
  }

  // Rung 3: local extraction via the Butterbase gateway.
  debug("extracting locally via the Butterbase gateway (remote paths exhausted)");
  return extractBatch(input.raw_documents, input.idea, input.tags);
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
  if (!hasGateway() || env.DEMO_MODE) return cannedSearchTerms(onboarding);
  try {
    const raw = await chat(
      [
        {
          role: "system",
          content:
            "You expand a startup idea into search queries for competitive discovery. " +
            'Respond with ONLY JSON: {"search_terms": string[]} — 5 to 8 short queries ' +
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
    return cannedSearchTerms(onboarding);
  } catch (err) {
    debug("expandQuery fell back to canned terms:", err);
    return cannedSearchTerms(onboarding);
  }
}
