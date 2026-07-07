"use client";

/**
 * GraphLegend -- node-type key for the labels currently on the canvas.
 * Rendered as a floating card by the session layout (bottom-left).
 */

import { useMemo } from "react";
import type { GraphNode, NodeLabel } from "@/lib/types";
import { LABEL_ORDER, LABEL_TEXT, NODE_COLORS } from "./graph-utils";

export default function GraphLegend({ nodes }: { nodes: GraphNode[] }) {
  const present = useMemo(() => {
    const seen = new Set<NodeLabel>();
    for (const node of nodes) seen.add(node.label);
    return LABEL_ORDER.filter((label) => seen.has(label));
  }, [nodes]);

  if (present.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-line bg-canvas px-3 py-2.5"
      aria-label="Node type legend"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {present.map((label) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: NODE_COLORS[label] }}
            />
            <span className="font-mono text-[11px] leading-4 text-ink-2">
              {LABEL_TEXT[label]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
