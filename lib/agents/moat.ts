/**
 * Per-company moat analysis pass. One gateway call per company over its
 * accumulated subgraph; output is MoatClaim rows with EVIDENCED_BY edges
 * back to Source URLs that actually exist in the subgraph. A claim with
 * no surviving evidence is skipped - derived intelligence must cite
 * sources like any other fact (README section 4).
 */

import { z } from "zod";
import { chat } from "@/lib/gateway";
import { isDemoMode } from "@/lib/env";
import type {
  MoatClaim,
  MoatType,
  ExtractedRelationship,
  GraphNode,
  GraphLink,
} from "@/lib/types";

export interface MoatPassResult {
  claims: MoatClaim[];
  relationships: ExtractedRelationship[];
}

const MOAT_TYPES = [
  "network-effects",
  "data",
  "distribution",
  "brand",
  "switching-costs",
] as const;

const claimSchema = z.object({
  type: z.enum(MOAT_TYPES),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence_urls: z.array(z.string()).min(1),
});

const responseSchema = z.object({
  claims: z.array(claimSchema).max(3),
});

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function collectSourceUrls(nodes: GraphNode[]): Set<string> {
  const urls = new Set<string>();
  for (const n of nodes) {
    if (typeof n.source_url === "string" && n.source_url.length > 0) {
      urls.add(n.source_url);
    }
    if (n.label === "Source" && typeof n.name === "string") {
      urls.add(n.name);
    }
  }
  return urls;
}

function describeSubgraph(
  companyName: string,
  nodes: GraphNode[],
  links: GraphLink[],
): string {
  const byLabel = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const list = byLabel.get(n.label) ?? [];
    list.push(n);
    byLabel.set(n.label, list);
  }
  const lines: string[] = [`Company: ${companyName}`];
  for (const [label, group] of byLabel) {
    if (label === "Company") continue;
    lines.push(
      `${label}: ${group
        .slice(0, 15)
        .map(
          (n) =>
            `${n.name}${n.source_url ? ` [source: ${String(n.source_url)}]` : ""}`,
        )
        .join("; ")}`,
    );
  }
  lines.push(
    `Relationships: ${links
      .slice(0, 60)
      .map((l) => `${l.source} -${l.type}-> ${l.target}`)
      .join("; ")}`,
  );
  return lines.join("\n");
}

/**
 * Analyze one company's accumulated subgraph for defensible moats.
 * Returns MoatClaim rows plus CLAIMS_MOAT / EVIDENCED_BY relationships
 * ready for the pipeline writer. Empty result in demo mode (the fixture
 * already carries its moat claims) or when no claim survives the
 * evidence filter.
 */
export async function analyzeCompanyMoat(
  companyName: string,
  subgraph: { nodes: GraphNode[]; links: GraphLink[] },
): Promise<MoatPassResult> {
  const empty: MoatPassResult = { claims: [], relationships: [] };
  if (isDemoMode()) return empty;

  const knownUrls = collectSourceUrls(subgraph.nodes);
  if (knownUrls.size === 0) return empty;

  let parsed: z.infer<typeof responseSchema>;
  try {
    const raw = await chat(
      [
        {
          role: "system",
          content: `You analyze a company's competitive evidence for defensible moats. Moat types: ${MOAT_TYPES.join(
            ", ",
          )}. Rules:\n- Base every claim ONLY on the evidence provided; cite evidence_urls copied verbatim from the [source: ...] annotations.\n- At most 3 claims; skip weak ones rather than padding.\n- confidence is 0-1.\n- Respond ONLY with minified JSON: {"claims": [{"type": string, "summary": string, "confidence": number, "evidence_urls": string[]}]}. No markdown.`,
        },
        {
          role: "user",
          content: describeSubgraph(companyName, subgraph.nodes, subgraph.links),
        },
      ],
      { json: true, temperature: 0.2 },
    );
    parsed = responseSchema.parse(JSON.parse(stripFences(raw)));
  } catch {
    return empty;
  }

  const claims: MoatClaim[] = [];
  const relationships: ExtractedRelationship[] = [];
  for (const c of parsed.claims) {
    const evidence = c.evidence_urls.filter((u) => knownUrls.has(u));
    if (evidence.length === 0) continue; // no evidence, no claim
    const claimId = `${companyName}|${c.type}`;
    claims.push({
      claim_id: claimId,
      type: c.type as MoatType,
      summary: c.summary,
      confidence: c.confidence,
      source_url: evidence[0],
    });
    relationships.push({
      from: companyName,
      to: claimId,
      type: "CLAIMS_MOAT",
      source_url: evidence[0],
    });
    for (const url of evidence) {
      relationships.push({
        from: claimId,
        to: url,
        type: "EVIDENCED_BY",
        source_url: url,
      });
    }
  }
  return { claims, relationships };
}
