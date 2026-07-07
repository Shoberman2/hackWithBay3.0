/**
 * THE shared contract for Rivalry. Every team imports from here.
 * Domain types mirror README section 4 (node labels + relationship types)
 * exactly. Do not redefine these shapes locally.
 */

/* ------------------------------------------------------------------ */
/* Node labels (README section 4)                                      */
/* ------------------------------------------------------------------ */

export type NodeLabel =
  | "Idea"
  | "Company"
  | "Founder"
  | "Investor"
  | "Feature"
  | "LaunchEvent"
  | "Segment"
  | "Source"
  | "FundingRound"
  | "WebsiteSnapshot"
  | "Post"
  | "MoatClaim"
  | "TractionSignal";

export interface Idea {
  text: string;
  session_id: string;
  created_at: string;
  refined_tags: string[];
}

export type CompanyStatus = "active" | "dead" | "acquired";

export interface Company {
  name: string;
  url?: string;
  description?: string;
  stage?: string;
  founded_year?: number;
  hq?: string;
  status?: CompanyStatus;
  source_url: string;
}

export interface Founder {
  name: string;
  linkedin_url?: string;
  background_summary?: string;
  source_url: string;
}

export type InvestorType = "VC" | "angel" | "accelerator";

export interface Investor {
  name: string;
  type?: InvestorType;
  notable?: string;
  source_url: string;
}

export interface Feature {
  name: string;
  category?: string;
  description?: string;
  source_url: string;
}

export interface LaunchEvent {
  event_id: string;
  title: string;
  date?: string;
  source?: string;
  url?: string;
  source_url: string;
}

export interface Segment {
  name: string;
  source_url: string;
}

export type SourceType = "HN" | "PH" | "GitHub" | "blog" | "YC" | "Clay" | "EDGAR" | "news" | "wayback" | "websearch";

export interface SourceNode {
  url: string;
  type: SourceType;
  fetched_at: string;
}

export interface FundingRound {
  round_id: string; // "{company}|{round_type}|{announced_date}"
  round_type: string;
  amount_usd?: number;
  announced_date?: string;
  source_url: string;
}

export interface WebsiteSnapshot {
  snapshot_id: string; // "{domain}|{timestamp}"
  url: string;
  captured_at: string;
  positioning_summary?: string;
  digest?: string;
  source_url: string;
}

export type PostPlatform = "HN" | "PH" | "blog" | "GitHub";

export interface Post {
  title: string;
  url: string;
  platform: PostPlatform;
  posted_at?: string;
  source_url: string;
}

export type MoatType =
  | "network-effects"
  | "data"
  | "distribution"
  | "brand"
  | "switching-costs";

export interface MoatClaim {
  claim_id: string; // "{company}|{moat_type}"
  type: MoatType;
  summary: string;
  confidence: number; // 0-1
  source_url: string;
}

export type TractionMetric =
  | "users"
  | "stars"
  | "votes"
  | "app_ratings"
  | "web_rank";

export interface TractionSignal {
  signal_id: string; // "{company}|{metric}|{observed_at}"
  metric: TractionMetric;
  value: number;
  observed_at: string;
  source_url: string;
}

/* ------------------------------------------------------------------ */
/* Relationship types (README section 4)                               */
/* ------------------------------------------------------------------ */

export type RelationshipType =
  | "COMPETES_IN" // Company -> Segment {confidence}
  | "FOUNDED" // Founder -> Company {year, role}
  | "WORKED_AT" // Founder -> Company {years, role}
  | "INVESTED_IN" // Investor -> Company {round, year, lead}
  | "HAS_FEATURE" // Company -> Feature {first_seen}
  | "SHIPPED" // Company -> LaunchEvent
  | "SHIPPED_AFTER" // LaunchEvent -> LaunchEvent {lag_days}
  | "TARGETS" // Company -> Segment
  | "RELEVANT_TO" // Company -> Idea {relevance_score}
  | "CITED_BY" // LaunchEvent -> Source
  | "RAISED" // Company -> FundingRound
  | "PARTICIPATED_IN" // Investor -> FundingRound {lead}
  | "HAD_SNAPSHOT" // Company -> WebsiteSnapshot
  | "NEXT_SNAPSHOT" // WebsiteSnapshot -> WebsiteSnapshot {messaging_changed}
  | "POSTED" // Founder -> Post
  | "ABOUT" // Post -> Company
  | "CLAIMS_MOAT" // Company -> MoatClaim
  | "EVIDENCED_BY" // MoatClaim -> Source
  | "HAS_TRACTION"; // Company -> TractionSignal

export interface ExtractedRelationship {
  /** Natural key of the source entity (e.g. company name, round_id). */
  from: string;
  /** Natural key of the target entity. */
  to: string;
  type: RelationshipType;
  props?: Record<string, string | number | boolean | null>;
  source_url: string;
}

/* ------------------------------------------------------------------ */
/* Pipeline shapes                                                     */
/* ------------------------------------------------------------------ */

/** Raw document collected by a source connector, input to extraction. */
export interface RawDoc {
  url: string;
  source_type: SourceType;
  title: string;
  text: string;
  date?: string;
}

/**
 * Output of the extraction stage (RocketRide pipeline). One array per
 * node label plus relationships. Every entity carries source_url —
 * the writer enforces "no orphan facts."
 */
export interface ExtractedBatch {
  companies: Company[];
  founders: Founder[];
  investors: Investor[];
  features: Feature[];
  launches: LaunchEvent[];
  segments: Segment[];
  funding_rounds: FundingRound[];
  snapshots: WebsiteSnapshot[];
  posts: Post[];
  moat_claims: MoatClaim[];
  traction_signals: TractionSignal[];
  relationships: ExtractedRelationship[];
}

/* ------------------------------------------------------------------ */
/* Graph view shapes (react-force-graph)                               */
/* ------------------------------------------------------------------ */

export interface GraphNode {
  id: string;
  label: NodeLabel;
  name: string;
  /** Louvain community index (written by insight pass). */
  community?: number;
  /** PageRank score (written by insight pass). */
  pagerank?: number;
  source_url?: string;
  /** Any additional label-specific properties. */
  [key: string]: unknown;
}

export interface GraphLink {
  source: string;
  target: string;
  type: RelationshipType;
  props?: Record<string, string | number | boolean | null>;
}

/** Stable key for a link: `${source}|${type}|${target}`. */
export function linkKey(link: Pick<GraphLink, "source" | "target" | "type">): string {
  return `${link.source}|${link.type}|${link.target}`;
}

/* ------------------------------------------------------------------ */
/* Streaming events (pipeline -> SSE -> frontend)                      */
/* ------------------------------------------------------------------ */

export type PipelineStage =
  | "expand"
  | "discover"
  | "extract"
  | "dedupe"
  | "write"
  | "insight";

export type PipelineEvent =
  | { type: "status"; stage: PipelineStage; message: string }
  | { type: "entity"; nodes: GraphNode[]; links: GraphLink[] }
  | { type: "insight"; card: InsightCard }
  | { type: "done" };

/* ------------------------------------------------------------------ */
/* Insight cards                                                       */
/* ------------------------------------------------------------------ */

export type InsightKind =
  | "investor-collision"
  | "white-space"
  | "table-stakes"
  | "boss-node"
  | "positioning-drift"
  | "moat";

export interface InsightCard {
  kind: InsightKind;
  title: string;
  body: string;
  highlight: {
    nodeIds: string[];
    /** Keys produced by linkKey(). */
    linkKeys: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Agent shapes                                                        */
/* ------------------------------------------------------------------ */

/** Output of the onboarding interview agent. */
export interface OnboardingResult {
  refined_idea: string;
  tags: string[];
  search_terms: string[];
}

/** Output of the Q&A (text2Cypher) agent. */
export interface AgentAnswer {
  answer: string;
  cypher?: string;
  highlight?: {
    nodeIds: string[];
    linkKeys: string[];
  };
}
