/**
 * Entity deduplication and linking against the existing graph.
 *
 * - normalize: lowercase, strip legal suffixes (Inc, Labs, HQ, Co, Ltd,
 *   LLC, Corp, ...), URLs reduced to hostname.
 * - Exact match against a session-scoped map of existing names/urls.
 * - No embedding similarity (out of hackathon scope).
 */

import type { ExtractedBatch, ExtractedRelationship } from "@/lib/types";
import { linkKey } from "@/lib/types";

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "labs",
  "hq",
  "co",
  "corp",
  "corporation",
  "company",
  "ltd",
  "limited",
  "llc",
  "plc",
  "gmbh",
]);

/** Canonical form of an entity name for matching. */
export function normalizeName(name: string): string {
  let tokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Strip trailing legal suffixes ("Yello Co Inc" -> "yello"), but never
  // strip a name down to nothing.
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  return tokens.join(" ");
}

/** Canonical hostname of a URL for matching. */
export function normalizeUrl(url: string): string {
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    ? url
    : `https://${url}`;
  try {
    const host = new URL(withProto).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url.trim().toLowerCase();
  }
}

export interface ExistingEntities {
  /** normalized name -> canonical name already in the graph */
  names: Map<string, string>;
  /** normalized hostname -> canonical name already in the graph */
  urls: Map<string, string>;
}

/** Fresh session-scoped entity map. */
export function emptyExisting(): ExistingEntities {
  return { names: new Map(), urls: new Map() };
}

/**
 * Record a (deduped) batch's entities into the session map so later
 * batches in the same run resolve to the same canonical names.
 */
export function absorbBatch(
  existing: ExistingEntities,
  batch: ExtractedBatch,
): void {
  const named = [
    ...batch.companies,
    ...batch.founders,
    ...batch.investors,
    ...batch.features,
    ...batch.segments,
  ];
  for (const entity of named) {
    const key = normalizeName(entity.name);
    if (!existing.names.has(key)) existing.names.set(key, entity.name);
  }
  for (const company of batch.companies) {
    if (company.url) {
      const key = normalizeUrl(company.url);
      if (!existing.urls.has(key)) existing.urls.set(key, company.name);
    }
  }
}

/**
 * Canonicalize + within-batch dedupe one name-keyed entity list.
 * Later duplicates fill missing fields on the first occurrence.
 */
function dedupeNamed<T extends { name: string; url?: string }>(
  entities: T[],
  existing: ExistingEntities,
  rename: Map<string, string>,
): T[] {
  const byKey = new Map<string, T>();
  for (const original of entities) {
    const entity = { ...original };
    const normalized = normalizeName(entity.name);
    const canonical =
      existing.names.get(normalized) ??
      (entity.url ? existing.urls.get(normalizeUrl(entity.url)) : undefined);
    if (canonical && canonical !== entity.name) {
      rename.set(entity.name, canonical);
      entity.name = canonical;
    }
    const key = normalizeName(entity.name);
    const kept = byKey.get(key);
    if (!kept) {
      byKey.set(key, entity);
    } else {
      // Merge: fill fields the kept copy is missing.
      const keptRecord = kept as unknown as Record<string, unknown>;
      for (const [prop, value] of Object.entries(entity)) {
        if (keptRecord[prop] === undefined && value !== undefined) {
          keptRecord[prop] = value;
        }
      }
    }
  }
  return [...byKey.values()];
}

/** Within-batch dedupe of id/url-keyed entity lists (no canonicalization). */
function dedupeById<T>(entities: T[], idField: keyof T): T[] {
  const byId = new Map<unknown, T>();
  for (const entity of entities) {
    if (!byId.has(entity[idField])) byId.set(entity[idField], entity);
  }
  return [...byId.values()];
}

function rewriteRelationships(
  relationships: ExtractedRelationship[],
  rename: Map<string, string>,
): ExtractedRelationship[] {
  const seen = new Set<string>();
  const result: ExtractedRelationship[] = [];
  for (const original of relationships) {
    const rel: ExtractedRelationship = {
      ...original,
      from: rename.get(original.from) ?? original.from,
      to: rename.get(original.to) ?? original.to,
    };
    const key = linkKey({ source: rel.from, target: rel.to, type: rel.type });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(rel);
  }
  return result;
}

/**
 * Rewrite batch entity keys to canonical names where a match exists and
 * drop exact duplicates within the batch itself. Pure: returns a new batch.
 */
export function dedupeBatch(
  batch: ExtractedBatch,
  existing: ExistingEntities,
): ExtractedBatch {
  const rename = new Map<string, string>();
  const companies = dedupeNamed(batch.companies, existing, rename);
  const founders = dedupeNamed(batch.founders, existing, rename);
  const investors = dedupeNamed(batch.investors, existing, rename);
  const features = dedupeNamed(batch.features, existing, rename);
  const segments = dedupeNamed(batch.segments, existing, rename);

  return {
    companies,
    founders,
    investors,
    features,
    segments,
    launches: dedupeById(batch.launches, "event_id"),
    funding_rounds: dedupeById(batch.funding_rounds, "round_id"),
    snapshots: dedupeById(batch.snapshots, "snapshot_id"),
    posts: dedupeById(batch.posts, "url"),
    moat_claims: dedupeById(batch.moat_claims, "claim_id"),
    traction_signals: dedupeById(batch.traction_signals, "signal_id"),
    relationships: rewriteRelationships(batch.relationships, rename),
  };
}
