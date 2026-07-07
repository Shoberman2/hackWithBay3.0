/**
 * Wayback Machine CDX API (no auth) — website positioning history.
 * Monthly-collapsed snapshot list (collapse=timestamp:6), deduped by
 * digest, raw archived HTML via /web/{ts}id_/{url} (id_ strips chrome).
 */

import { isDemoMode } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { debugLog, fetchJson, fetchText, stripHtml, toHost, truncate } from "./support";

const CDX_API = "https://web.archive.org/cdx/search/cdx";
const UA = { "User-Agent": "rivalry-hackathon" };

/** One archived page, ready for WebsiteSnapshot extraction. */
export interface RawSnapshot {
  /** "{domain}|{timestamp}" — matches the WebsiteSnapshot snapshot_id key. */
  snapshot_id: string;
  domain: string;
  /** 14-digit Wayback timestamp (yyyyMMddHHmmss). */
  timestamp: string;
  /** The originally archived URL. */
  original: string;
  digest: string;
  /** ISO-8601 capture time derived from the timestamp. */
  captured_at: string;
  /** Raw-HTML archive URL (with the id_ suffix). */
  archive_url: string;
  /** Tag-stripped page text. */
  text: string;
}

export interface WaybackOptions {
  from?: string; // yyyy
  to?: string; // yyyy
  /** Cap on snapshots fetched (evenly sampled across the range). */
  maxSnapshots?: number;
}

function timestampToIso(ts: string): string {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
}

/** Evenly sample up to n items across a list, always keeping first and last. */
function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  if (n <= 1) return [items[items.length - 1]];
  const out: T[] = [];
  const step = (items.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(items[Math.round(i * step)]);
  return Array.from(new Set(out));
}

const DEMO_SNAPSHOTS: RawSnapshot[] = [
  {
    snapshot_id: "wayup.com|20190301000000",
    domain: "wayup.com",
    timestamp: "20190301000000",
    original: "https://www.wayup.com/",
    digest: "DEMO1",
    captured_at: "2019-03-01T00:00:00.000Z",
    archive_url: "https://web.archive.org/web/20190301000000id_/https://www.wayup.com/",
    text: "WayUp - Jobs and internships for college students and recent grads. Get discovered by employers. Create one profile and let top companies find you.",
  },
  {
    snapshot_id: "wayup.com|20230301000000",
    domain: "wayup.com",
    timestamp: "20230301000000",
    original: "https://www.wayup.com/",
    digest: "DEMO2",
    captured_at: "2023-03-01T00:00:00.000Z",
    archive_url: "https://web.archive.org/web/20230301000000id_/https://www.wayup.com/",
    text: "WayUp - The go-to platform for employers to reach and recruit diverse early-career talent. Source, engage, and hire qualified candidates from underrepresented groups.",
  },
];

/**
 * Monthly-collapsed snapshot history for a domain, digest-deduped, with
 * raw page text fetched and stripped for each kept snapshot.
 */
export async function fetchWaybackSnapshots(
  urlOrDomain: string,
  opts: WaybackOptions = {},
): Promise<RawSnapshot[]> {
  try {
    if (isDemoMode()) return DEMO_SNAPSHOTS;
    const domain = toHost(urlOrDomain);
    if (!domain) return [];
    const { from = "2020", to = "2026", maxSnapshots = 6 } = opts;

    const cdxUrl =
      `${CDX_API}?url=${encodeURIComponent(domain)}&output=json&from=${from}&to=${to}` +
      `&filter=statuscode:200&collapse=timestamp:6&fl=timestamp,original,digest`;
    const rows = await fetchJson<string[][]>(cdxUrl, { headers: UA }, 30000);
    if (!rows || rows.length < 2) return [];

    // First row is the header; dedupe by digest (unchanged pages repeat).
    const seenDigests = new Set<string>();
    const entries: { timestamp: string; original: string; digest: string }[] = [];
    for (const row of rows.slice(1)) {
      const [timestamp, original, digest] = row;
      if (!timestamp || !original || !digest || seenDigests.has(digest)) continue;
      seenDigests.add(digest);
      entries.push({ timestamp, original, digest });
    }

    const kept = sample(entries, maxSnapshots);
    const snapshots: RawSnapshot[] = [];
    for (const entry of kept) {
      const archiveUrl = `https://web.archive.org/web/${entry.timestamp}id_/${entry.original}`;
      const html = await fetchText(archiveUrl, { headers: UA }, 30000);
      if (!html) continue;
      snapshots.push({
        snapshot_id: `${domain}|${entry.timestamp}`,
        domain,
        timestamp: entry.timestamp,
        original: entry.original,
        digest: entry.digest,
        captured_at: timestampToIso(entry.timestamp),
        archive_url: archiveUrl,
        text: truncate(stripHtml(html), 6000),
      });
    }
    return snapshots;
  } catch (err) {
    debugLog("wayback failed", urlOrDomain, err);
    return [];
  }
}

/** RawDoc view of a snapshot (for the generic extraction path). */
export function snapshotToRawDoc(s: RawSnapshot): RawDoc {
  return {
    url: s.archive_url,
    source_type: "wayback",
    title: `${s.domain} homepage as of ${s.captured_at.slice(0, 10)}`,
    text: s.text,
    date: s.captured_at,
  };
}

/** Convenience: snapshot history already shaped as RawDocs. */
export async function fetchWaybackDocs(
  urlOrDomain: string,
  opts: WaybackOptions = {},
): Promise<RawDoc[]> {
  const snapshots = await fetchWaybackSnapshots(urlOrDomain, opts);
  return snapshots.map(snapshotToRawDoc);
}
