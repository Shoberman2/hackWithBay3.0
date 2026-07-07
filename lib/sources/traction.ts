/**
 * Traction signals (no auth): Tranco domain-rank history and Apple
 * iTunes Lookup app ratings, shaped directly as TractionSignal rows.
 * Tranco covers the top-1M only — absence is a weak signal, not zero.
 */

import { isDemoMode } from "@/lib/env";
import type { TractionSignal } from "@/lib/types";
import { debugLog, fetchJson, toHost } from "./support";

interface TrancoResponse {
  domain?: string;
  ranks?: { date: string; rank: number }[];
}

interface ItunesLookupResponse {
  resultCount?: number;
  results?: {
    trackName?: string;
    bundleId?: string;
    userRatingCount?: number;
    averageUserRating?: number;
    currentVersionReleaseDate?: string;
    trackViewUrl?: string;
  }[];
}

const DEMO_SIGNALS: TractionSignal[] = [
  {
    signal_id: "Handshake|web_rank|2026-06-30",
    metric: "web_rank",
    value: 8420,
    observed_at: "2026-06-30",
    source_url: "https://tranco-list.eu/api/ranks/domain/joinhandshake.com",
  },
  {
    signal_id: "Handshake|app_ratings|2026-07-01",
    metric: "app_ratings",
    value: 21500,
    observed_at: "2026-07-01",
    source_url: "https://itunes.apple.com/lookup?bundleId=com.joinhandshake.app&country=us",
  },
];

/** Evenly sample up to n rank points, always keeping the most recent. */
function sampleRanks(
  ranks: { date: string; rank: number }[],
  n: number,
): { date: string; rank: number }[] {
  if (ranks.length <= n) return ranks;
  const sorted = [...ranks].sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; rank: number }[] = [];
  const step = (sorted.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(sorted[Math.round(i * step)]);
  return out;
}

/** Tranco rank history for a company's domain as web_rank signals. */
export async function fetchTrancoSignals(
  companyName: string,
  urlOrDomain: string,
  maxPoints = 4,
): Promise<TractionSignal[]> {
  try {
    if (isDemoMode()) {
      return DEMO_SIGNALS.filter((s) => s.metric === "web_rank");
    }
    const domain = toHost(urlOrDomain);
    if (!domain) return [];
    const apiUrl = `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`;
    const payload = await fetchJson<TrancoResponse>(apiUrl);
    const ranks = payload?.ranks ?? [];
    if (ranks.length === 0) return [];
    return sampleRanks(ranks, maxPoints).map((r) => ({
      signal_id: `${companyName}|web_rank|${r.date}`,
      metric: "web_rank" as const,
      value: r.rank,
      observed_at: r.date,
      source_url: apiUrl,
    }));
  } catch (err) {
    debugLog("tranco failed", urlOrDomain, err);
    return [];
  }
}

/** iTunes Lookup app-rating count (and implicit rating) as app_ratings signals. */
export async function fetchAppStoreSignals(
  companyName: string,
  bundleId: string,
): Promise<TractionSignal[]> {
  try {
    if (isDemoMode()) {
      return DEMO_SIGNALS.filter((s) => s.metric === "app_ratings");
    }
    const apiUrl = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=us`;
    const payload = await fetchJson<ItunesLookupResponse>(apiUrl);
    const app = payload?.results?.[0];
    if (!app || typeof app.userRatingCount !== "number") return [];
    const observedAt = new Date().toISOString().slice(0, 10);
    return [
      {
        signal_id: `${companyName}|app_ratings|${observedAt}`,
        metric: "app_ratings" as const,
        value: app.userRatingCount,
        observed_at: observedAt,
        source_url: app.trackViewUrl || apiUrl,
      },
    ];
  } catch (err) {
    debugLog("itunes lookup failed", bundleId, err);
    return [];
  }
}

/** All available traction signals for one company (settled in parallel). */
export async function fetchTractionSignals(
  companyName: string,
  opts: { domain?: string; bundleId?: string },
): Promise<TractionSignal[]> {
  try {
    if (isDemoMode()) return DEMO_SIGNALS;
    const tasks: Promise<TractionSignal[]>[] = [];
    if (opts.domain) tasks.push(fetchTrancoSignals(companyName, opts.domain));
    if (opts.bundleId) tasks.push(fetchAppStoreSignals(companyName, opts.bundleId));
    const settled = await Promise.allSettled(tasks);
    return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  } catch (err) {
    debugLog("traction failed", companyName, err);
    return [];
  }
}
