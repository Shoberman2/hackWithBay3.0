"use client";

/**
 * InsightCards -- stream-in stack of derived intelligence. Cards fade up
 * with a stagger as they arrive; clicking one lights up its path on the
 * graph (clicking again clears the highlight).
 */

import type { CSSProperties } from "react";
import type { InsightCard } from "@/lib/types";
import type { Highlight } from "@/hooks/useGraphStream";
import { INSIGHT_META } from "./graph-utils";

interface InsightCardsProps {
  insights: InsightCard[];
  /** True while the pipeline is still running (drives the skeleton). */
  pending: boolean;
  highlight: Highlight | null;
  onHighlight: (highlight: Highlight | null) => void;
}

export default function InsightCards({
  insights,
  pending,
  highlight,
  onHighlight,
}: InsightCardsProps) {
  return (
    <section className="px-5 py-5" aria-label="Insights">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
          Insights
        </h2>
        <span className="font-mono text-[11px] text-ink-2">
          {insights.length}
        </span>
      </div>

      {insights.length === 0 && pending && (
        <div className="mt-3 space-y-3">
          <div className="shimmer h-24 rounded-lg" />
          <div className="shimmer h-24 rounded-lg" />
        </div>
      )}

      {insights.length === 0 && !pending && (
        <p className="mt-3 text-[13px] leading-5 text-ink-2">
          No insights yet. The analysis pass runs once the graph settles.
        </p>
      )}

      {insights.length > 0 && (
        <div className="mt-3 space-y-3">
          {insights.map((card, index) => {
            const meta = INSIGHT_META[card.kind];
            const active = highlight === card.highlight;
            return (
              <button
                key={`${card.kind}:${card.title}`}
                type="button"
                onClick={() => onHighlight(active ? null : card.highlight)}
                style={{ "--index": index } as CSSProperties}
                className={`fade-up block w-full rounded-lg border bg-canvas p-4 text-left transition hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] active:scale-[0.98] ${
                  active ? "border-ink" : "border-line"
                }`}
              >
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink ${meta?.wash ?? "bg-surface border border-line"}`}
                >
                  {meta?.label ?? card.kind}
                </span>
                <h3 className="mt-2 text-sm font-medium leading-5 tracking-tight text-ink">
                  {card.title}
                </h3>
                <p className="mt-1 text-[13px] leading-5 text-ink-2">
                  <MonoNumbers text={card.body} />
                </p>
                {active && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
                    Highlighted on graph
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

const NUMBER_PATTERN = /(\$[\d,.]+[MBK]?|\b\d[\d,.]*%?\b)/g;
const NUMBER_TEST = /^(\$[\d,.]+[MBK]?|\d[\d,.]*%?)$/;

/** Render numeric tokens (amounts, counts, percentages) in mono. */
function MonoNumbers({ text }: { text: string }) {
  const parts = text.split(NUMBER_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        NUMBER_TEST.test(part) ? (
          <span key={index} className="font-mono text-[12px] text-ink">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
