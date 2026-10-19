/**
 * Full current graph for a session as { nodes, links } — the client
 * re-hydrates from here on page load / mid-stream refresh.
 *
 * Demo mode serves the fixture graph. Live mode reads Neo4j and surfaces
 * connectivity/configuration failures instead of silently replaying fixtures.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/env";
import { currentUser } from "@/lib/auth-server";
import { fetchGraph } from "@/lib/neo4j";
import { loadDemoGraph } from "@/lib/pipeline/conductor";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { sessionId } = await ctx.params;

  if (isDemoMode()) {
    const { nodes, links } = loadDemoGraph();
    return NextResponse.json({ nodes, links });
  }

  const graph = await fetchGraph(sessionId);
  return NextResponse.json(graph);
}
