/**
 * Click-to-expand: parameterized 1-hop neighborhood of a node as
 * { nodes, links }. The Cypher itself lives in lib/neo4j.fetchNeighborhood
 * (parameterized — never concatenated).
 *
 * Demo mode computes the 1-hop neighborhood from the fixture graph. Live
 * mode reads Neo4j and surfaces connectivity/configuration failures.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/env";
import { currentUser } from "@/lib/auth-server";
import { fetchNeighborhood } from "@/lib/neo4j";
import { loadDemoGraph } from "@/lib/pipeline/conductor";
import type { GraphLink, GraphNode } from "@/lib/types";

export const dynamic = "force-dynamic";

function fixtureNeighborhood(nodeId: string): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const graph = loadDemoGraph();
  const links = graph.links.filter(
    (l) => l.source === nodeId || l.target === nodeId,
  );
  const neighborIds = new Set<string>([nodeId]);
  for (const link of links) {
    neighborIds.add(link.source);
    neighborIds.add(link.target);
  }
  const nodes = graph.nodes.filter((n) => neighborIds.has(n.id));
  return { nodes, links };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ nodeId: string }> },
): Promise<NextResponse> {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { nodeId: rawNodeId } = await ctx.params;
  const nodeId = decodeURIComponent(rawNodeId);

  if (isDemoMode()) {
    return NextResponse.json(fixtureNeighborhood(nodeId));
  }

  const neighborhood = await fetchNeighborhood(nodeId);
  return NextResponse.json(neighborhood);
}
