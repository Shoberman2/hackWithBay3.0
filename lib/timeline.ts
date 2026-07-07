/**
 * Company timeline engine. Builds a single chronological history for a
 * company from two layers:
 *
 * 1. buildTimelineFromGraph -- pure walk over the in-memory graph:
 *    founding (FOUNDED), funding (RAISED + PARTICIPATED_IN + INVESTED_IN),
 *    launches (SHIPPED), founder posts (POSTED/ABOUT), positioning shifts
 *    (HAD_SNAPSHOT/NEXT_SNAPSHOT), traction milestones (HAS_TRACTION),
 *    and status (acquired / dead).
 * 2. mergeTimelineEvents -- folds live-enriched events (from
 *    /api/timeline/[nodeId]) into the graph layer, deduping by
 *    kind + year + normalized title so the same round or launch never
 *    shows twice.
 *
 * Client-safe: no env access, tolerant of force-sim link mutation
 * (endpoints resolved through endpointId).
 */

import type { GraphLink, GraphNode } from "@/lib/types";
import { endpointId, formatUsd } from "@/components/graph/graph-utils";

export type TimelineEventKind =
  | "founded"
  | "funding"
  | "launch"
  | "post"
  | "traction"
  | "positioning"
  | "hiring"
  | "acquisition"
  | "milestone"
  | "news";

export const TIMELINE_KINDS: readonly TimelineEventKind[] = [
  "founded",
  "funding",
  "launch",
  "post",
  "traction",
  "positioning",
  "hiring",
  "acquisition",
  "milestone",
  "news",
];

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  /** ISO-ish date: YYYY, YYYY-MM, or YYYY-MM-DD. Undated events sort last. */
  date?: string;
  title: string;
  detail?: string;
  /** People / firms attached to the event (founders, investors, posters). */
  actors?: string[];
  source_url?: string;
  /** graph = already in the session graph; live = pulled by enrichment. */
  origin: "graph" | "live";
}

export interface MoatContext {
  id: string;
  type: string;
  summary: string;
  confidence?: number;
  source_url?: string;
}

export interface CompanyTimelineData {
  events: TimelineEvent[];
  moats: MoatContext[];
}

interface GraphShape {
  nodes: GraphNode[];
  links: GraphLink[];
}

/* Sort order inside the same date bucket: story reads founding first. */
const KIND_RANK: Record<TimelineEventKind, number> = {
  founded: 0,
  funding: 1,
  launch: 2,
  post: 3,
  positioning: 4,
  hiring: 5,
  traction: 6,
  milestone: 7,
  news: 8,
  acquisition: 9,
};

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    if (a.date && b.date && a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
}

function compactNumber(value: number): string {
  if (value >= 1e9) return `${trimZero((value / 1e9).toFixed(1))}B`;
  if (value >= 1e6) return `${trimZero((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `${trimZero((value / 1e3).toFixed(1))}K`;
  return String(value);
}

function trimZero(value: string): string {
  return value.replace(/\.0$/, "");
}

const TRACTION_LABEL: Record<string, string> = {
  users: "users",
  stars: "GitHub stars",
  votes: "Product Hunt votes",
  app_ratings: "app-store ratings",
  web_rank: "web traffic rank",
};

function tractionTitle(metric: string, value: number): string {
  if (metric === "web_rank") {
    return `Web traffic rank #${value.toLocaleString()}`;
  }
  const label = TRACTION_LABEL[metric] ?? metric;
  return `Reaches ${compactNumber(value)} ${label}`;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Everything the graph knows about one company, as a sorted event list
 * plus undated moat context.
 */
export function buildTimelineFromGraph(
  companyId: string,
  data: GraphShape,
): CompanyTimelineData {
  const nodeById = new Map<string, GraphNode>();
  for (const n of data.nodes) nodeById.set(n.id, n);
  const company = nodeById.get(companyId);
  if (!company) return { events: [], moats: [] };

  const events: TimelineEvent[] = [];
  const moats: MoatContext[] = [];

  /* Index incident links once; resolve sim-mutated endpoints. */
  const incident = data.links.filter(
    (l) =>
      endpointId(l.source) === companyId || endpointId(l.target) === companyId,
  );

  /* -------------------------- founding -------------------------- */
  const founders: Array<{ name: string; role?: string; year?: number }> = [];
  for (const link of incident) {
    if (link.type !== "FOUNDED" || endpointId(link.target) !== companyId)
      continue;
    const founder = nodeById.get(endpointId(link.source));
    if (!founder) continue;
    founders.push({
      name: founder.name,
      role: str(link.props?.role),
      year:
        typeof link.props?.year === "number" ? link.props.year : undefined,
    });
  }
  const foundedYear =
    typeof company.founded_year === "number"
      ? company.founded_year
      : founders.find((f) => f.year)?.year;
  if (foundedYear || founders.length > 0) {
    events.push({
      id: `${companyId}|founded`,
      kind: "founded",
      date: foundedYear ? String(foundedYear) : undefined,
      title: `${company.name} founded`,
      detail:
        founders.length > 0
          ? `Founded by ${founders
              .map((f) => (f.role ? `${f.name} (${f.role})` : f.name))
              .join(", ")}${str(company.hq) ? ` — ${company.hq}` : ""}`
          : str(company.hq)
            ? `Founded in ${company.hq}`
            : undefined,
      actors: founders.map((f) => f.name),
      source_url: str(company.source_url),
      origin: "graph",
    });
  }

  /* -------------------------- funding --------------------------- */
  const coveredRounds = new Set<string>(); // "series f|2021"
  for (const link of incident) {
    if (link.type !== "RAISED" || endpointId(link.source) !== companyId)
      continue;
    const round = nodeById.get(endpointId(link.target));
    if (!round) continue;
    const date = str(round.announced_date);
    const roundType = str(round.round_type) ?? round.name;
    const participants = data.links
      .filter(
        (l) =>
          l.type === "PARTICIPATED_IN" &&
          endpointId(l.target) === round.id,
      )
      .map((l) => {
        const investor = nodeById.get(endpointId(l.source));
        if (!investor) return null;
        return l.props?.lead ? `${investor.name} (lead)` : investor.name;
      })
      .filter((name): name is string => Boolean(name));
    const amount =
      typeof round.amount_usd === "number" ? round.amount_usd : undefined;
    coveredRounds.add(
      `${roundType.toLowerCase()}|${(date ?? "").slice(0, 4)}`,
    );
    events.push({
      id: round.id,
      kind: "funding",
      date,
      title: `${roundType} — ${formatUsd(amount)}`,
      detail:
        participants.length > 0
          ? `Investors: ${participants.join(", ")}`
          : undefined,
      actors: participants.map((p) => p.replace(" (lead)", "")),
      source_url: str(round.source_url),
      origin: "graph",
    });
  }

  /* INVESTED_IN edges that describe rounds with no FundingRound node. */
  const looseRounds = new Map<
    string,
    { round: string; year?: number; investors: string[] }
  >();
  for (const link of incident) {
    if (link.type !== "INVESTED_IN" || endpointId(link.target) !== companyId)
      continue;
    const investor = nodeById.get(endpointId(link.source));
    const round = str(link.props?.round);
    if (!investor || !round) continue;
    const year =
      typeof link.props?.year === "number" ? link.props.year : undefined;
    const key = `${round.toLowerCase()}|${year ?? ""}`;
    if (coveredRounds.has(key)) continue;
    const entry = looseRounds.get(key) ?? { round, year, investors: [] };
    entry.investors.push(
      link.props?.lead ? `${investor.name} (lead)` : investor.name,
    );
    looseRounds.set(key, entry);
  }
  for (const [key, entry] of looseRounds) {
    events.push({
      id: `${companyId}|round|${key}`,
      kind: "funding",
      date: entry.year ? String(entry.year) : undefined,
      title: `${entry.round} round`,
      detail: `Investors: ${entry.investors.join(", ")}`,
      actors: entry.investors.map((i) => i.replace(" (lead)", "")),
      source_url: str(company.source_url),
      origin: "graph",
    });
  }

  /* -------------------------- launches -------------------------- */
  for (const link of incident) {
    if (link.type !== "SHIPPED" || endpointId(link.source) !== companyId)
      continue;
    const launch = nodeById.get(endpointId(link.target));
    if (!launch) continue;
    events.push({
      id: launch.id,
      kind: "launch",
      date: str(launch.date),
      title: str(launch.title) ?? launch.name,
      detail: str(launch.source)
        ? `Announced via ${launch.source}`
        : undefined,
      source_url: str(launch.url) ?? str(launch.source_url),
      origin: "graph",
    });
  }

  /* ----------------------- founder posts ------------------------ */
  const posterByPost = new Map<string, string>();
  const aboutByPost = new Map<string, string>();
  for (const l of data.links) {
    if (l.type === "POSTED") {
      const poster = nodeById.get(endpointId(l.source));
      if (poster) posterByPost.set(endpointId(l.target), poster.name);
    }
    if (l.type === "ABOUT") {
      aboutByPost.set(endpointId(l.source), endpointId(l.target));
    }
  }
  const founderIds = new Set(
    incident
      .filter(
        (l) => l.type === "FOUNDED" && endpointId(l.target) === companyId,
      )
      .map((l) => endpointId(l.source)),
  );
  const seenPosts = new Set<string>();
  for (const post of data.nodes) {
    if (post.label !== "Post" || seenPosts.has(post.id)) continue;
    const about = aboutByPost.get(post.id);
    const postedByFounder = data.links.some(
      (l) =>
        l.type === "POSTED" &&
        endpointId(l.target) === post.id &&
        founderIds.has(endpointId(l.source)),
    );
    // A post belongs on this timeline if it is ABOUT the company, or was
    // posted by one of its founders and not about someone else.
    if (about !== companyId && !(postedByFounder && about === undefined))
      continue;
    seenPosts.add(post.id);
    const poster = posterByPost.get(post.id);
    events.push({
      id: post.id,
      kind: "post",
      date: str(post.posted_at),
      title: str(post.title) ?? post.name,
      detail: poster
        ? `Posted by ${poster}${str(post.platform) ? ` on ${post.platform}` : ""}`
        : str(post.platform)
          ? `Posted on ${post.platform}`
          : undefined,
      actors: poster ? [poster] : undefined,
      source_url: str(post.url) ?? str(post.source_url),
      origin: "graph",
    });
  }

  /* ------------------- website positioning ---------------------- */
  const shiftedSnapshots = new Set(
    data.links
      .filter(
        (l) => l.type === "NEXT_SNAPSHOT" && Boolean(l.props?.messaging_changed),
      )
      .map((l) => endpointId(l.target)),
  );
  for (const link of incident) {
    if (link.type !== "HAD_SNAPSHOT" || endpointId(link.source) !== companyId)
      continue;
    const snap = nodeById.get(endpointId(link.target));
    if (!snap) continue;
    events.push({
      id: snap.id,
      kind: "positioning",
      date: str(snap.captured_at),
      title: shiftedSnapshots.has(snap.id)
        ? "Positioning shift on the website"
        : "Website positioning snapshot",
      detail: str(snap.positioning_summary),
      source_url: str(snap.source_url) ?? str(snap.url),
      origin: "graph",
    });
  }

  /* -------------------------- traction -------------------------- */
  for (const link of incident) {
    if (link.type !== "HAS_TRACTION" || endpointId(link.source) !== companyId)
      continue;
    const signal = nodeById.get(endpointId(link.target));
    if (!signal) continue;
    const metric = str(signal.metric) ?? "users";
    const value = typeof signal.value === "number" ? signal.value : 0;
    events.push({
      id: signal.id,
      kind: "traction",
      date: str(signal.observed_at),
      title: tractionTitle(metric, value),
      source_url: str(signal.source_url),
      origin: "graph",
    });
  }

  /* ------------------------ terminal status --------------------- */
  if (company.status === "acquired") {
    events.push({
      id: `${companyId}|acquired`,
      kind: "acquisition",
      title: `${company.name} acquired`,
      detail: "Exit recorded; see sources for acquirer and terms.",
      source_url: str(company.source_url),
      origin: "graph",
    });
  } else if (company.status === "dead") {
    events.push({
      id: `${companyId}|dead`,
      kind: "acquisition",
      title: `${company.name} shut down`,
      source_url: str(company.source_url),
      origin: "graph",
    });
  }

  /* ------------------------ moat context ------------------------ */
  for (const link of incident) {
    if (link.type !== "CLAIMS_MOAT" || endpointId(link.source) !== companyId)
      continue;
    const claim = nodeById.get(endpointId(link.target));
    if (!claim) continue;
    moats.push({
      id: claim.id,
      type: str(claim.type) ?? "moat",
      summary: str(claim.summary) ?? claim.name,
      confidence:
        typeof claim.confidence === "number" ? claim.confidence : undefined,
      source_url: str(claim.source_url),
    });
  }

  return { events: sortTimelineEvents(events), moats };
}

/* ------------------------------------------------------------------ */
/* Merge / dedupe                                                      */
/* ------------------------------------------------------------------ */

const ROUND_TOKEN =
  /(pre-?seed|seed|series [a-h]|accelerator|angel|growth|bridge|ipo)/i;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 48);
}

/** Stable dedupe key: same round/launch/post never appears twice. */
export function timelineEventKey(event: TimelineEvent): string {
  const year = (event.date ?? "").slice(0, 4);
  if (event.kind === "funding") {
    const round = event.title.match(ROUND_TOKEN)?.[1]?.toLowerCase();
    if (round) return `funding|${round.replace(/-/g, "")}|${year}`;
  }
  return `${event.kind}|${year}|${normalizeTitle(event.title)}`;
}

/**
 * Fold live events into the graph layer. Graph events win on key
 * collisions (they are already rendered and sourced); a dated live
 * acquisition replaces the undated graph status stub.
 */
export function mergeTimelineEvents(
  base: TimelineEvent[],
  extra: TimelineEvent[],
): TimelineEvent[] {
  const seen = new Set(base.map(timelineEventKey));
  const fresh = extra.filter((e) => {
    const key = timelineEventKey(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let merged = [...base, ...fresh];
  const datedAcquisition = fresh.some(
    (e) => e.kind === "acquisition" && e.date,
  );
  if (datedAcquisition) {
    merged = merged.filter(
      (e) => !(e.kind === "acquisition" && !e.date && e.origin === "graph"),
    );
  }
  return sortTimelineEvents(merged);
}
