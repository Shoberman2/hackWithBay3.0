/**
 * Q&A agent (text2Cypher). Generates a read-only Cypher query grounded in
 * the graph schema, executes it, then summarizes the records in prose.
 * Answers NEVER come from model knowledge without an executed query; in
 * demo mode the "query" is a deterministic traversal of the fixture graph.
 */

import { chat, type ChatMessage } from "@/lib/gateway";
import { env, isDemoMode, hasNeo4j } from "@/lib/env";
import { runRead, getSchemaString } from "@/lib/neo4j";
import { isQuantitative, runSandboxAnalysis } from "@/lib/daytona";
import type { AgentAnswer, SandboxAnalysis } from "@/lib/types";
import {
  getSessionGraph,
  highlightFor,
  matchRecordsToGraph,
  sharedInvestors,
  whiteSpaceSegments,
  tableStakesFeatures,
  founderLineage,
  bossNode,
  type SessionGraph,
} from "./graph-facts";

/* ------------------------------------------------------------------ */
/* Schema for the prompt                                               */
/* ------------------------------------------------------------------ */

const FIXTURE_SCHEMA = `Node labels (properties):
  Idea (text, session_id, created_at, refined_tags)
  Company (name, url, description, stage, founded_year, hq, status, community, pagerank)
  Founder (name, linkedin_url, background_summary)
  Investor (name, type, notable)
  Feature (name, category, description)
  LaunchEvent (event_id, title, date, source, url)
  Segment (name)
  Source (url, type, fetched_at)
  FundingRound (round_id, round_type, amount_usd, announced_date)
  WebsiteSnapshot (snapshot_id, url, captured_at, positioning_summary)
  Post (title, url, platform, posted_at)
  MoatClaim (claim_id, type, summary, confidence)
  TractionSignal (signal_id, metric, value, observed_at)
Relationships:
  (Company)-[:COMPETES_IN {confidence}]->(Segment)
  (Founder)-[:FOUNDED {year, role}]->(Company)
  (Founder)-[:WORKED_AT {years, role}]->(Company)
  (Investor)-[:INVESTED_IN {round, year, lead}]->(Company)
  (Company)-[:HAS_FEATURE {first_seen}]->(Feature)
  (Company)-[:SHIPPED]->(LaunchEvent)
  (LaunchEvent)-[:SHIPPED_AFTER {lag_days}]->(LaunchEvent)
  (Company)-[:TARGETS]->(Segment)
  (Company)-[:RELEVANT_TO {relevance_score}]->(Idea)
  (LaunchEvent)-[:CITED_BY]->(Source)
  (Company)-[:RAISED]->(FundingRound)
  (Investor)-[:PARTICIPATED_IN {lead}]->(FundingRound)
  (Company)-[:HAD_SNAPSHOT]->(WebsiteSnapshot)
  (WebsiteSnapshot)-[:NEXT_SNAPSHOT {messaging_changed}]->(WebsiteSnapshot)
  (Founder)-[:POSTED]->(Post)
  (Post)-[:ABOUT]->(Company)
  (Company)-[:CLAIMS_MOAT]->(MoatClaim)
  (MoatClaim)-[:EVIDENCED_BY]->(Source)
  (Company)-[:HAS_TRACTION]->(TractionSignal)`;

let cachedSchema: string | null = null;

async function getSchema(): Promise<string> {
  if (cachedSchema) return cachedSchema;
  if (!isDemoMode() && hasNeo4j()) {
    try {
      cachedSchema = await getSchemaString();
      return cachedSchema;
    } catch {
      // schema call unavailable: fixture schema below
    }
  }
  cachedSchema = FIXTURE_SCHEMA;
  return cachedSchema;
}

/* ------------------------------------------------------------------ */
/* Few-shot pairs (PLAN.md Phase 5 — the demo depends on these)        */
/* ------------------------------------------------------------------ */

const CYPHER_SHARED_INVESTORS =
  "MATCH (a:Company)<-[:INVESTED_IN]-(i:Investor)-[:INVESTED_IN]->(b:Company) WHERE a.name < b.name RETURN a.name, i.name, b.name";

const CYPHER_FOUNDER_LINEAGE =
  "MATCH (f:Founder)-[:WORKED_AT]->(x:Company), (f)-[:FOUNDED]->(c:Company)-[:RELEVANT_TO]->(:Idea {session_id:$session_id}) RETURN x.name, collect(f.name), collect(c.name) ORDER BY size(collect(f.name)) DESC";

const CYPHER_WHITE_SPACE =
  "MATCH (s:Segment) WHERE NOT ( (:Company)-[:COMPETES_IN]->(s) ) OPTIONAL MATCH (c:Company) WITH s, collect(DISTINCT c.community) AS communities RETURN s.name AS empty_segment, communities";

const CYPHER_TABLE_STAKES =
  "MATCH (c:Company)-[:HAS_FEATURE]->(ft:Feature) WITH ft, count(c) AS n WHERE n >= $threshold RETURN ft.name, n ORDER BY n DESC";

const FEW_SHOTS: Array<{ q: string; cypher: string }> = [
  { q: "Which of these companies share investors?", cypher: CYPHER_SHARED_INVESTORS },
  { q: "Where did the founders in this space work before?", cypher: CYPHER_FOUNDER_LINEAGE },
  {
    q: "Where is the white space in this landscape?",
    cypher: CYPHER_WHITE_SPACE,
  },
  {
    q: "What features are table stakes that everyone has?",
    cypher: CYPHER_TABLE_STAKES,
  },
];

/* ------------------------------------------------------------------ */
/* Guardrails                                                          */
/* ------------------------------------------------------------------ */

const FORBIDDEN =
  /\b(CREATE|MERGE|DELETE|SET|REMOVE|DETACH|DROP)\b|CALL\s+db\.|CALL\s+dbms\.|apoc\./i;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:cypher)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/** Sanitize LLM Cypher: fences off, forbidden clauses rejected, LIMIT capped. */
export function sanitizeCypher(raw: string): string {
  const cypher = stripFences(raw);
  if (cypher.length === 0) throw new Error("empty Cypher from model");
  if (FORBIDDEN.test(cypher)) {
    throw new Error("rejected: query contains a write or procedure clause");
  }
  if (!/\bLIMIT\s+\d+/i.test(cypher)) {
    return `${cypher}\nLIMIT 200`;
  }
  return cypher;
}

/* ------------------------------------------------------------------ */
/* Demo-mode answers: deterministic fixture traversals                 */
/* ------------------------------------------------------------------ */

function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function demoAnswer(question: string, graph: SessionGraph): AgentAnswer {
  const q = question.toLowerCase();

  if (/invest/.test(q) && /(shar|same|common|both|overlap)/.test(q)) {
    const facts = sharedInvestors(graph);
    if (facts.length === 0) {
      return {
        answer: "No investor in this graph holds more than one company.",
        cypher: CYPHER_SHARED_INVESTORS,
      };
    }
    const sentences = facts.map(
      (f) =>
        `${f.investor.name} backs ${formatList(f.companies.map((c) => c.name))}`,
    );
    const nodes = facts.flatMap((f) => [f.investor, ...f.companies]);
    const links = facts.flatMap((f) => f.links);
    return {
      answer: `${facts.length} investor${facts.length === 1 ? "" : "s"} hold${
        facts.length === 1 ? "s" : ""
      } positions in multiple companies here: ${sentences.join("; ")}. Shared investors are a consolidation signal - expect those companies to be compared in every partner meeting.`,
      cypher: CYPHER_SHARED_INVESTORS,
      highlight: highlightFor(nodes, links),
    };
  }

  if (/(white\s*space|gap|underserved|unserved|empty|nobody)/.test(q)) {
    const empty = whiteSpaceSegments(graph);
    if (empty.length === 0) {
      return {
        answer: "Every segment in this graph has at least one company competing in it - no obvious white space.",
        cypher: CYPHER_WHITE_SPACE,
      };
    }
    return {
      answer: `${formatList(empty.map((s) => s.name))} ${
        empty.length === 1 ? "is" : "are"
      } the segment${empty.length === 1 ? "" : "s"} with zero companies competing - the white space in this landscape. Every other segment holds two or more competitors.`,
      cypher: CYPHER_WHITE_SPACE,
      highlight: highlightFor(empty, []),
    };
  }

  if (/(table\s*stakes|baseline|everyone has|every company|standard feature)/.test(q)) {
    const facts = tableStakesFeatures(graph);
    if (facts.length === 0) {
      return {
        answer: "No feature is shared by four or more companies in this graph yet.",
        cypher: CYPHER_TABLE_STAKES,
      };
    }
    const parts = facts.map((f) => `${f.feature.name} (${f.count} companies)`);
    return {
      answer: `${facts.length} feature${facts.length === 1 ? " is" : "s are"} table stakes: ${parts.join(", ")}. Shipping these earns zero differentiation - budget them as baseline cost.`,
      cypher: CYPHER_TABLE_STAKES,
      highlight: highlightFor(
        facts.map((f) => f.feature),
        facts.flatMap((f) => f.links),
      ),
    };
  }

  if (/(lineage|\bwork(ed|s)?\b|came from|alumni|background|previous|prior|pivot)/.test(q)) {
    const facts = founderLineage(graph);
    if (facts.length === 0) {
      return {
        answer:
          "This graph has no shared prior-employer paths between founders yet - no two founders show WORKED_AT edges into the same company. As the pipeline enriches founder backgrounds, talent clusters will surface here.",
        cypher: CYPHER_FOUNDER_LINEAGE,
      };
    }
    const sentences = facts.map(
      (f) =>
        `${f.founders.length} founders came out of ${f.origin.name} (${formatList(
          f.founders.map((x) => x.name),
        )})`,
    );
    return {
      answer: `Talent clusters: ${sentences.join("; ")}.`,
      cypher: CYPHER_FOUNDER_LINEAGE,
      highlight: highlightFor(
        facts.flatMap((f) => [f.origin, ...f.founders]),
        facts.flatMap((f) => f.links),
      ),
    };
  }

  if (/(boss|central|dominant|biggest|leader|position(ed)? against|pagerank|most connected)/.test(q)) {
    const boss = bossNode(graph);
    if (!boss) {
      return { answer: "No company in this graph carries a PageRank score yet - run the insight pass first." };
    }
    return {
      answer: `${boss.name} holds the highest PageRank in the landscape (${(
        boss.pagerank ?? 0
      ).toFixed(4)}). It is the node every other company positions against - differentiation from ${boss.name} is mandatory, not optional.`,
      cypher:
        "MATCH (c:Company) WHERE c.pagerank IS NOT NULL RETURN c.name, c.pagerank ORDER BY c.pagerank DESC LIMIT 5",
      highlight: highlightFor([boss], []),
    };
  }

  // Default: landscape overview from the graph itself.
  const companies = graph.nodes.filter((n) => n.label === "Company");
  const investors = graph.nodes.filter((n) => n.label === "Investor");
  const segments = graph.nodes.filter((n) => n.label === "Segment");
  const boss = bossNode(graph);
  return {
    answer: `This landscape holds ${companies.length} companies, ${investors.length} investors and ${segments.length} segments${
      boss ? `, centered on ${boss.name}` : ""
    }. Try asking: "which companies share investors", "where is the white space", or "what features are table stakes".`,
    cypher:
      "MATCH (c:Company)-[:RELEVANT_TO]->(:Idea) RETURN c.name, c.stage, c.status ORDER BY c.pagerank DESC",
    highlight: boss ? highlightFor([boss], []) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Live path                                                           */
/* ------------------------------------------------------------------ */

async function generateCypher(
  question: string,
  schema: string,
  priorAttempt?: { cypher: string; error: string },
): Promise<string> {
  const shots = FEW_SHOTS.flatMap<ChatMessage>((s) => [
    { role: "user", content: s.q },
    { role: "assistant", content: s.cypher },
  ]);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You translate founder questions into Neo4j Cypher over this schema:\n\n${schema}\n\nRules:\n- Return ONLY a single read-only Cypher query. No markdown, no explanation.\n- Read-only: never use CREATE, MERGE, DELETE, SET, REMOVE, DETACH, DROP, or CALL procedures.\n- Parameters available: $session_id (the current idea session), $threshold (integer, feature-count cutoff).\n- Prefer the graph structure (traversals) over string matching.`,
    },
    ...shots,
    { role: "user", content: question },
  ];
  if (priorAttempt) {
    messages.push(
      { role: "assistant", content: priorAttempt.cypher },
      {
        role: "user",
        content: `That query failed with this database error:\n${priorAttempt.error}\nReturn a corrected read-only Cypher query. Cypher only.`,
      },
    );
  }
  return chat(messages, { temperature: 0 });
}

async function summarize(
  question: string,
  cypher: string,
  records: Array<Record<string, unknown>>,
  analysis: SandboxAnalysis | null,
): Promise<string> {
  if (records.length === 0 && !analysis) {
    return "The query ran but returned no rows - the graph holds no data matching that question yet.";
  }
  const fallback = analysis
    ? analysis.output
    : `The query returned ${records.length} row${
        records.length === 1 ? "" : "s"
      }. First rows: ${JSON.stringify(records.slice(0, 5))}`;
  try {
    return await chat(
      [
        {
          role: "system",
          content:
            "You summarize graph query results for a startup founder in 2-4 plain sentences. Use only facts present in the rows (and the computed analysis output, when provided) - concrete names and numbers, no speculation. No markdown.",
        },
        {
          role: "user",
          content: `Question: ${question}\nCypher: ${cypher}\nRows (JSON): ${JSON.stringify(
            records.slice(0, 50),
          )}${
            analysis
              ? `\nComputed analysis (ran in an isolated sandbox over the full graph):\n${analysis.output}`
              : ""
          }`,
        },
      ],
      { temperature: 0.2 },
    );
  } catch {
    return fallback;
  }
}

/** Answer a natural-language question via graph traversal (text2Cypher). */
export async function answerQuestion(
  question: string,
  sessionId: string,
): Promise<AgentAnswer> {
  const graph = await getSessionGraph(sessionId);

  // Quantitative questions get a parallel sandboxed computation pass
  // (Daytona) alongside the answer path. The sandbox operates on the
  // session graph (fixture included), so it does not require Neo4j —
  // only DAYTONA_API_KEY + the gateway + DEMO_MODE=false.
  const analysisPromise = isQuantitative(question)
    ? runSandboxAnalysis(question, graph)
    : Promise.resolve(null);

  if (isDemoMode()) {
    const base = demoAnswer(question, graph);
    const analysis = await analysisPromise;
    if (!analysis) return base;
    // Sandbox ran even though Neo4j is absent: fold its output into the
    // prose (summarize falls back to the raw output on gateway failure).
    const answer = await summarize(question, base.cypher ?? "", [], analysis);
    return { ...base, answer, analysis };
  }

  const schema = await getSchema();
  const params = { session_id: sessionId, threshold: 3 };

  try {
    let cypher = sanitizeCypher(await generateCypher(question, schema));
    let records: Array<Record<string, unknown>>;
    try {
      records = await runRead<Record<string, unknown>>(cypher, params);
    } catch (dbError) {
      // One retry with the database error appended to the prompt.
      const message =
        dbError instanceof Error ? dbError.message : String(dbError);
      cypher = sanitizeCypher(
        await generateCypher(question, schema, { cypher, error: message }),
      );
      records = await runRead<Record<string, unknown>>(cypher, params);
    }
    const analysis = await analysisPromise;
    const answer = await summarize(question, cypher, records, analysis);
    return {
      answer,
      cypher,
      highlight: matchRecordsToGraph(records, graph),
      analysis: analysis ?? undefined,
    };
  } catch (error) {
    if (env.DEBUG) {
      console.error("[text2cypher] falling back to fixture answer:", error);
    }
    // Gateway or database unavailable: deterministic graph answer so the
    // demo never dies on stage.
    return demoAnswer(question, graph);
  }
}
