/**
 * Hacker News via the Algolia API (no auth, 10K req/hr/IP, CORS *).
 * search (relevance) + search_by_date per term, plus per-author history
 * for founder posting timelines.
 */

import { isDemoMode } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { debugLog, fetchJson, stripHtml, truncate } from "./support";

const HN_API = "https://hn.algolia.com/api/v1";

interface HnHit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  author?: string | null;
  points?: number | null;
  created_at?: string | null;
  created_at_i?: number | null;
}

interface HnSearchResponse {
  hits?: HnHit[];
}

function hnItemUrl(objectID: string): string {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

function hitToDoc(hit: HnHit): RawDoc {
  const title =
    hit.title || hit.story_title || `HN item ${hit.objectID}`;
  const body = stripHtml(hit.story_text || hit.comment_text || "");
  const meta = [
    hit.author ? `Posted by ${hit.author}.` : "",
    typeof hit.points === "number" ? `${hit.points} points.` : "",
    hit.url ? `Links to ${hit.url}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    url: hit.url || hnItemUrl(hit.objectID),
    source_type: "HN",
    title,
    text: truncate(`${title}. ${body} ${meta}`.trim()),
    date: hit.created_at ?? undefined,
  };
}

const DEMO_DOCS: RawDoc[] = [
  {
    url: "https://news.ycombinator.com/item?id=10000001",
    source_type: "HN",
    title: "Show HN: WayUp - jobs and internships for college students",
    text: "Show HN: WayUp - jobs and internships for college students. We built a marketplace where students create one profile and employers reach out directly. Posted by liztwheeler. 148 points.",
    date: "2015-09-14T15:00:00.000Z",
  },
  {
    url: "https://news.ycombinator.com/item?id=10000002",
    source_type: "HN",
    title: "Show HN: Simplify - autofill every job application",
    text: "Show HN: Simplify - autofill every job application. Chrome extension that autofills internship and new-grad applications and tracks them in one dashboard. Posted by mhanigan. 212 points.",
    date: "2021-06-02T17:30:00.000Z",
  },
];

/**
 * Search HN per term: relevance search over Show HN posts plus recent
 * stories by date, both filtered to points>5. Deduped by objectID/url.
 */
export async function searchHn(
  searchTerms: string[],
  hitsPerQuery = 20,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_DOCS;
    const seen = new Set<string>();
    const docs: RawDoc[] = [];
    for (const term of searchTerms) {
      const q = encodeURIComponent(term);
      const urls = [
        `${HN_API}/search?query=${q}&tags=show_hn&numericFilters=points%3E5&hitsPerPage=${hitsPerQuery}`,
        `${HN_API}/search_by_date?query=${q}&tags=story&numericFilters=points%3E5&hitsPerPage=${hitsPerQuery}`,
      ];
      const results = await Promise.allSettled(
        urls.map((u) => fetchJson<HnSearchResponse>(u)),
      );
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value?.hits) continue;
        for (const hit of r.value.hits) {
          if (seen.has(hit.objectID)) continue;
          seen.add(hit.objectID);
          docs.push(hitToDoc(hit));
        }
      }
    }
    return docs;
  } catch (err) {
    debugLog("hn search failed", err);
    return [];
  }
}

const DEMO_AUTHOR_DOCS: RawDoc[] = [
  {
    url: "https://news.ycombinator.com/item?id=10000003",
    source_type: "HN",
    title: "Ask HN: How do you hire interns without a university pipeline?",
    text: "Ask HN: How do you hire interns without a university pipeline? Posted by demo_founder. We are a 15-person startup and career fairs are priced for the Fortune 500.",
    date: "2024-02-10T19:00:00.000Z",
  },
];

/**
 * Full posting history (stories + comments) for one HN username.
 * Uses search_by_date with tags=(story,comment),author_{username} and
 * paginates by created_at_i (the page param is depth-capped upstream).
 */
export async function fetchAuthorHistory(
  username: string,
  maxItems = 200,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_AUTHOR_DOCS;
    const docs: RawDoc[] = [];
    const seen = new Set<string>();
    let oldest: number | undefined;
    while (docs.length < maxItems) {
      const filters = oldest !== undefined ? `&numericFilters=created_at_i%3C${oldest}` : "";
      const url = `${HN_API}/search_by_date?tags=(story,comment),author_${encodeURIComponent(username)}&hitsPerPage=1000${filters}`;
      const page = await fetchJson<HnSearchResponse>(url);
      const hits = page?.hits ?? [];
      if (hits.length === 0) break;
      for (const hit of hits) {
        if (seen.has(hit.objectID)) continue;
        seen.add(hit.objectID);
        docs.push(hitToDoc(hit));
        if (typeof hit.created_at_i === "number") {
          oldest = oldest === undefined ? hit.created_at_i : Math.min(oldest, hit.created_at_i);
        }
      }
      if (oldest === undefined || hits.length < 1000) break;
    }
    return docs.slice(0, maxItems);
  } catch (err) {
    debugLog("hn author history failed", username, err);
    return [];
  }
}
