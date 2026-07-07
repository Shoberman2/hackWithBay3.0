/**
 * Full current graph for a session as { nodes, links } — the client
 * re-hydrates from here on page load / mid-stream refresh.
 *
 * Demo mode (or any Neo4j failure) serves the fixture graph so the app
 * always renders end-to-end with zero credentials.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env, isDemoMode } from "@/lib/env";
import { fetchGraph } from "@/lib/neo4j";
import { loadDemoGraph } from "@/lib/pipeline/conductor";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await ctx.params;

  if (!isDemoMode()) {
    try {
      const graph = await fetchGraph(sessionId);
      return NextResponse.json(graph);
    } catch (err) {
      if (env.DEBUG) console.error("[api/graph]", err);
      // fall through to fixture
    }
  }

  const { nodes, links } = loadDemoGraph();
  return NextResponse.json({ nodes, links });
}
