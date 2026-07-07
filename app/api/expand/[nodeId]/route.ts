/**
 * Click-to-expand: parameterized 1-hop neighborhood of a node as
 * { nodes, links }. The Cypher itself lives in lib/neo4j.fetchNeighborhood
 * (parameterized — never concatenated).
 *
 * Demo mode (or any Neo4j failure) computes the 1-hop neighborhood from
 * the fixture graph instead.
 */

import { NextResponse, type NextRequest } from "next/server";
import { env, isDemoMode } from "@/lib/env";
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
  const { nodeId: rawNodeId } = await ctx.params;
  const nodeId = decodeURIComponent(rawNodeId);

  if (!isDemoMode()) {
    try {
      const neighborhood = await fetchNeighborhood(nodeId);
      return NextResponse.json(neighborhood);
    } catch (err) {
      if (env.DEBUG) console.error("[api/expand]", err);
      // fall through to fixture
    }
  }

  return NextResponse.json(fixtureNeighborhood(nodeId));
}
