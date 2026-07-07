/**
 * Data-source connectors (HN Algolia, YC directory mirror, Product Hunt
 * GraphQL, GitHub, RSS, gateway web search, Wayback, EDGAR, news RSS,
 * traction). Owner: sources team.
 *
 * Guarantees:
 * - Every connector is async, returns RawDoc[] (or typed extras), and
 *   never throws — failures log behind env.DEBUG and resolve to [].
 * - Aggregators fan out with Promise.allSettled: one dead source never
 *   kills the pipeline.
 * - In demo mode every connector returns a small canned sample so the
 *   pipeline runs end-to-end offline with zero credentials.
 * - Endpoint blacklist (LinkedIn, X, Crunchbase, YC Algolia scraping,
 *   REST /stargazers) is binding.
 */

import type { RawDoc } from "@/lib/types";
import { debugLog, toHost } from "./support";
import { searchYc } from "./yc";
import { searchHn } from "./hn";
import { searchProductHunt, toTopicSlug } from "./producthunt";
import { webSearch } from "./websearch";
import { fetchVentureNews } from "./news";
import { fetchFeedDocs } from "./rss";
import { fetchWaybackDocs } from "./wayback";
import { searchEdgarFormD } from "./edgar";

/* Barrel exports — one module per source. */
export { fetchYcCompanies, searchYc, ycToCompany, ycCompanyUrl } from "./yc";
export type { YcCompany } from "./yc";
export { searchHn, fetchAuthorHistory } from "./hn";
export { webSearch, webSearchClaims } from "./websearch";
export type { WebClaim } from "./websearch";
export {
  fetchWaybackSnapshots,
  fetchWaybackDocs,
  snapshotToRawDoc,
} from "./wayback";
export type { RawSnapshot, WaybackOptions } from "./wayback";
export { fetchVentureNews } from "./news";
export { searchProductHunt, toTopicSlug } from "./producthunt";
export {
  fetchOrgRepos,
  fetchRepoReleases,
  fetchOrgActivity,
  fetchStarHistory,
  starSamplesToSignals,
} from "./github";
export type { GithubRepo, StarSample } from "./github";
export { searchEdgarFormD } from "./edgar";
export {
  fetchTrancoSignals,
  fetchAppStoreSignals,
  fetchTractionSignals,
} from "./traction";
export { discoverFeeds, fetchFeedDocs, looksLikeFeed } from "./rss";
export type { FeedDiscoveryHints } from "./rss";

export interface SourceQuery {
  idea: string;
  searchTerms: string[];
  tags: string[];
}

export interface DiscoverOptions {
  /** The raw idea text, used to phrase the web-search question. */
  idea?: string;
  /** Product Hunt topic slugs; derived from search terms when omitted. */
  topicSlugs?: string[];
  /** ISO date lower bound for Product Hunt posts. */
  postedAfter?: string;
  /** Per-source result cap (YC/HN). */
  maxDocsPerSource?: number;
}

function dedupeByUrl(docs: RawDoc[]): RawDoc[] {
  const seen = new Set<string>();
  const out: RawDoc[] = [];
  for (const doc of docs) {
    if (!doc.url || seen.has(doc.url)) continue;
    seen.add(doc.url);
    out.push(doc);
  }
  return out;
}

/**
 * Fan out to the discovery sources (YC, HN, Product Hunt, gateway web
 * search) via Promise.allSettled and aggregate, deduped by URL.
 */
export async function discoverAll(
  searchTerms: string[],
  opts: DiscoverOptions = {},
): Promise<RawDoc[]> {
  const terms = searchTerms.filter((t) => t.trim().length > 0);
  if (terms.length === 0) return [];
  const topicSlugs = opts.topicSlugs ?? terms.slice(0, 3).map(toTopicSlug);
  const subject = opts.idea ?? terms.join(", ");
  const question =
    `List the notable startups competing in this space: ${subject}. ` +
    "For each, state what it does, who founded it, and any funding rounds with investors.";

  const settled = await Promise.allSettled([
    searchYc(terms, opts.maxDocsPerSource),
    searchHn(terms),
    searchProductHunt(topicSlugs, terms, opts.postedAfter),
    webSearch(question),
  ]);
  const docs: RawDoc[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") docs.push(...result.value);
    else debugLog("discover source rejected", result.reason);
  }
  return dedupeByUrl(docs);
}

/** Scaffold contract: fan out to every configured connector for a query. */
export async function fetchAllSources(query: SourceQuery): Promise<RawDoc[]> {
  const terms = Array.from(
    new Set(
      [query.idea, ...query.searchTerms, ...query.tags].filter(
        (t) => t && t.trim().length > 0,
      ),
    ),
  );
  return discoverAll(terms, { idea: query.idea });
}

/**
 * Scaffold contract: follow-up docs for one already-discovered company
 * (expand flow) — venture news, blog/changelog feed, Wayback snapshot
 * history, and Form D filings, all settled in parallel.
 */
export async function fetchCompanyDocs(
  companyName: string,
  companyUrl?: string,
): Promise<RawDoc[]> {
  const tasks: Promise<RawDoc[]>[] = [
    fetchVentureNews([companyName]),
    searchEdgarFormD(companyName),
    webSearch(
      `Who founded ${companyName}, what funding rounds has it raised, and which investors participated?`,
    ),
  ];
  if (companyUrl && toHost(companyUrl)) {
    tasks.push(fetchFeedDocs(companyUrl));
    tasks.push(fetchWaybackDocs(companyUrl, { maxSnapshots: 3 }));
  }
  const settled = await Promise.allSettled(tasks);
  const docs: RawDoc[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") docs.push(...result.value);
    else debugLog("company source rejected", result.reason);
  }
  return dedupeByUrl(docs);
}
