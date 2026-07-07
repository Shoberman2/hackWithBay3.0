"use client";

/**
 * GraphLegend -- key for the progressive-disclosure graph model.
 * Companies are the default view; founders, investors, and funding rounds
 * fan out when a company is clicked. Rendered as a floating card by the
 * session layout (bottom-left).
 */

import type { GraphNode, NodeLabel } from "@/lib/types";
import { LABEL_TEXT, NODE_COLORS } from "./graph-utils";

const LEGEND_LABELS: NodeLabel[] = [
  "Company",
  "Founder",
  "Investor",
  "FundingRound",
];

export default function GraphLegend({ nodes }: { nodes: GraphNode[] }) {
  if (nodes.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-line bg-canvas px-3 py-2.5"
      aria-label="Node type legend"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {LEGEND_LABELS.map((label) => (
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
      <p className="mt-2 text-[11px] leading-4" style={{ color: "#787774" }}>
        Click a company to see who funds and builds it.
      </p>
    </div>
  );
}
