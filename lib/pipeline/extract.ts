/**
 * Local entity extraction via the Butterbase gateway (lib/gateway.ts).
 * This is the fallback path when the RocketRide cloud pipeline is not
 * configured; it enforces the exact same output contract (ExtractedBatch).
 *
 * Guarantees:
 * - The LLM is instructed to emit ONLY ExtractedBatch JSON.
 * - Every entity must carry source_url copied from the input doc.
 * - Every relationship carries confidence 0-1 (in props.confidence).
 * - Unknown fields are null (schema maps null -> undefined), never guessed.
 * - Zod-parse; one retry with the validation error appended; then the
 *   batch is dropped (empty batch returned) — unvalidated JSON never
 *   reaches the writer.
 */

import { z } from "zod";
import { chat } from "@/lib/gateway";
import { env, hasGateway } from "@/lib/env";
import type { ExtractedBatch, RawDoc } from "@/lib/types";

function debug(...args: unknown[]): void {
  if (env.DEBUG) console.error("[extract]", ...args);
}

/* ------------------------------------------------------------------ */
/* Zod schema mirroring lib/types.ts ExtractedBatch                    */
/* ------------------------------------------------------------------ */

const optString = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined);
const optNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? undefined);

const propsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .nullish()
  .transform((v) => v ?? undefined);

const companySchema = z.object({
  name: z.string().min(1),
  url: optString,
  description: optString,
  stage: optString,
  founded_year: optNumber,
  hq: optString,
  status: z
    .enum(["active", "dead", "acquired"])
    .nullish()
    .transform((v) => v ?? undefined),
  source_url: z.string().min(1),
});

const founderSchema = z.object({
  name: z.string().min(1),
  linkedin_url: optString,
  background_summary: optString,
  source_url: z.string().min(1),
});

const investorSchema = z.object({
  name: z.string().min(1),
  type: z
    .enum(["VC", "angel", "accelerator"])
    .nullish()
    .transform((v) => v ?? undefined),
  notable: optString,
  source_url: z.string().min(1),
});

const featureSchema = z.object({
  name: z.string().min(1),
  category: optString,
  description: optString,
  source_url: z.string().min(1),
});

const launchSchema = z.object({
  event_id: z.string().min(1),
  title: z.string().min(1),
  date: optString,
  source: optString,
  url: optString,
  source_url: z.string().min(1),
});

const segmentSchema = z.object({
  name: z.string().min(1),
  source_url: z.string().min(1),
});

const fundingRoundSchema = z.object({
  round_id: z.string().min(1),
  round_type: z.string().min(1),
  amount_usd: optNumber,
  announced_date: optString,
  source_url: z.string().min(1),
});

const snapshotSchema = z.object({
  snapshot_id: z.string().min(1),
  url: z.string().min(1),
  captured_at: z.string().min(1),
  positioning_summary: optString,
  digest: optString,
  source_url: z.string().min(1),
});

const postSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  platform: z.enum(["HN", "PH", "blog", "GitHub"]),
  posted_at: optString,
  source_url: z.string().min(1),
});

const moatClaimSchema = z.object({
  claim_id: z.string().min(1),
  type: z.enum([
    "network-effects",
    "data",
    "distribution",
    "brand",
    "switching-costs",
  ]),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source_url: z.string().min(1),
});

const tractionSignalSchema = z.object({
  signal_id: z.string().min(1),
  metric: z.enum(["users", "stars", "votes", "app_ratings", "web_rank"]),
  value: z.number(),
  observed_at: z.string().min(1),
  source_url: z.string().min(1),
});

const relationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum([
    "COMPETES_IN",
    "FOUNDED",
    "WORKED_AT",
    "INVESTED_IN",
    "HAS_FEATURE",
    "SHIPPED",
    "SHIPPED_AFTER",
    "TARGETS",
    "RELEVANT_TO",
    "CITED_BY",
    "RAISED",
    "PARTICIPATED_IN",
    "HAD_SNAPSHOT",
    "NEXT_SNAPSHOT",
    "POSTED",
    "ABOUT",
    "CLAIMS_MOAT",
    "EVIDENCED_BY",
    "HAS_TRACTION",
  ]),
  props: propsSchema,
  source_url: z.string().min(1),
});

export const extractedBatchSchema = z.object({
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

/** An ExtractedBatch with every array empty. */
export function emptyBatch(): ExtractedBatch {
  return {
    companies: [],
    founders: [],
    investors: [],
    features: [],
    launches: [],
    segments: [],
    funding_rounds: [],
    snapshots: [],
    posts: [],
    moat_claims: [],
    traction_signals: [],
    relationships: [],
  };
}

/**
 * Validate an unknown value as ExtractedBatch. Throws ZodError on failure
 * (callers use the error message for the retry prompt).
 */
export function parseExtractedBatch(value: unknown): ExtractedBatch {
  return extractedBatchSchema.parse(value) as ExtractedBatch;
}

/* ------------------------------------------------------------------ */
/* Extraction prompt                                                   */
/* ------------------------------------------------------------------ */

export const EXTRACTION_SYSTEM_PROMPT = [
  "You are the entity-extraction stage of a competitive-landscape pipeline.",
  "Input: JSON with { idea, tags, raw_documents: [{ url, source_type, title, text, date? }] }.",
  "Output: ONLY a single JSON object matching the ExtractedBatch schema below. No markdown, no prose, no code fences.",
  "",
  "Schema (all arrays required, empty when nothing found):",
  '{"companies":[{"name","url?","description?","stage?","founded_year?","hq?","status?(active|dead|acquired)","source_url"}],',
  '"founders":[{"name","linkedin_url?","background_summary?","source_url"}],',
  '"investors":[{"name","type?(VC|angel|accelerator)","notable?","source_url"}],',
  '"features":[{"name","category?","description?","source_url"}],',
  '"launches":[{"event_id","title","date?","source?","url?","source_url"}],',
  '"segments":[{"name","source_url"}],',
  '"funding_rounds":[{"round_id","round_type","amount_usd?","announced_date?","source_url"}],',
  '"snapshots":[{"snapshot_id","url","captured_at","positioning_summary?","digest?","source_url"}],',
  '"posts":[{"title","url","platform(HN|PH|blog|GitHub)","posted_at?","source_url"}],',
  '"moat_claims":[{"claim_id","type(network-effects|data|distribution|brand|switching-costs)","summary","confidence","source_url"}],',
  '"traction_signals":[{"signal_id","metric(users|stars|votes|app_ratings|web_rank)","value","observed_at","source_url"}],',
  '"relationships":[{"from","to","type","props?","source_url"}]}',
  "",
  "Relationship types and their endpoints (from -> to, both are the natural keys of entities in THIS batch):",
  "COMPETES_IN Company->Segment, FOUNDED Founder->Company, WORKED_AT Founder->Company,",
  "INVESTED_IN Investor->Company, HAS_FEATURE Company->Feature, SHIPPED Company->LaunchEvent(event_id),",
  "SHIPPED_AFTER LaunchEvent->LaunchEvent, TARGETS Company->Segment, RELEVANT_TO Company->Idea,",
  "RAISED Company->FundingRound(round_id), PARTICIPATED_IN Investor->FundingRound,",
  "HAD_SNAPSHOT Company->WebsiteSnapshot(snapshot_id), NEXT_SNAPSHOT WebsiteSnapshot->WebsiteSnapshot,",
  "POSTED Founder->Post(url), ABOUT Post->Company, CLAIMS_MOAT Company->MoatClaim(claim_id),",
  "HAS_TRACTION Company->TractionSignal(signal_id).",
  "",
  "Hard rules:",
  "1. Every entity MUST carry source_url copied verbatim from the url of the input document it came from. Never invent URLs.",
  "2. Every relationship MUST carry props.confidence, a number 0-1 reflecting how directly the document supports it.",
  "3. Unknown or unstated fields are null. NEVER guess values. Omitting a fact is always better than inventing one.",
  "4. Composite ids: round_id = \"{company}|{round_type}|{announced_date}\"; snapshot_id = \"{domain}|{timestamp}\"; claim_id = \"{company}|{moat_type}\"; signal_id = \"{company}|{metric}|{observed_at}\"; event_id = \"{company}|{title}\".",
  "5. For RELEVANT_TO, 'to' is the literal idea text from the input; props.relevance_score 0-1.",
  "6. Only extract entities actually present in the documents. Do not add companies from your own knowledge.",
].join("\n");

/* ------------------------------------------------------------------ */
/* Extraction call                                                     */
/* ------------------------------------------------------------------ */

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function buildUserMessage(docs: RawDoc[], idea: string, tags: string[]): string {
  return JSON.stringify({
    idea,
    tags,
    raw_documents: docs.map((d) => ({
      url: d.url,
      source_type: d.source_type,
      title: d.title,
      date: d.date ?? null,
      // Cap per-doc text so a batch of 5 stays inside the context window.
      text: d.text.slice(0, 8000),
    })),
  });
}

/**
 * Extract an ExtractedBatch from a batch of raw documents via the
 * Butterbase gateway. Never throws: on validation failure it retries once
 * with the validation error appended, then drops the batch (empty batch).
 */
export async function extractBatch(
  docs: RawDoc[],
  idea: string,
  tags: string[],
): Promise<ExtractedBatch> {
  if (docs.length === 0) return emptyBatch();
  if (!hasGateway() || env.DEMO_MODE) {
    // Demo insurance: no gateway means no extraction; the conductor's
    // demo path streams fixtures instead.
    return emptyBatch();
  }

  const userMessage = buildUserMessage(docs, idea, tags);
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const messages = [
        { role: "system" as const, content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user" as const, content: userMessage },
      ];
      if (attempt > 0) {
        messages.push({
          role: "user" as const,
          content:
            "Your previous output failed schema validation with this error. Emit corrected ExtractedBatch JSON only.\n" +
            lastError,
        });
      }
      const raw = await chat(messages, { json: true, temperature: 0 });
      const parsed: unknown = JSON.parse(stripFences(raw));
      return parseExtractedBatch(parsed);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      debug(`attempt ${attempt + 1} failed:`, lastError);
    }
  }

  debug("dropping batch after retry", { docs: docs.length });
  return emptyBatch();
}
