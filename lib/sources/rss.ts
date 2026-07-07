/**
 * Blog/changelog feed discovery + parsing for discovered companies and
 * founders. Discovery order per PLAN.md Phase 0.2:
 *   1. homepage <link rel="alternate" type="application/rss+xml|atom+xml">
 *   2. path probes: /feed, /rss.xml, /atom.xml, /feed.xml, /index.xml, /rss/
 *   3. platform patterns: medium.com/feed/@user, {name}.substack.com/feed,
 *      github.com/{user}.atom
 * Candidates are validated by sniffing the body for <rss or <feed, never
 * by status code alone.
 */

import Parser from "rss-parser";
import { isDemoMode } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { debugLog, fetchText, stripHtml, truncate } from "./support";

const PROBE_PATHS = ["/feed", "/rss.xml", "/atom.xml", "/feed.xml", "/index.xml", "/rss/"];

const parser = new Parser({
  headers: { "User-Agent": "rivalry-hackathon" },
  timeout: 15000,
});

/** True when a body is actually a feed (sniff, don't trust the 200). */
export function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 2000).toLowerCase();
  return head.includes("<rss") || head.includes("<feed");
}

function extractAlternateLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/rel=["']?alternate["']?/i.test(tag)) continue;
    if (!/type=["']?application\/(rss|atom)\+xml["']?/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      links.push(new URL(href, baseUrl).toString());
    } catch {
      // unresolvable href — skip
    }
  }
  return links;
}

export interface FeedDiscoveryHints {
  /** medium.com/feed/@{mediumUser} */
  mediumUser?: string;
  /** {substackName}.substack.com/feed */
  substackName?: string;
  /** github.com/{githubUser}.atom */
  githubUser?: string;
}

/**
 * Discover valid feed URLs for a website, in PLAN.md priority order.
 * Every candidate is fetched and body-sniffed before being returned.
 */
export async function discoverFeeds(
  websiteUrl: string,
  hints: FeedDiscoveryHints = {},
  maxFeeds = 2,
): Promise<string[]> {
  try {
    if (isDemoMode()) return [];
    const base = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    let origin: string;
    try {
      origin = new URL(base).origin;
    } catch {
      return [];
    }

    const candidates: string[] = [];
    // 1. rel=alternate links on the homepage (the real standard).
    const homepage = await fetchText(base, { headers: { "User-Agent": "rivalry-hackathon" } });
    if (homepage) candidates.push(...extractAlternateLinks(homepage, base));
    // 2. conventional path probes.
    candidates.push(...PROBE_PATHS.map((p) => `${origin}${p}`));
    // 3. platform patterns.
    if (hints.mediumUser) candidates.push(`https://medium.com/feed/@${hints.mediumUser}`);
    if (hints.substackName) candidates.push(`https://${hints.substackName}.substack.com/feed`);
    if (hints.githubUser) candidates.push(`https://github.com/${hints.githubUser}.atom`);

    const valid: string[] = [];
    const tried = new Set<string>();
    for (const candidate of candidates) {
      if (valid.length >= maxFeeds) break;
      if (tried.has(candidate)) continue;
      tried.add(candidate);
      const body = await fetchText(candidate, {
        headers: { "User-Agent": "rivalry-hackathon" },
      });
      if (body && looksLikeFeed(body)) valid.push(candidate);
    }
    return valid;
  } catch (err) {
    debugLog("feed discovery failed", websiteUrl, err);
    return [];
  }
}

const DEMO_DOCS: RawDoc[] = [
  {
    url: "https://joinhandshake.com/blog/students/launching-ai-career-assistant/",
    source_type: "blog",
    title: "Handshake launches AI career assistant for students",
    text: "Handshake launches AI career assistant for students. The new assistant recommends internships and entry-level roles based on a student's profile, courses, and application history.",
    date: "2025-04-22T09:00:00.000Z",
  },
];

/**
 * Discover and parse feeds for one company/founder website; items come
 * back as blog RawDocs (feature releases, positioning language).
 */
export async function fetchFeedDocs(
  websiteUrl: string,
  hints: FeedDiscoveryHints = {},
  maxItemsPerFeed = 10,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_DOCS;
    const feeds = await discoverFeeds(websiteUrl, hints);
    const docs: RawDoc[] = [];
    const seen = new Set<string>();
    for (const feedUrl of feeds) {
      try {
        const feed = await parser.parseURL(feedUrl);
        for (const item of (feed.items ?? []).slice(0, maxItemsPerFeed)) {
          if (!item.link || seen.has(item.link)) continue;
          seen.add(item.link);
          const title = item.title ?? item.link;
          docs.push({
            url: item.link,
            source_type: "blog",
            title,
            text: truncate(
              `${title}. ${stripHtml(item.contentSnippet || item.content || "")}`.trim(),
              4000,
            ),
            date: item.isoDate || item.pubDate || undefined,
          });
        }
      } catch (err) {
        debugLog("feed parse failed", feedUrl, err);
      }
    }
    return docs;
  } catch (err) {
    debugLog("rss failed", websiteUrl, err);
    return [];
  }
}
