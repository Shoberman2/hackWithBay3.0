"use client";

/**
 * Session view -- the product moment. Fluid graph canvas on the left,
 * 360px rail on the right: stream status, selected-node detail, insight
 * cards, and the agent chat. Fully functional in DEMO_MODE via the
 * fixture replay inside useGraphStream.
 */

import { use, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GraphNode } from "@/lib/types";
import type { Highlight } from "@/hooks/useGraphStream";
import { useProgressiveGraph } from "@/hooks/useProgressiveGraph";
import LiveGraph from "@/components/graph/LiveGraph";
import SummaryTable from "@/components/graph/SummaryTable";
import NodeDetailPanel from "@/components/graph/NodeDetailPanel";
import InsightCards from "@/components/graph/InsightCards";
import GraphLegend from "@/components/graph/GraphLegend";
import StreamStatus from "@/components/graph/StreamStatus";
import PaywallCard from "@/components/report/PaywallCard";
import ReportView from "@/components/report/ReportView";
import UserMenu from "@/components/account/UserMenu";
import AuthGate from "@/components/onboarding/AuthGate";
import { useAuth } from "@/components/account/AuthProvider";
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

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading: authLoading, refresh: refreshAuth } = useAuth();
  const {
    data,
    status,
    insights,
    expand,
    highlight,
    setHighlight,
    revealedCount,
    totalCount,
  } = useProgressiveGraph(id);

  const [view, setView] = useState<"graph" | "table">("graph");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

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
    setReportMarkdown(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, stream: true }),
      });
      if (res.status === 402) {
        setNeedsPayment(true);
        return;
      }
      // Cached reports come back as JSON; fresh ones stream as text/plain.
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = (await res.json()) as { markdown?: string; error?: string };
        if (!res.ok || !body.markdown) {
          setReportError(body.error ?? "Report generation failed. Try again.");
          return;
        }
        setNeedsPayment(false);
        setReportMarkdown(body.markdown);
        return;
      }
      if (!res.ok || !res.body) {
        setReportError("Report generation failed. Try again.");
        return;
      }
      // Consume the token stream, revealing markdown as it arrives.
      setNeedsPayment(false);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (first) {
          setReportLoading(false); // show text while the rest streams in
          first = false;
        }
        setReportMarkdown(acc);
      }
      acc += decoder.decode();
      setReportMarkdown(acc);
      if (!acc) {
        setReportError("Report generation failed. Try again.");
      }
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
    (node: GraphNode) => {
      setSelected(node);
      setExpandError(null);
      const added = expand(node);
      if (added.nodes === 0 && added.links === 0) {
        setExpandError("Every connection for this node is already on the graph.");
      }
    },
    [expand],
  );

  // Selecting a company in the table reveals + focuses it on the graph.
  const handleSelectCompany = useCallback(
    (nodeId: string) => {
      setView("graph");
      expand({ id: nodeId } as GraphNode);
      setFocusId(nodeId);
    },
    [expand],
  );

  useEffect(() => {
    if (!focusId) return;
    const node = data.nodes.find((n) => n.id === focusId);
    if (node) {
      setSelected(node);
      setExpandError(null);
      setFocusId(null);
    }
  }, [focusId, data.nodes]);

  const handleHighlight = useCallback(
    (next: Highlight | null) => setHighlight(next),
    [setHighlight],
  );

  if (authLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-canvas">
        <div className="shimmer h-9 w-44 rounded-[6px]" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-canvas px-6">
        <div className="mb-8 max-w-sm text-center">
          <p className="text-sm font-semibold tracking-tight text-ink">Rivalry</p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">
            Sign in to open this landscape
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            Sessions are private to your account.
          </p>
        </div>
        <AuthGate
          reason="Sign in to view and explore this competitive graph."
          onAuthenticated={() => void refreshAuth()}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink lg:flex-row">
      {/* Graph / table canvas */}
      <div className="relative h-[60dvh] min-w-0 flex-1 lg:h-auto lg:min-h-[100dvh]">
        {view === "graph" ? (
          <LiveGraph
            data={data}
            status={status}
            highlight={highlight}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            onExpand={handleExpand}
          />
        ) : (
          <div className="h-full pt-16">
            <SummaryTable
              sessionId={id}
              selectedId={selected?.id ?? null}
              onSelectCompany={handleSelectCompany}
            />
          </div>
        )}

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

        {/* Graph / Table view toggle */}
        <div className="absolute left-1/2 top-5 -translate-x-1/2">
          <div className="flex rounded-full border border-line bg-canvas p-0.5 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            {(["graph", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full px-3.5 py-1 text-xs font-medium capitalize transition-colors ${
                  view === v ? "bg-ink text-white" : "text-ink-2 hover:text-ink"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {view === "graph" && status === "done" && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
            <span className="rounded-full border border-line bg-canvas/90 px-3 py-1 font-mono text-[11px] text-ink-2 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
              Tap a node to reveal its connections · {revealedCount}/{totalCount} shown
            </span>
          </div>
        )}

        {view === "graph" && (
          <div className="absolute bottom-5 left-5">
            <GraphLegend nodes={data.nodes} />
          </div>
        )}

        <div className="absolute right-5 top-5">
          <UserMenu />
        </div>
      </div>

      {/* Right rail */}
      <aside className="flex w-full shrink-0 flex-col border-t border-line bg-canvas lg:h-[100dvh] lg:w-[360px] lg:border-l lg:border-t-0">
        <div className="border-b border-line px-5 py-4">
          <StreamStatus
            status={status}
            stage={null}
            nodeCount={data.nodes.length}
            linkCount={data.links.length}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected && (
            <NodeDetailPanel
              node={selected}
              data={data}
              expanding={false}
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
