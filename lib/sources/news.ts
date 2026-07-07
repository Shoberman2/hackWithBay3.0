/**
 * Funding-announcement feeds (no auth): TechCrunch venture RSS plus a
 * Google News RSS query of "raises" "{company}" per company. Parsed with
 * rss-parser using a custom User-Agent.
 */

import Parser from "rss-parser";
import { isDemoMode } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { debugLog, stripHtml, truncate } from "./support";

const TECHCRUNCH_VENTURE_FEED = "https://techcrunch.com/category/venture/feed/";

const parser = new Parser({
  headers: { "User-Agent": "rivalry-hackathon" },
  timeout: 15000,
});

function itemToDoc(item: {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
}): RawDoc | undefined {
  if (!item.link) return undefined;
  const title = item.title ?? item.link;
  const body = stripHtml(item.contentSnippet || item.content || "");
  return {
    url: item.link,
    source_type: "news",
    title,
    text: truncate(`${title}. ${body}`.trim(), 4000),
    date: item.isoDate || item.pubDate || undefined,
  };
}

async function parseFeed(url: string): Promise<RawDoc[]> {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items ?? [])
      .map(itemToDoc)
      .filter((d): d is RawDoc => d !== undefined);
  } catch (err) {
    debugLog("news feed failed", url, err);
    return [];
  }
}

function googleNewsRaisesUrl(company: string): string {
  const q = encodeURIComponent(`"raises" "${company}"`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

const DEMO_DOCS: RawDoc[] = [
  {
    url: "https://techcrunch.com/2022/01/20/handshake-series-f/",
    source_type: "news",
    title: "Handshake raises $200M Series F to connect students with employers",
    text: "Handshake raises $200M Series F to connect students with employers. The round was led by EQT Ventures with participation from General Catalyst, Kleiner Perkins, and True Ventures.",
    date: "2022-01-20T14:00:00.000Z",
  },
  {
    url: "https://techcrunch.com/2021/05/12/ripplematch-series-b/",
    source_type: "news",
    title: "RippleMatch raises Series B for automated early-career recruiting",
    text: "RippleMatch raises Series B for automated early-career recruiting. The company matches college students to internships and entry-level roles automatically.",
    date: "2021-05-12T12:00:00.000Z",
  },
];

/**
 * Venture press for a set of companies: the TechCrunch venture feed once
 * plus one Google News "raises" query per company, all settled in
 * parallel and deduped by URL.
 */
export async function fetchVentureNews(
  companies: string[],
  maxPerCompany = 5,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_DOCS;
    const tasks: Promise<RawDoc[]>[] = [
      parseFeed(TECHCRUNCH_VENTURE_FEED),
      ...companies.map(async (c) =>
        (await parseFeed(googleNewsRaisesUrl(c))).slice(0, maxPerCompany),
      ),
    ];
    const settled = await Promise.allSettled(tasks);
    const seen = new Set<string>();
    const docs: RawDoc[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const doc of result.value) {
        if (seen.has(doc.url)) continue;
        seen.add(doc.url);
        docs.push(doc);
      }
    }
    return docs;
  } catch (err) {
    debugLog("news fetch failed", err);
    return [];
  }
}
