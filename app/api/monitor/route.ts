/**
 * GET /api/monitor?sessionId=... — run the news monitor for a session.
 *
 * Watchlist = the session graph's Company nodes (top 8 by PageRank).
 * Fetching runs in a Daytona sandbox agent; classification runs on the
 * RocketRide-hosted rivalry-monitor pipe. Falls back per lib/monitor.ts.
 */

import { NextResponse } from "next/server";
import { runMonitor } from "@/lib/monitor";
import { getSessionGraph } from "@/lib/agents/graph-facts";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const graph = await getSessionGraph(sessionId);
    const companies = graph.nodes
      .filter((n) => n.label === "Company")
      .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))
      .map((n) => n.name);
    const idea = graph.nodes.find((n) => n.label === "Idea");
    const tags = Array.isArray(idea?.refined_tags)
      ? (idea.refined_tags as string[])
      : [];

    const report = await runMonitor(companies, tags);
    return NextResponse.json(report);
  } catch (error) {
    if (env.DEBUG) console.error("[api/monitor]", error);
    return NextResponse.json(
      { error: "The monitor could not complete. Try again." },
      { status: 500 },
    );
  }
}
