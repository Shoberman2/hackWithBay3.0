/**
 * Paid landscape report.
 *
 *   POST /api/report { sessionId } -> { markdown, cached }
 *   GET  /api/report?sessionId=... -> { markdown } (cached only)
 *
 * Flow: paywall check (settled purchases row) -> gather a graph digest
 * (Cypher reads, or fixture aggregation in demo mode) -> ONE gateway call
 * with a structured outline -> persist to reports -> return markdown.
 */

import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { hasPurchase, getReport, saveReport } from "@/lib/butterbase";
import { currentUser } from "@/lib/auth-server";
import { chat, chatStream, type ChatMessage } from "@/lib/gateway";
import { runRead } from "@/lib/neo4j";
import { env, isDemoMode } from "@/lib/env";
import type { GraphLink, GraphNode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function debugLog(...args: unknown[]): void {
  if (env.DEBUG) {
    console.log("[report]", ...args);
  }
}

/* ------------------------------------------------------------------ */
/* Graph digest                                                        */
/* ------------------------------------------------------------------ */

interface GraphDigest {
  companiesByCommunity: Record<string, Array<{ name: string; source_url?: string }>>;
  sharedInvestors: Array<{ investor: string; companies: [string, string] }>;
  founderLineage: Array<{ founder: string; workedAt: string[]; founded: string[] }>;
  featureFrequency: Array<{ feature: string; companies: number }>;
  topPagerank: Array<{ name: string; label: string; pagerank: number }>;
  fundingRounds: Array<{
    company: string;
    round_type?: string;
    amount_usd?: number;
    announced_date?: string;
    investors: string[];
  }>;
}

async function digestFromFixture(): Promise<GraphDigest> {
  const file = await fs.readFile(
    path.join(process.cwd(), "fixtures", "demo-graph.json"),
    "utf8",
  );
  const graph = JSON.parse(file) as { nodes: GraphNode[]; links: GraphLink[] };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const name = (id: string) => byId.get(id)?.name ?? id;

  const digest: GraphDigest = {
    companiesByCommunity: {},
    sharedInvestors: [],
    founderLineage: [],
    featureFrequency: [],
    topPagerank: [],
    fundingRounds: [],
  };

  for (const node of graph.nodes) {
    if (node.label !== "Company") continue;
    const key = String(node.community ?? "unassigned");
    digest.companiesByCommunity[key] ??= [];
    digest.companiesByCommunity[key].push({
      name: node.name,
      source_url: node.source_url,
    });
  }

  const investedIn = new Map<string, string[]>();
  const featureCount = new Map<string, number>();
  const lineage = new Map<string, { workedAt: string[]; founded: string[] }>();
  const roundInvestors = new Map<string, string[]>();
  const roundCompany = new Map<string, string>();

  for (const link of graph.links) {
    switch (link.type) {
      case "INVESTED_IN": {
        const list = investedIn.get(link.source) ?? [];
        list.push(name(link.target));
        investedIn.set(link.source, list);
        break;
      }
      case "HAS_FEATURE": {
        const feature = name(link.target);
        featureCount.set(feature, (featureCount.get(feature) ?? 0) + 1);
        break;
      }
      case "WORKED_AT":
      case "FOUNDED": {
        const entry = lineage.get(link.source) ?? { workedAt: [], founded: [] };
        if (link.type === "WORKED_AT") entry.workedAt.push(name(link.target));
        else entry.founded.push(name(link.target));
        lineage.set(link.source, entry);
        break;
      }
      case "PARTICIPATED_IN": {
        const list = roundInvestors.get(link.target) ?? [];
        list.push(name(link.source));
        roundInvestors.set(link.target, list);
        break;
      }
      case "RAISED": {
        roundCompany.set(link.target, name(link.source));
        break;
      }
    }
  }

  for (const [investorId, companies] of investedIn) {
    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        digest.sharedInvestors.push({
          investor: name(investorId),
          companies: [companies[i], companies[j]],
        });
      }
    }
  }

  for (const [founderId, entry] of lineage) {
    if (entry.workedAt.length > 0 && entry.founded.length > 0) {
      digest.founderLineage.push({ founder: name(founderId), ...entry });
    }
  }

  digest.featureFrequency = [...featureCount.entries()]
    .map(([feature, companies]) => ({ feature, companies }))
    .sort((a, b) => b.companies - a.companies);

  digest.topPagerank = graph.nodes
    .filter((n) => typeof n.pagerank === "number")
    .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))
    .slice(0, 10)
    .map((n) => ({ name: n.name, label: n.label, pagerank: n.pagerank ?? 0 }));

  for (const node of graph.nodes) {
    if (node.label !== "FundingRound") continue;
    digest.fundingRounds.push({
      company: roundCompany.get(node.id) ?? "unknown",
      round_type: typeof node.round_type === "string" ? node.round_type : undefined,
      amount_usd: typeof node.amount_usd === "number" ? node.amount_usd : undefined,
      announced_date:
        typeof node.announced_date === "string" ? node.announced_date : undefined,
      investors: roundInvestors.get(node.id) ?? [],
    });
  }

  return digest;
}

async function digestFromNeo4j(): Promise<GraphDigest> {
  const [communities, shared, lineage, features, pagerank, rounds] =
    await Promise.allSettled([
      runRead(
        `MATCH (c:Company)
         RETURN coalesce(c.community, -1) AS community,
                collect({name: c.name, source_url: c.source_url}) AS companies
         ORDER BY community`,
      ),
      runRead(
        `MATCH (a:Company)<-[:INVESTED_IN]-(i:Investor)-[:INVESTED_IN]->(b:Company)
         WHERE a.name < b.name
         RETURN i.name AS investor, a.name AS a, b.name AS b LIMIT 100`,
      ),
      runRead(
        `MATCH (f:Founder)-[:WORKED_AT]->(x:Company), (f)-[:FOUNDED]->(c:Company)
         RETURN f.name AS founder,
                collect(DISTINCT x.name) AS workedAt,
                collect(DISTINCT c.name) AS founded LIMIT 100`,
      ),
      runRead(
        `MATCH (c:Company)-[:HAS_FEATURE]->(ft:Feature)
         RETURN ft.name AS feature, count(c) AS companies
         ORDER BY companies DESC LIMIT 50`,
      ),
      runRead(
        `MATCH (n) WHERE n.pagerank IS NOT NULL
         RETURN n.name AS name, labels(n)[0] AS label, n.pagerank AS pagerank
         ORDER BY n.pagerank DESC LIMIT 10`,
      ),
      runRead(
        `MATCH (c:Company)-[:RAISED]->(r:FundingRound)
         OPTIONAL MATCH (i:Investor)-[:PARTICIPATED_IN]->(r)
         RETURN c.name AS company, r.round_type AS round_type,
                r.amount_usd AS amount_usd, r.announced_date AS announced_date,
                collect(i.name) AS investors LIMIT 100`,
      ),
    ]);

  const rows = <T>(settled: PromiseSettledResult<unknown>): T[] => {
    if (settled.status === "fulfilled") return settled.value as T[];
    debugLog("digest query failed:", settled.reason);
    return [];
  };

  const digest: GraphDigest = {
    companiesByCommunity: {},
    sharedInvestors: rows<{ investor: string; a: string; b: string }>(shared).map(
      (r) => ({ investor: r.investor, companies: [r.a, r.b] as [string, string] }),
    ),
    founderLineage:
      rows<{ founder: string; workedAt: string[]; founded: string[] }>(lineage),
    featureFrequency: rows<{ feature: string; companies: number }>(features),
    topPagerank: rows<{ name: string; label: string; pagerank: number }>(pagerank),
    fundingRounds: rows<GraphDigest["fundingRounds"][number]>(rounds),
  };
  for (const row of rows<{
    community: number;
    companies: Array<{ name: string; source_url?: string }>;
  }>(communities)) {
    digest.companiesByCommunity[String(row.community)] = row.companies;
  }
  return digest;
}

/* ------------------------------------------------------------------ */
/* Report generation                                                   */
/* ------------------------------------------------------------------ */

const REPORT_SYSTEM_PROMPT = `You are the analyst behind Rivalry, a competitive-landscape tool for idea-stage founders. Write a full landscape report in GitHub-flavored markdown from the graph digest the user provides.

Structure, in order:
1. "Competitive clusters" — describe each community as a cluster, what binds it, and name its companies. Use a table.
2. "White space" — segments or clusters with no or few competitors; be concrete about the gap.
3. "Founder patterns" — lineage patterns (shared previous employers, repeat founders).
4. "Moat comparison" — compare defensibility using funding, shared investors, and feature spread. Features most companies share are table stakes.
5. "Positioning recommendation" — one clear recommendation for where a new entrant should position.

Rules: cite company/investor/founder node names exactly as given; include source URLs from the digest where present; state only what the digest supports — no invented facts; plain, specific language; no marketing filler.`;

const REPORT_OPTIONS = { purpose: "report", maxTokens: 4000, temperature: 0.4 } as const;

async function buildReportMessages(sessionId: string): Promise<ChatMessage[]> {
  const digest = isDemoMode() ? await digestFromFixture() : await digestFromNeo4j();
  return [
    { role: "system", content: REPORT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Graph digest for session ${sessionId}:\n\n${JSON.stringify(digest, null, 2)}`,
    },
  ];
}

async function generateReport(sessionId: string): Promise<string> {
  const markdown = await chat(await buildReportMessages(sessionId), REPORT_OPTIONS);
  await saveReport(sessionId, markdown);
  return markdown;
}

/**
 * Stream a fresh report as text chunks. Accumulates the full markdown
 * server-side and persists it with saveReport once the stream completes,
 * so a later GET/POST serves it from cache. chatStream never throws under
 * normal conditions (it falls back to canned chunks), so the client always
 * receives a complete document.
 */
async function streamReport(sessionId: string): Promise<Response> {
  const messages = await buildReportMessages(sessionId);
  const encoder = new TextEncoder();
  let markdown = "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of chatStream(messages, REPORT_OPTIONS)) {
          markdown += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        if (markdown) await saveReport(sessionId, markdown);
      } catch (cause) {
        debugLog("stream report failed:", cause);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Disable proxy/Next buffering so chunks reach the client as produced.
      "X-Accel-Buffering": "no",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest): Promise<Response> {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  let sessionId = "";
  let wantsStream = false;
  try {
    const body = (await req.json()) as { sessionId?: string; stream?: boolean };
    sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    wantsStream = body.stream === true;
  } catch {
    sessionId = "";
  }
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) {
    wantsStream = true;
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  try {
    if (!(await hasPurchase(sessionId))) {
      return NextResponse.json(
        { error: "payment_required", message: "The full report is a paid feature." },
        { status: 402 },
      );
    }
    const cached = await getReport(sessionId);
    if (cached) {
      return NextResponse.json({ markdown: cached, cached: true });
    }
    if (wantsStream) {
      return await streamReport(sessionId);
    }
    const markdown = await generateReport(sessionId);
    return NextResponse.json({ markdown, cached: false });
  } catch (cause) {
    debugLog(cause);
    return NextResponse.json(
      { error: "Report generation failed. Try again in a moment." },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const sessionId = req.nextUrl.searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }
  try {
    if (!(await hasPurchase(sessionId))) {
      return NextResponse.json(
        { error: "payment_required", message: "The full report is a paid feature." },
        { status: 402 },
      );
    }
    const markdown = await getReport(sessionId);
    if (!markdown) {
      return NextResponse.json({ error: "No report yet." }, { status: 404 });
    }
    return NextResponse.json({ markdown, cached: true });
  } catch (cause) {
    debugLog(cause);
    return NextResponse.json(
      { error: "Could not load the report." },
      { status: 502 },
    );
  }
}
