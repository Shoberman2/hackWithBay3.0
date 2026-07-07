/**
 * Internal helpers shared by the source connectors. Not part of the
 * public barrel — import from "@/lib/sources" for connectors.
 */

import { env } from "@/lib/env";

/** Debug logger — the only permitted console output, gated by env.DEBUG. */
export function debugLog(...args: unknown[]): void {
  if (env.DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[sources]", ...args);
  }
}

/**
 * fetch that never throws: returns undefined on network error, timeout,
 * or non-2xx status. Every connector goes through this.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      debugLog("fetch non-ok", res.status, url);
      return undefined;
    }
    return res;
  } catch (err) {
    debugLog("fetch failed", url, err);
    return undefined;
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<T | undefined> {
  const res = await safeFetch(url, init, timeoutMs);
  if (!res) return undefined;
  try {
    return (await res.json()) as T;
  } catch (err) {
    debugLog("json parse failed", url, err);
    return undefined;
  }
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<string | undefined> {
  const res = await safeFetch(url, init, timeoutMs);
  if (!res) return undefined;
  try {
    return await res.text();
  } catch (err) {
    debugLog("text read failed", url, err);
    return undefined;
  }
}

/** Strip tags/scripts/styles from HTML and collapse whitespace. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim long document bodies before they hit the extraction LLM. */
export function truncate(text: string, max = 8000): string {
  return text.length <= max ? text : `${text.slice(0, max)} [truncated]`;
}

/** Bare hostname (no www.) for a URL or domain-ish string; undefined if unparseable. */
export function toHost(urlOrDomain: string): string | undefined {
  try {
    const withScheme = /^https?:\/\//i.test(urlOrDomain)
      ? urlOrDomain
      : `https://${urlOrDomain}`;
    return new URL(withScheme).hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

/** Case-insensitive "any search term appears in this haystack" check. */
export function matchesAnyTerm(haystack: string, terms: string[]): boolean {
  const lower = haystack.toLowerCase();
  return terms.some((t) => t.trim().length > 0 && lower.includes(t.toLowerCase()));
}

/** Count how many terms match (for relevance ordering). */
export function termMatchCount(haystack: string, terms: string[]): number {
  const lower = haystack.toLowerCase();
  return terms.filter((t) => t.trim().length > 0 && lower.includes(t.toLowerCase()))
    .length;
}
