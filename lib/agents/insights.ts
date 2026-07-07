/**
 * Insight cards: the 4 core cards (investor-collision, white-space,
 * table-stakes, boss-node) plus moat cards. Facts come from ONE
 * deterministic graph read per card; the gateway is used ONLY to phrase
 * the one-sentence plain-language body. Demo mode serves the fixture cards.
 */

import { chat } from "@/lib/gateway";
import { isDemoMode } from "@/lib/env";
import type { InsightCard, GraphNode, GraphLink } from "@/lib/types";
import {
  getFixtureGraph,
  getSessionGraph,
  highlightFor,
  sharedInvestors,
  whiteSpaceSegments,
  tableStakesFeatures,
  bossNode,
  moatClaims,
  type SessionGraph,
} from "./graph-facts";

export interface AlgoResult {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** LLM polish for the card body; deterministic fallback if the gateway fails. */
async function phrase(facts: string, fallback: string): Promise<string> {
  try {
    const body = await chat(
      [
        {
          role: "system",
          content:
            "Rewrite the given competitive-landscape facts as ONE plain-language sentence (max two) for a startup founder. Keep every name and number exactly as given. Add nothing that is not in the facts. No markdown.",
        },
        { role: "user", content: facts },
      ],
      { temperature: 0.3, maxTokens: 120 },
    );
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function investorCollisionCard(graph: SessionGraph): {
  card: Omit<InsightCard, "body">;
  facts: string;
  fallback: string;
} | null {
  const facts = sharedInvestors(graph);
  const top = facts[0];
  if (!top) return null;
  const companyNames = top.companies.map((c) => c.name);
  const sentence = `${top.investor.name} holds positions in ${companyNames.length} companies in this landscape: ${formatList(companyNames)}.`;
  return {
    card: {
      kind: "investor-collision",
      title: `${top.investor.name} backs ${companyNames.length} of your competitors`,
      highlight: highlightFor([top.investor, ...top.companies], top.links),
    },
    facts: `${sentence} A shared investor across direct competitors signals consolidation pressure and shared deal flow.`,
    fallback: `${sentence} Expect consolidation pressure and warm intros routing through the same partners.`,
  };
}

function whiteSpaceCard(graph: SessionGraph): {
  card: Omit<InsightCard, "body">;
  facts: string;
  fallback: string;
} | null {
  const empty = whiteSpaceSegments(graph);
  if (empty.length === 0) return null;
  const names = empty.map((s) => s.name);
  const sentence = `${formatList(names)} ${empty.length === 1 ? "has" : "have"} zero companies competing, while every other segment holds two or more.`;
  return {
    card: {
      kind: "white-space",
      title: `White space: ${names[0]}`,
      highlight: highlightFor(empty, []),
    },
    facts: sentence,
    fallback: `${sentence} That gap is the most defensible place to start.`,
  };
}

function tableStakesCard(graph: SessionGraph): {
  card: Omit<InsightCard, "body">;
  facts: string;
  fallback: string;
} | null {
  const facts = tableStakesFeatures(graph);
  if (facts.length === 0) return null;
  const parts = facts.map((f) => `${f.feature.name} (${f.count} companies)`);
  const sentence = `${facts.length} feature${facts.length === 1 ? " appears" : "s appear"} across most of the landscape: ${parts.join(", ")}.`;
  return {
    card: {
      kind: "table-stakes",
      title: `${facts.length} feature${facts.length === 1 ? " is" : "s are"} table stakes`,
      highlight: highlightFor(
        facts.map((f) => f.feature),
        facts.flatMap((f) => f.links),
      ),
    },
    facts: sentence,
    fallback: `${sentence} Shipping these earns zero differentiation - budget them as baseline cost.`,
  };
}

function bossNodeCard(graph: SessionGraph): {
  card: Omit<InsightCard, "body">;
  facts: string;
  fallback: string;
} | null {
  const boss = bossNode(graph);
  if (!boss) return null;
  const attached = graph.links.filter(
    (l) =>
      (l.source === boss.id || l.target === boss.id) &&
      (l.type === "RAISED" || l.type === "HAS_TRACTION"),
  );
  const neighborIds = attached.map((l) =>
    l.source === boss.id ? l.target : l.source,
  );
  const neighbors = graph.nodes.filter((n) => neighborIds.includes(n.id));
  const sentence = `${boss.name} holds the highest PageRank in the landscape (${(boss.pagerank ?? 0).toFixed(4)}).`;
  return {
    card: {
      kind: "boss-node",
      title: `${boss.name} is the node everyone positions against`,
      highlight: highlightFor([boss, ...neighbors], attached),
    },
    facts: `${sentence} Every pitch in this space will be measured against it.`,
    fallback: `${sentence} Differentiation against ${boss.name} is mandatory, not optional.`,
  };
}

function moatCards(graph: SessionGraph): Array<{
  card: Omit<InsightCard, "body">;
  facts: string;
  fallback: string;
}> {
  return moatClaims(graph)
    .slice(0, 2)
    .map((m) => {
      const summary = String(m.claim.summary ?? m.claim.name);
      const owner = m.company?.name ?? "A competitor";
      return {
        card: {
          kind: "moat" as const,
          title: `${owner} claims a ${String(m.claim.type ?? "structural")} moat`,
          highlight: highlightFor(
            [m.claim, ...(m.company ? [m.company] : [])],
            m.links,
          ),
        },
        facts: `${owner} moat claim (confidence ${String(m.claim.confidence ?? "?")}): ${summary}`,
        fallback: summary,
      };
    });
}

/**
 * Build the insight cards for a session. `algoResult` is the
 * metric-annotated graph from the insight pass (lib/algorithms); when
 * omitted, the session graph is fetched (fixture in demo mode).
 */
export async function buildInsightCards(
  sessionId: string,
  algoResult?: AlgoResult,
): Promise<InsightCard[]> {
  if (isDemoMode()) {
    return getFixtureGraph().insights;
  }

  const graph: SessionGraph = algoResult ?? (await getSessionGraph(sessionId));

  const drafts = [
    investorCollisionCard(graph),
    whiteSpaceCard(graph),
    tableStakesCard(graph),
    bossNodeCard(graph),
    ...moatCards(graph),
  ].filter((d): d is NonNullable<typeof d> => d !== null);

  const cards: InsightCard[] = [];
  for (const draft of drafts) {
    const body = await phrase(draft.facts, draft.fallback);
    cards.push({ ...draft.card, body });
  }
  return cards;
}
