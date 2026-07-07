"use client";

/**
 * Session view -- the product moment. Fluid graph canvas on the left,
 * 360px rail on the right: stream status, selected-node detail, insight
 * cards, and the agent chat. Fully functional in DEMO_MODE via the
 * fixture replay inside useGraphStream.
 */

import { use, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GraphLink, GraphNode } from "@/lib/types";
import {
  expandFromFixture,
  useGraphStream,
  type Highlight,
} from "@/hooks/useGraphStream";
import LiveGraph from "@/components/graph/LiveGraph";
import NodeDetailPanel from "@/components/graph/NodeDetailPanel";
import InsightCards from "@/components/graph/InsightCards";
import GraphLegend from "@/components/graph/GraphLegend";
import StreamStatus from "@/components/graph/StreamStatus";
import PaywallCard from "@/components/report/PaywallCard";
import ReportView from "@/components/report/ReportView";
import UserMenu from "@/components/account/UserMenu";
import type { AgentChatProps } from "@/components/chat/AgentChat";

/*
 * Null-safe dynamic import: the chat team owns AgentChat; if their module
 * fails to load at runtime the rail simply omits the chat slot.
 */
const EmptyChat = (_props: AgentChatProps) => null;
const AgentChat = dynamic<AgentChatProps>(
  () =>
    import("@/components/chat/AgentChat")
      .then((mod) => mod.default)
      .catch(() => EmptyChat),
  {
    ssr: false,
    loading: () => <div className="shimmer m-4 h-10 rounded-lg" />,
  },
);

interface ExpandPayload {
  nodes?: GraphNode[];
  links?: GraphLink[];
}

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    data,
    status,
    stage,
    insights,
    addEntities,
    highlight,
    setHighlight,
  } = useGraphStream(id);

  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);

  // Paid report flow: paywall -> checkout -> generated markdown.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [needsPayment, setNeedsPayment] = useState(true);
  const [unlocked, setUnlocked] = useState(false);

  const generateReport = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      if (res.status === 402) {
        setNeedsPayment(true);
        return;
      }
      const body = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok || !body.markdown) {
        setReportError(body.error ?? "Report generation failed. Try again.");
        return;
      }
      setNeedsPayment(false);
      setReportMarkdown(body.markdown);
    } catch {
      setReportError("Report generation failed. Check your connection.");
    } finally {
      setReportLoading(false);
    }
  }, [id]);

  const openReport = useCallback(() => {
    setReportOpen(true);
    if (!reportMarkdown && !reportLoading) void generateReport();
  }, [reportMarkdown, reportLoading, generateReport]);

  const handleUnlocked = useCallback(() => {
    setUnlocked(true);
    setNeedsPayment(false);
    void generateReport();
  }, [generateReport]);

  const handleSelect = useCallback((node: GraphNode | null) => {
    setSelected(node);
    setExpandError(null);
  }, []);

  const handleExpand = useCallback(
    async (node: GraphNode) => {
      setSelected(node);
      setExpanding(true);
      setExpandError(null);
      let added = false;
      try {
        const res = await fetch(`/api/expand/${encodeURIComponent(node.id)}`);
        if (!res.ok) throw new Error(`expand failed: ${res.status}`);
        const payload = (await res.json()) as ExpandPayload;
        const counts = addEntities(payload.nodes ?? [], payload.links ?? []);
        added = counts.nodes > 0 || counts.links > 0;
      } catch {
        // Demo insurance: pull the node's 1-hop neighborhood from the
        // bundled fixture instead of failing the interaction.
        added = expandFromFixture(node.id, addEntities);
      } finally {
        setExpanding(false);
      }
      if (!added) {
        setExpandError("No new connections found for this node.");
      }
    },
    [addEntities],
  );

  const handleHighlight = useCallback(
    (next: Highlight | null) => setHighlight(next),
    [setHighlight],
  );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink lg:flex-row">
      {/* Graph canvas */}
      <div className="relative h-[60dvh] min-w-0 flex-1 lg:h-auto lg:min-h-[100dvh]">
        <LiveGraph
          data={data}
          status={status}
          highlight={highlight}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          onExpand={handleExpand}
        />

        <header className="pointer-events-none absolute left-5 top-5">
          <Link
            href="/"
            className="pointer-events-auto text-sm font-semibold tracking-tight text-ink"
          >
            Rivalry
          </Link>
          <p className="mt-0.5 font-mono text-[11px] text-ink-2">
            session {id}
          </p>
        </header>

        <div className="absolute bottom-5 left-5">
          <GraphLegend nodes={data.nodes} />
        </div>

        <div className="absolute right-5 top-5">
          <UserMenu />
        </div>
      </div>

      {/* Right rail */}
      <aside className="flex w-full shrink-0 flex-col border-t border-line bg-canvas lg:h-[100dvh] lg:w-[360px] lg:border-l lg:border-t-0">
        <div className="border-b border-line px-5 py-4">
          <StreamStatus
            status={status}
            stage={stage}
            nodeCount={data.nodes.length}
            linkCount={data.links.length}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected && (
            <NodeDetailPanel
              node={selected}
              data={data}
              expanding={expanding}
              expandError={expandError}
              onExpand={handleExpand}
              onClose={() => handleSelect(null)}
            />
          )}
          <InsightCards
            insights={insights}
            pending={status === "connecting" || status === "streaming"}
            highlight={highlight}
            onHighlight={handleHighlight}
          />

          <div className="border-t border-line px-5 py-4">
            <button
              type="button"
              onClick={openReport}
              className="w-full rounded-[6px] border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface active:scale-[0.98]"
            >
              Full landscape report
            </button>
          </div>
        </div>

        <div className="h-72 shrink-0 border-t border-line">
          <AgentChat
            key={unlocked ? "unlocked" : "metered"}
            sessionId={id}
            onHighlight={handleHighlight}
            paywallSlot={
              <div>
                <p className="text-sm text-ink-2">
                  You have used your 5 free questions. The full report unlocks
                  unlimited questions for this session.
                </p>
                <button
                  type="button"
                  onClick={openReport}
                  className="mt-3 rounded-[6px] bg-ink px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333333] active:scale-[0.98]"
                >
                  Unlock the report
                </button>
              </div>
            }
          />
        </div>
      </aside>

      {/* Report overlay: paywall until purchased, then the rendered report */}
      {reportOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
          <div className="mx-auto max-w-4xl px-6 py-10">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold tracking-tight text-ink">
                  Rivalry
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-2">
                  full landscape report - session {id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="rounded-[6px] border border-line px-4 py-2 text-sm text-ink transition-colors hover:bg-surface"
              >
                Back to graph
              </button>
            </div>

            {reportLoading ? (
              <ReportView markdown={null} loading />
            ) : reportMarkdown ? (
              <ReportView markdown={reportMarkdown} />
            ) : needsPayment ? (
              <PaywallCard sessionId={id} onUnlocked={handleUnlocked} />
            ) : (
              <ReportView markdown={null} error={reportError} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
