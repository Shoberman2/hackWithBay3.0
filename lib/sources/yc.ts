/**
 * YC company directory via the yc-oss mirror (no auth, refreshed daily).
 * Endpoint: https://yc-oss.github.io/api/companies/all.json
 * Do NOT scrape ycombinator.com's own Algolia (key rotates).
 */

import { isDemoMode } from "@/lib/env";
import type { Company, RawDoc } from "@/lib/types";
import { debugLog, fetchJson, truncate } from "./support";

const ALL_COMPANIES_URL = "https://yc-oss.github.io/api/companies/all.json";

/** Fields we consume from the yc-oss mirror payload. */
export interface YcCompany {
  id?: number;
  name: string;
  slug: string;
  website?: string;
  one_liner?: string;
  long_description?: string;
  team_size?: number | null;
  batch?: string;
  status?: string; // "Active" | "Inactive" | "Acquired" | "Public"
  tags?: string[];
  industries?: string[];
  regions?: string[];
  stage?: string;
  all_locations?: string;
  launched_at?: number;
}

let companiesCache: YcCompany[] | null = null;
let cachePromise: Promise<YcCompany[]> | null = null;

/** Fetch the full directory once per process (module-scope cache). */
export async function fetchYcCompanies(): Promise<YcCompany[]> {
  if (companiesCache) return companiesCache;
  if (!cachePromise) {
    cachePromise = (async () => {
      const data = await fetchJson<YcCompany[]>(ALL_COMPANIES_URL, {}, 30000);
      companiesCache = Array.isArray(data) ? data : [];
      debugLog("yc directory loaded", companiesCache.length);
      return companiesCache;
    })();
  }
  return cachePromise;
}

export function ycCompanyUrl(c: YcCompany): string {
  return `https://www.ycombinator.com/companies/${c.slug}`;
}

/**
 * Field mapping from a yc-oss directory record to Company node props.
 * YC status "Inactive" maps to "dead"; "Public" stays "active".
 */
export function ycToCompany(c: YcCompany): Company {
  const status =
    c.status === "Acquired"
      ? ("acquired" as const)
      : c.status === "Inactive"
        ? ("dead" as const)
        : ("active" as const);
  return {
    name: c.name,
    url: c.website || undefined,
    description: c.one_liner || c.long_description || undefined,
    stage: c.stage || (c.batch ? `YC ${c.batch}` : undefined),
    hq: c.all_locations || undefined,
    status,
    source_url: ycCompanyUrl(c),
  };
}

function ycCompanyToDoc(c: YcCompany): RawDoc {
  const facts = [
    c.batch ? `YC batch: ${c.batch}.` : "",
    c.status ? `Status: ${c.status}.` : "",
    typeof c.team_size === "number" ? `Team size: ${c.team_size}.` : "",
    c.tags?.length ? `Tags: ${c.tags.join(", ")}.` : "",
    c.industries?.length ? `Industries: ${c.industries.join(", ")}.` : "",
    c.website ? `Website: ${c.website}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    url: ycCompanyUrl(c),
    source_type: "YC",
    title: c.name,
    text: truncate(
      `${c.name}: ${c.one_liner ?? ""} ${c.long_description ?? ""} ${facts}`.trim(),
    ),
  };
}

const DEMO_DOCS: RawDoc[] = [
  {
    url: "https://www.ycombinator.com/companies/simplify",
    source_type: "YC",
    title: "Simplify",
    text: "Simplify: Job applications, simplified. Autofill every application and track your search in one place. YC batch: S20. Status: Active. Tags: recruiting, careers. Website: https://simplify.jobs.",
  },
  {
    url: "https://www.ycombinator.com/companies/abode",
    source_type: "YC",
    title: "Abode",
    text: "Abode: Helps companies engage and retain their Gen Z new hires and interns before day one. YC batch: S22. Status: Active. Tags: hr-tech, internships. Website: https://useabode.com.",
  },
];

/**
 * Relevance score for one company against the search terms: an exact
 * phrase hit counts 2, a term whose every word (len > 2) appears counts 1.
 * Multi-word phrases like "internship platform" rarely occur verbatim in
 * one-liners, so the word-AND fallback is what actually recalls.
 */
export function scoreYcMatch(haystack: string, terms: string[]): number {
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (t.length === 0) continue;
    if (lower.includes(t)) {
      score += 2;
      continue;
    }
    const words = t.split(/\s+/).filter((w) => w.length > 2);
    if (words.length > 1 && words.every((w) => lower.includes(w))) score += 1;
  }
  return score;
}

/**
 * Filter the directory by search terms over one_liner + long_description
 * + tags; returns RawDocs ordered by term-match relevance.
 */
export async function searchYc(
  searchTerms: string[],
  limit = 25,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_DOCS;
    const companies = await fetchYcCompanies();
    const scored = companies
      .map((c) => {
        const haystack = `${c.one_liner ?? ""} ${c.long_description ?? ""} ${(c.tags ?? []).join(" ")}`;
        return { c, score: scoreYcMatch(haystack, searchTerms) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map((s) => ycCompanyToDoc(s.c));
  } catch (err) {
    debugLog("yc search failed", err);
    return [];
  }
}
