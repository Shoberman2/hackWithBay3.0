/**
 * Shared constants and helpers for the graph UI. Client-safe, no env access.
 * Colors mirror the CSS tokens in app/globals.css (canvas drawing cannot
 * read CSS variables cheaply, so the hex values are duplicated here on
 * purpose -- keep them in sync with globals.css).
 */

import type { InsightKind, NodeLabel } from "@/lib/types";

/* Node fill colors, keyed by label. Desaturated per the design system. */
export const NODE_COLORS: Record<NodeLabel, string> = {
  Idea: "#1E6B4F",
  Company: "#4F6D9E",
  Founder: "#3E8E68",
  Investor: "#B8863B",
  Feature: "#6B7280",
  LaunchEvent: "#A85D6E",
  Segment: "#4E8E96",
  Source: "#A3A19C",
  FundingRound: "#8F7A4E",
  WebsiteSnapshot: "#7A8699",
  Post: "#83729B",
  MoatClaim: "#9C6B55",
  TractionSignal: "#5C8B7E",
};

/* Canonical display order + human names for legend and badges. */
export const LABEL_ORDER: NodeLabel[] = [
  "Idea",
  "Company",
  "Founder",
  "Investor",
  "Feature",
  "Segment",
  "LaunchEvent",
  "FundingRound",
  "WebsiteSnapshot",
  "Post",
  "MoatClaim",
  "TractionSignal",
  "Source",
];

export const LABEL_TEXT: Record<NodeLabel, string> = {
  Idea: "Idea",
  Company: "Company",
  Founder: "Founder",
  Investor: "Investor",
  Feature: "Feature",
  Segment: "Segment",
  LaunchEvent: "Launch",
  FundingRound: "Funding round",
  WebsiteSnapshot: "Snapshot",
  Post: "Post",
  MoatClaim: "Moat claim",
  TractionSignal: "Traction",
  Source: "Source",
};

/* Pastel badge wash per label (Tailwind classes from the @theme tokens). */
export const LABEL_WASH: Record<NodeLabel, string> = {
  Idea: "bg-wash-green",
  Company: "bg-wash-blue",
  Founder: "bg-wash-green",
  Investor: "bg-wash-yellow",
  Feature: "bg-surface border border-line",
  Segment: "bg-wash-blue",
  LaunchEvent: "bg-wash-red",
  FundingRound: "bg-wash-yellow",
  WebsiteSnapshot: "bg-surface border border-line",
  Post: "bg-wash-blue",
  MoatClaim: "bg-wash-red",
  TractionSignal: "bg-wash-green",
  Source: "bg-surface border border-line",
};

/* Insight card metadata: display label + pastel wash per kind. */
export const INSIGHT_META: Record<InsightKind, { label: string; wash: string }> = {
  "investor-collision": { label: "Investor collision", wash: "bg-wash-red" },
  "white-space": { label: "White space", wash: "bg-wash-green" },
  "table-stakes": { label: "Table stakes", wash: "bg-wash-yellow" },
  "boss-node": { label: "Center of gravity", wash: "bg-wash-blue" },
  "positioning-drift": { label: "Positioning drift", wash: "bg-wash-yellow" },
  moat: { label: "Moat claim", wash: "bg-wash-green" },
};

/* Faint halo tints for Louvain communities (desaturated, low alpha). */
export const COMMUNITY_TINTS = [
  "rgba(79, 109, 158, 0.16)",
  "rgba(62, 142, 104, 0.16)",
  "rgba(184, 134, 59, 0.16)",
  "rgba(168, 93, 110, 0.16)",
  "rgba(78, 142, 150, 0.16)",
  "rgba(107, 114, 128, 0.16)",
];

/**
 * the graph view mutates link.source/link.target from id strings to node
 * object references once the simulation ingests them. Always resolve through
 * this helper before comparing endpoints.
 */
export function endpointId(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return String((value as { id?: unknown }).id ?? "");
  }
  return String(value ?? "");
}

/** linkKey() that tolerates object-mutated endpoints. */
export function linkKeyOf(link: {
  source: unknown;
  target: unknown;
  type: string;
}): string {
  return `${endpointId(link.source)}|${link.type}|${endpointId(link.target)}`;
}

/**
 * Human-readable edge labels, phrased so `from → to` reads as a sentence:
 * "Kleiner Perkins invested in Handshake", "Garrett Lord founded Handshake".
 * Idea/segment plumbing edges map to "" so the base ring stays uncluttered.
 */
export const REL_LABEL: Record<string, string> = {
  INVESTED_IN: "invested in",
  PARTICIPATED_IN: "backed",
  RAISED: "raised",
  FOUNDED: "founded",
  WORKED_AT: "worked at",
  HAS_FEATURE: "ships",
  SHIPPED: "launched",
  SHIPPED_AFTER: "after",
  HAS_TRACTION: "traction",
  CLAIMS_MOAT: "moat",
  POSTED: "posted",
  ABOUT: "about",
  COMPETES_IN: "",
  TARGETS: "",
  RELEVANT_TO: "",
  CITED_BY: "",
  HAD_SNAPSHOT: "",
  NEXT_SNAPSHOT: "",
  EVIDENCED_BY: "",
};

/** Compact USD formatting for funding amounts: 200000000 -> $200M. */
export function formatUsd(amount?: number): string {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "Undisclosed";
  if (amount >= 1e9) return `$${trimZero((amount / 1e9).toFixed(1))}B`;
  if (amount >= 1e6) return `$${trimZero((amount / 1e6).toFixed(1))}M`;
  if (amount >= 1e3) return `$${trimZero((amount / 1e3).toFixed(1))}K`;
  return `$${amount}`;
}

function trimZero(value: string): string {
  return value.replace(/\.0$/, "");
}
