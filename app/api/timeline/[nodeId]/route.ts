/**
 * Company timeline enrichment. GET /api/timeline/:nodeId?name=...&url=...
 *
 * Live mode: fans out to the company's follow-up sources (venture news,
 * EDGAR Form D, web search, blog/changelog feed, Wayback) plus an HN
 * sweep, then one gateway call extracts dated timeline events — funding,
 * launches, founder posts, hiring, user milestones, acquisitions. Every
 * event must cite a source URL copied from the fetched docs; events
 * citing unknown URLs are dropped (no orphan facts).
 *
 * Demo mode (or any failure): canned per-company histories from
 * lib/timeline-demo so the popup is complete offline.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env, hasGateway } from "@/lib/env";
import { chatJSON } from "@/lib/gateway";
import { fetchCompanyDocs, searchHn } from "@/lib/sources";
import type { RawDoc } from "@/lib/types";
import {
  sortTimelineEvents,
  TIMELINE_KINDS,
  type TimelineEvent,
  type TimelineEventKind,
} from "@/lib/timeline";
import { demoTimeline } from "@/lib/timeline-demo";

export const dynamic = "force-dynamic";

const MAX_DOCS = 24;
const MAX_DOC_CHARS = 700;

const eventSchema = z.object({
  date: z.string().regex(/^\d{4}(-\d{2}){0,2}$/),
  kind: z.enum(TIMELINE_KINDS as [TimelineEventKind, ...TimelineEventKind[]]),
  title: z.string().min(1).max(160),
  detail: z.string().max(400).optional(),
  actors: z.array(z.string()).max(8).optional(),
  source_url: z.string().min(1),
});

const responseSchema = z.object({
  events: z.array(eventSchema).max(30),
});

function timelineInDemoMode(): boolean {
  return env.DEMO_MODE || !hasGateway();
}

function describeDocs(docs: RawDoc[]): string {
  return docs
    .map(
      (doc, i) =>
        `[${i + 1}] url: ${doc.url}\ndate: ${doc.date ?? "unknown"} | source: ${doc.source_type}\ntitle: ${doc.title}\n${doc.text.slice(0, MAX_DOC_CHARS)}`,
    )
    .join("\n\n");
}

async function extractTimeline(
  companyName: string,
  companyUrl: string | undefined,
): Promise<TimelineEvent[]> {
  const settled = await Promise.allSettled([
    fetchCompanyDocs(companyName, companyUrl),
    searchHn([companyName]),
  ]);
  const docs: RawDoc[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const doc of result.value) {
      if (!doc.url || seen.has(doc.url)) continue;
      seen.add(doc.url);
      docs.push(doc);
    }
  }
  if (docs.length === 0) return [];

  const capped = docs.slice(0, MAX_DOCS);
  const knownUrls = new Set(capped.map((d) => d.url));

  const parsed = responseSchema.parse(
    await chatJSON(
      [
        {
          role: "system",
          content:
            `You reconstruct a startup's full history as dated timeline events from source documents. ` +
            `Event kinds: ${TIMELINE_KINDS.join(", ")}. Rules:\n` +
            `- Extract EVERY dated fact about the company: founding, each funding round (amount + investors in detail), product launches, founder posts, hiring waves / layoffs / key hires / office openings, user or revenue milestones, positioning changes, acquisitions, notable news.\n` +
            `- date is "YYYY", "YYYY-MM", or "YYYY-MM-DD" — use the most precise form the source supports; SKIP facts you cannot date.\n` +
            `- source_url must be copied VERBATIM from the url line of the document the fact came from.\n` +
            `- title is one short factual line (e.g. "Series B — $45M"); detail adds specifics like investors, numbers, names.\n` +
            `- Only facts about ${companyName} itself. No speculation, no duplicate events.\n` +
            `Respond ONLY with JSON: {"events": [{"date": string, "kind": string, "title": string, "detail"?: string, "actors"?: string[], "source_url": string}]}`,
        },
        {
          role: "user",
          content: `Company: ${companyName}${companyUrl ? ` (${companyUrl})` : ""}\n\nDocuments:\n\n${describeDocs(capped)}`,
        },
      ],
      { json: true, temperature: 0.1, purpose: "timeline" },
    ),
  );

  return parsed.events
    .filter((e) => knownUrls.has(e.source_url))
    .map((e, i) => ({
      id: `live:${companyName}:${i}`,
      kind: e.kind,
      date: e.date,
      title: e.title,
      detail: e.detail,
      actors: e.actors,
      source_url: e.source_url,
      origin: "live" as const,
    }));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ nodeId: string }> },
): Promise<NextResponse> {
  await ctx.params; // nodeId reserved for a future Neo4j-backed lookup
  const name = req.nextUrl.searchParams.get("name")?.trim();
  const url = req.nextUrl.searchParams.get("url")?.trim() || undefined;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!timelineInDemoMode()) {
    try {
      const events = await extractTimeline(name, url);
      if (events.length > 0) {
        return NextResponse.json({
          events: sortTimelineEvents(events),
          source: "live",
        });
      }
    } catch (err) {
      if (env.DEBUG) console.error("[api/timeline]", err);
      // fall through to demo fixture
    }
  }

  return NextResponse.json({
    events: sortTimelineEvents(demoTimeline(name)),
    source: "demo",
  });
}
