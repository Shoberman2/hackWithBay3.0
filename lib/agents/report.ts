/**
 * Paid landscape report. The report route (owned by the Butterbase team)
 * coordinates with this module via types only: it either calls
 * generateReport(sessionId) directly, or builds its own digest and uses
 * buildReportPrompt(digest) + the gateway.
 */

import { chat, type ChatMessage } from "@/lib/gateway";
import { isDemoMode } from "@/lib/env";
import type { InsightCard } from "@/lib/types";
import {
  getSessionGraph,
  sharedInvestors,
  whiteSpaceSegments,
  tableStakesFeatures,
  founderLineage,
  companiesByCommunity,
  moatClaims,
  type SessionGraph,
} from "./graph-facts";
import { buildInsightCards } from "./insights";

/* ------------------------------------------------------------------ */
/* Digest: everything the report needs, gathered deterministically      */
/* ------------------------------------------------------------------ */

export interface ReportDigest {
  refined_idea: string;
  companies: Array<{
    name: string;
    stage?: string;
    status?: string;
    description?: string;
    community?: number;
    pagerank?: number;
    source_url?: string;
  }>;
  communities: Record<string, string[]>;
  shared_investors: Array<{ investor: string; companies: string[] }>;
  founder_lineage: Array<{ origin: string; founders: string[] }>;
  feature_frequency: Array<{ feature: string; count: number }>;
  top_pagerank: Array<{ name: string; pagerank: number }>;
  white_space_segments: string[];
  moats: Array<{ company: string; type: string; summary: string }>;
  insights: InsightCard[];
}

function digestFromGraph(graph: SessionGraph, insights: InsightCard[]): ReportDigest {
  const idea = graph.nodes.find((n) => n.label === "Idea");
  const featureCounts = new Map<string, number>();
  for (const l of graph.links) {
    if (l.type !== "HAS_FEATURE") continue;
    featureCounts.set(l.target, (featureCounts.get(l.target) ?? 0) + 1);
  }
  const nodeName = new Map(graph.nodes.map((n) => [n.id, n.name] as const));

  return {
    refined_idea: String(idea?.text ?? idea?.name ?? "your idea"),
    companies: graph.nodes
      .filter((n) => n.label === "Company")
      .map((n) => ({
        name: n.name,
        stage: typeof n.stage === "string" ? n.stage : undefined,
        status: typeof n.status === "string" ? n.status : undefined,
        description:
          typeof n.description === "string" ? n.description : undefined,
        community: n.community,
        pagerank: n.pagerank,
        source_url: n.source_url,
      })),
    communities: companiesByCommunity(graph),
    shared_investors: sharedInvestors(graph).map((f) => ({
      investor: f.investor.name,
      companies: f.companies.map((c) => c.name),
    })),
    founder_lineage: founderLineage(graph).map((f) => ({
      origin: f.origin.name,
      founders: f.founders.map((x) => x.name),
    })),
    feature_frequency: [...featureCounts.entries()]
      .map(([id, count]) => ({ feature: nodeName.get(id) ?? id, count }))
      .sort((a, b) => b.count - a.count),
    top_pagerank: graph.nodes
      .filter((n) => n.label === "Company" && typeof n.pagerank === "number")
      .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))
      .slice(0, 5)
      .map((n) => ({ name: n.name, pagerank: n.pagerank ?? 0 })),
    white_space_segments: whiteSpaceSegments(graph).map((s) => s.name),
    moats: moatClaims(graph).map((m) => ({
      company: m.company?.name ?? "unknown",
      type: String(m.claim.type ?? "unknown"),
      summary: String(m.claim.summary ?? m.claim.name),
    })),
    insights,
  };
}

/** Gather the report digest for a session (fixture-backed in demo mode). */
export async function buildDigest(sessionId: string): Promise<ReportDigest> {
  const graph = await getSessionGraph(sessionId);
  const insights = await buildInsightCards(sessionId, graph);
  return digestFromGraph(graph, insights);
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/** The chat messages the report route sends through the gateway. */
export function buildReportPrompt(digest: ReportDigest): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You write the paid competitive landscape report for Rivalry. Audience: an idea-stage founder deciding whether and how to enter this market. Write in markdown with this exact outline:

# Competitive Landscape: {refined idea}
## 1. Competitive clusters
## 2. White space
## 3. Founder patterns
## 4. Funding and investor dynamics
## 5. Table stakes and differentiation
## 6. Positioning recommendation

Rules:
- Use ONLY facts present in the digest JSON. Cite company/investor/founder names exactly; include source URLs where the digest provides them.
- Use markdown tables for the cluster roster and the feature-frequency list.
- Section 6 is the payoff: one concrete positioning recommendation grounded in the white space and moat data.
- Plain professional prose. No emojis, no hype.`,
    },
    {
      role: "user",
      content: `Digest JSON:\n${JSON.stringify(digest)}`,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Deterministic renderer (demo mode + gateway fallback)               */
/* ------------------------------------------------------------------ */

function renderDigestMarkdown(digest: ReportDigest): string {
  const lines: string[] = [];
  lines.push(`# Competitive Landscape: ${digest.refined_idea}`);
  lines.push("");

  lines.push("## 1. Competitive clusters");
  for (const [community, names] of Object.entries(digest.communities)) {
    lines.push(`- Cluster ${community}: ${names.join(", ")}`);
  }
  lines.push("");
  lines.push("| Company | Stage | Status | Cluster |");
  lines.push("|---|---|---|---|");
  for (const c of digest.companies) {
    lines.push(
      `| ${c.name} | ${c.stage ?? "-"} | ${c.status ?? "-"} | ${c.community ?? "-"} |`,
    );
  }
  lines.push("");

  lines.push("## 2. White space");
  if (digest.white_space_segments.length > 0) {
    lines.push(
      `Segments with zero companies competing: ${digest.white_space_segments.join(", ")}. Every other segment holds two or more competitors - the gap is the opportunity.`,
    );
  } else {
    lines.push("No fully empty segment - differentiation must come from features or distribution.");
  }
  lines.push("");

  lines.push("## 3. Founder patterns");
  if (digest.founder_lineage.length > 0) {
    for (const f of digest.founder_lineage) {
      lines.push(`- ${f.founders.join(", ")} all came out of ${f.origin}.`);
    }
  } else {
    lines.push("No shared prior-employer clusters surfaced among founders in this graph.");
  }
  lines.push("");

  lines.push("## 4. Funding and investor dynamics");
  if (digest.shared_investors.length > 0) {
    for (const s of digest.shared_investors) {
      lines.push(`- ${s.investor} backs ${s.companies.join(" and ")}.`);
    }
    lines.push("");
    lines.push(
      "Shared investors across direct competitors signal consolidation pressure: expect comparisons in every partner meeting.",
    );
  } else {
    lines.push("No investor holds more than one company in this landscape.");
  }
  lines.push("");

  lines.push("## 5. Table stakes and differentiation");
  lines.push("| Feature | Companies |");
  lines.push("|---|---|");
  for (const f of digest.feature_frequency.slice(0, 10)) {
    lines.push(`| ${f.feature} | ${f.count} |`);
  }
  if (digest.moats.length > 0) {
    lines.push("");
    for (const m of digest.moats) {
      lines.push(`- ${m.company} (${m.type} moat): ${m.summary}`);
    }
  }
  lines.push("");

  lines.push("## 6. Positioning recommendation");
  const boss = digest.top_pagerank[0];
  const gap = digest.white_space_segments[0];
  lines.push(
    [
      gap
        ? `Enter through the empty ${gap} segment, where no incumbent competes today.`
        : "With no empty segment, position on the least-covered feature set below the table-stakes line.",
      boss
        ? `Differentiate explicitly against ${boss.name}, the highest-centrality node in the landscape - every pitch will be measured against it.`
        : "",
      "Treat the table-stakes features above as baseline cost, not roadmap highlights.",
    ]
      .filter((s) => s.length > 0)
      .join(" "),
  );
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */

/** Generate the paid landscape report (markdown) for a session. */
export async function generateReport(sessionId: string): Promise<string> {
  const digest = await buildDigest(sessionId);
  if (isDemoMode()) {
    return renderDigestMarkdown(digest);
  }
  try {
    const markdown = await chat(buildReportPrompt(digest), {
      temperature: 0.3,
      maxTokens: 3000,
    });
    return markdown.trim().length > 0
      ? markdown
      : renderDigestMarkdown(digest);
  } catch {
    return renderDigestMarkdown(digest);
  }
}
