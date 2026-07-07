/**
 * LLM web search through the Butterbase gateway (lib/gateway.ts chat()).
 * The prompt demands JSON {claims:[{text, source_url}]} for founder /
 * funding / company questions; response is zod-parsed with one retry.
 * No raw provider keys — the gateway is the only LLM path.
 */

import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { chat, type ChatMessage } from "@/lib/gateway";
import type { RawDoc } from "@/lib/types";
import { debugLog, truncate } from "./support";

const ClaimsSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().min(1),
      source_url: z.string().min(1),
    }),
  ),
});

export type WebClaim = z.infer<typeof ClaimsSchema>["claims"][number];

const SYSTEM_PROMPT = [
  "You are a competitive-intelligence researcher answering questions about",
  "startups, founders, investors, and funding using web knowledge.",
  'Respond with ONLY a JSON object of the shape {"claims":[{"text":"...","source_url":"https://..."}]}.',
  "Rules: every claim must be a single verifiable fact; every claim must",
  "carry a real, specific source_url (news article, company page, filing);",
  "if you cannot cite a source for a fact, omit the fact; no markdown, no",
  "prose outside the JSON; return an empty claims array when unsure.",
].join(" ");

function extractJson(raw: string): string {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
}

function parseClaims(raw: string): { claims: WebClaim[] } | { error: string } {
  try {
    const parsed = ClaimsSchema.safeParse(JSON.parse(extractJson(raw)));
    if (parsed.success) return { claims: parsed.data.claims };
    return { error: parsed.error.message };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const DEMO_CLAIMS: WebClaim[] = [
  {
    text: "Handshake raised a $200,000,000 Series F led by EQT Ventures, with participation from General Catalyst, Kleiner Perkins, and True Ventures.",
    source_url: "https://joinhandshake.com/blog/our-team/series-f-announcement/",
  },
  {
    text: "Handshake was founded by Garrett Lord, who serves as CEO.",
    source_url: "https://joinhandshake.com/about/",
  },
  {
    text: "WayUp was founded by Liz Wessel and JJ Fliegelman and focused on jobs and internships for college students.",
    source_url: "https://www.wayup.com/about/",
  },
];

/**
 * Ask the gateway a founder/funding/company question; returns validated
 * claims (empty on any failure after one retry).
 */
export async function webSearchClaims(question: string): Promise<WebClaim[]> {
  try {
    if (isDemoMode()) return DEMO_CLAIMS;
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ];
    const first = await chat(messages, { json: true, temperature: 0 });
    const firstParse = parseClaims(first);
    if ("claims" in firstParse) return firstParse.claims;

    debugLog("websearch parse failed, retrying", firstParse.error);
    const retry = await chat(
      [
        ...messages,
        { role: "assistant", content: first },
        {
          role: "user",
          content: `Your previous response failed validation: ${firstParse.error}. Return ONLY valid JSON of the shape {"claims":[{"text":"...","source_url":"https://..."}]} with no other text.`,
        },
      ],
      { json: true, temperature: 0 },
    );
    const retryParse = parseClaims(retry);
    if ("claims" in retryParse) return retryParse.claims;
    debugLog("websearch retry parse failed", retryParse.error);
    return [];
  } catch (err) {
    debugLog("websearch failed", err);
    return [];
  }
}

/** Same search, shaped as RawDocs for the extraction pipeline. */
export async function webSearch(question: string): Promise<RawDoc[]> {
  const claims = await webSearchClaims(question);
  return claims.map((claim) => ({
    url: claim.source_url,
    source_type: "websearch" as const,
    title: question,
    text: truncate(claim.text),
  }));
}
