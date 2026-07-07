/**
 * GitHub REST (org repos + releases) and GraphQL star history.
 * REST /repos/{o}/{r}/stargazers is GATED (401/404) — star history is
 * GraphQL stargazers(orderBy:{field:STARRED_AT}) ONLY. PAT recommended
 * (60/hr unauth vs 5000/hr with token).
 */

import { env, hasGitHub, isDemoMode } from "@/lib/env";
import type { RawDoc, TractionSignal } from "@/lib/types";
import { debugLog, fetchJson, safeFetch, stripHtml, truncate } from "./support";

const GITHUB_API = "https://api.github.com";

function restHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rivalry-hackathon",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

export interface GithubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description?: string | null;
  stargazers_count?: number;
  updated_at?: string;
  fork?: boolean;
  archived?: boolean;
}

interface GithubRelease {
  name?: string | null;
  tag_name?: string;
  html_url: string;
  body?: string | null;
  published_at?: string | null;
}

/** Repos for an org, most recently updated first. */
export async function fetchOrgRepos(org: string): Promise<GithubRepo[]> {
  try {
    if (isDemoMode()) return [];
    const repos = await fetchJson<GithubRepo[]>(
      `${GITHUB_API}/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated`,
      { headers: restHeaders() },
    );
    return Array.isArray(repos) ? repos.filter((r) => !r.fork) : [];
  } catch (err) {
    debugLog("github org repos failed", org, err);
    return [];
  }
}

/** Releases for one repo as RawDocs (launch/feature signals). */
export async function fetchRepoReleases(
  owner: string,
  repo: string,
  max = 10,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return [];
    const releases = await fetchJson<GithubRelease[]>(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=${max}`,
      { headers: restHeaders() },
    );
    if (!Array.isArray(releases)) return [];
    return releases.map((rel) => ({
      url: rel.html_url,
      source_type: "GitHub" as const,
      title: `${owner}/${repo} release ${rel.name || rel.tag_name || ""}`.trim(),
      text: truncate(
        `${owner}/${repo} shipped release ${rel.name || rel.tag_name || ""}. ${stripHtml(rel.body ?? "")}`.trim(),
        4000,
      ),
      date: rel.published_at ?? undefined,
    }));
  } catch (err) {
    debugLog("github releases failed", owner, repo, err);
    return [];
  }
}

const DEMO_ORG_DOCS: RawDoc[] = [
  {
    url: "https://github.com/simplify-jobs",
    source_type: "GitHub",
    title: "simplify-jobs GitHub org",
    text: "simplify-jobs maintains public repos for its job-application autofill tooling, with regular release cadence on its browser extension.",
  },
];

/**
 * Org activity summary: repo inventory doc + releases for the most
 * recently updated repos.
 */
export async function fetchOrgActivity(
  org: string,
  maxRepos = 3,
): Promise<RawDoc[]> {
  try {
    if (isDemoMode()) return DEMO_ORG_DOCS;
    const repos = await fetchOrgRepos(org);
    if (repos.length === 0) return [];
    const inventory: RawDoc = {
      url: `https://github.com/${org}`,
      source_type: "GitHub",
      title: `${org} GitHub org`,
      text: truncate(
        `GitHub org ${org} public repos: ` +
          repos
            .slice(0, 15)
            .map(
              (r) =>
                `${r.name} (${r.stargazers_count ?? 0} stars${r.description ? `: ${r.description}` : ""})`,
            )
            .join("; "),
        4000,
      ),
    };
    const releaseBatches = await Promise.allSettled(
      repos.slice(0, maxRepos).map((r) => fetchRepoReleases(org, r.name)),
    );
    const docs = [inventory];
    for (const batch of releaseBatches) {
      if (batch.status === "fulfilled") docs.push(...batch.value);
    }
    return docs;
  } catch (err) {
    debugLog("github org activity failed", org, err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Star history (GraphQL only — REST stargazers endpoint is gated)      */
/* ------------------------------------------------------------------ */

const STAR_HISTORY_QUERY = `
query StarHistory($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    stargazerCount
    stargazers(first: 100, orderBy: { field: STARRED_AT, direction: ASC }, after: $after) {
      edges { starredAt }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface StarHistoryResponse {
  data?: {
    repository?: {
      stargazerCount?: number;
      stargazers?: {
        edges?: { starredAt: string }[];
        pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
      };
    } | null;
  };
  errors?: unknown[];
}

/** Cumulative star count sampled monthly. */
export interface StarSample {
  /** ISO date for the end of the month bucket. */
  observed_at: string;
  /** Cumulative stars as of that month (within the paginated window). */
  value: number;
}

const DEMO_STAR_SAMPLES: StarSample[] = [
  { observed_at: "2024-01-31T00:00:00.000Z", value: 120 },
  { observed_at: "2024-07-31T00:00:00.000Z", value: 480 },
  { observed_at: "2025-01-31T00:00:00.000Z", value: 1450 },
];

/**
 * Monthly cumulative star history via GraphQL. Paginates ASC by
 * STARRED_AT up to maxPages*100 stars (older history first). Returns []
 * without a token — the GraphQL endpoint requires auth.
 */
export async function fetchStarHistory(
  owner: string,
  repo: string,
  maxPages = 5,
): Promise<StarSample[]> {
  try {
    if (isDemoMode()) return DEMO_STAR_SAMPLES;
    if (!hasGitHub()) {
      debugLog("github star history skipped: no token");
      return [];
    }
    const starredAts: string[] = [];
    let after: string | null | undefined = undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await safeFetch(`${GITHUB_API}/graphql`, {
        method: "POST",
        headers: { ...restHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          query: STAR_HISTORY_QUERY,
          variables: { owner, name: repo, after: after ?? null },
        }),
      });
      if (!res) break;
      const payload = (await res.json().catch(() => undefined)) as
        | StarHistoryResponse
        | undefined;
      const stargazers = payload?.data?.repository?.stargazers;
      if (!stargazers?.edges) {
        debugLog("github star history payload error", owner, repo, payload?.errors);
        break;
      }
      starredAts.push(...stargazers.edges.map((e) => e.starredAt));
      if (!stargazers.pageInfo?.hasNextPage || !stargazers.pageInfo.endCursor) break;
      after = stargazers.pageInfo.endCursor;
    }
    if (starredAts.length === 0) return [];

    // Bucket by month, cumulative.
    const byMonth = new Map<string, number>();
    for (const iso of starredAts) {
      const month = iso.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    const months = Array.from(byMonth.keys()).sort();
    let cumulative = 0;
    return months.map((month) => {
      cumulative += byMonth.get(month) ?? 0;
      return {
        observed_at: `${month}-28T00:00:00.000Z`,
        value: cumulative,
      };
    });
  } catch (err) {
    debugLog("github star history failed", owner, repo, err);
    return [];
  }
}

/** Shape star samples as TractionSignal rows for a company. */
export function starSamplesToSignals(
  companyName: string,
  owner: string,
  repo: string,
  samples: StarSample[],
): TractionSignal[] {
  return samples.map((s) => ({
    signal_id: `${companyName}|stars|${s.observed_at}`,
    metric: "stars" as const,
    value: s.value,
    observed_at: s.observed_at,
    source_url: `https://github.com/${owner}/${repo}`,
  }));
}
