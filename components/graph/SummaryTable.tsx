"use client";

/**
 * SummaryTable -- the graph, folded into a spreadsheet. Every Company node
 * becomes a row; its edges are summarized into columns (segment, funding
 * raised, features, traction, centrality). Sorting any column glides the
 * rows into their new order (framer-motion `layout`). Same light surface,
 * hairline dividers, and mono numerals as the rest of the app.
 *
 * Reads the full landscape from /api/graph/[sessionId] (fixture in demo),
 * independent of what the graph has revealed -- the table always summarizes
 * the whole market.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { GraphLink, GraphNode } from "@/lib/types";
import { endpointId, formatUsd } from "./graph-utils";
import demoGraphRaw from "@/fixtures/demo-graph.json";

const fixture = demoGraphRaw as unknown as { nodes: GraphNode[]; links: GraphLink[] };

interface Row {
  id: string;
  name: string;
  hq: string;
  segment: string;
  stage: string;
  stageRank: number;
  raised: number;
  investors: number;
  founded: number;
  employees: number;
  features: number;
  traction: number;
  centrality: number;
}

type SortKey =
  | "name"
  | "segment"
  | "stage"
  | "raised"
  | "founded"
  | "employees"
  | "features"
  | "traction"
  | "centrality";

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; align: "left" | "right" }> = [
  { key: "name", label: "Company", numeric: false, align: "left" },
  { key: "segment", label: "Segment", numeric: false, align: "left" },
  { key: "stage", label: "Stage", numeric: true, align: "left" },
  { key: "raised", label: "Raised", numeric: true, align: "right" },
  { key: "founded", label: "Founded", numeric: true, align: "right" },
  { key: "employees", label: "Team", numeric: true, align: "right" },
  { key: "features", label: "Features", numeric: true, align: "right" },
  { key: "traction", label: "Traction", numeric: true, align: "right" },
  { key: "centrality", label: "Centrality", numeric: true, align: "right" },
];

const GRID =
  "minmax(150px,1.6fr) minmax(120px,1.2fr) 92px 110px 84px 84px 88px 108px 108px";

const STAGE_RANK: Record<string, number> = {
  "Pre-seed": 0,
  Seed: 1,
  "Series A": 2,
  "Series B": 3,
  "Series C": 4,
  "Series D": 5,
  "Series E": 6,
  "Series F": 7,
  "Series G": 8,
  Public: 9,
  Acquired: 10,
};

function stageRank(stage: string | undefined): number {
  if (!stage) return -1;
  return STAGE_RANK[stage] ?? 1;
}

function compactNum(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(value);
}

function buildRows(nodes: GraphNode[], links: GraphLink[]): Row[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const companies = nodes.filter((n) => n.label === "Company");

  return companies.map((company) => {
    const segments: string[] = [];
    let raised = 0;
    let investors = 0;
    let features = 0;
    let traction = 0;

    for (const link of links) {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      const involvesAsSource = s === company.id;
      const involvesAsTarget = t === company.id;
      if (!involvesAsSource && !involvesAsTarget) continue;

      if ((link.type === "COMPETES_IN" || link.type === "TARGETS") && involvesAsSource) {
        const seg = byId.get(t);
        if (seg?.name) segments.push(String(seg.name));
      } else if (link.type === "RAISED" && involvesAsSource) {
        const round = byId.get(t);
        const amt = round?.amount_usd;
        if (typeof amt === "number") raised += amt;
      } else if (link.type === "INVESTED_IN" && involvesAsTarget) {
        investors += 1;
      } else if (link.type === "HAS_FEATURE" && involvesAsSource) {
        features += 1;
      } else if (link.type === "HAS_TRACTION" && involvesAsSource) {
        const signal = byId.get(t);
        const v = signal?.value;
        if (typeof v === "number") traction = Math.max(traction, v);
      }
    }

    return {
      id: company.id,
      name: String(company.name ?? company.id),
      hq: typeof company.hq === "string" ? company.hq : "",
      segment: segments[0] ?? "—",
      stage: typeof company.stage === "string" ? company.stage : "—",
      stageRank: stageRank(company.stage as string | undefined),
      raised,
      investors,
      founded: typeof company.founded_year === "number" ? company.founded_year : 0,
      employees: typeof company.employees === "number" ? company.employees : 0,
      features,
      traction,
      centrality: typeof company.pagerank === "number" ? company.pagerank : 0,
    };
  });
}

export default function SummaryTable({
  sessionId,
  onSelectCompany,
  selectedId,
}: {
  sessionId: string;
  onSelectCompany?: (id: string) => void;
  selectedId?: string | null;
}) {
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: fixture.nodes,
    links: fixture.links,
  });
  const [sortKey, setSortKey] = useState<SortKey>("raised");
  const [descending, setDescending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph/${encodeURIComponent(sessionId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { nodes?: GraphNode[]; links?: GraphLink[] } | null) => {
        if (cancelled || !body?.nodes?.length) return;
        setGraph({ nodes: body.nodes, links: body.links ?? [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const rows = useMemo(() => buildRows(graph.nodes, graph.links), [graph]);
  const maxRaised = useMemo(() => Math.max(1, ...rows.map((r) => r.raised)), [rows]);
  const maxCentrality = useMemo(
    () => Math.max(0.0001, ...rows.map((r) => r.centrality)),
    [rows],
  );

  const sorted = useMemo(() => {
    const value = (r: Row): number | string => {
      if (sortKey === "stage") return r.stageRank;
      return r[sortKey];
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === "string" && typeof bv === "string") {
        return descending ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return descending ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
  }, [rows, sortKey, descending]);

  function sortBy(key: SortKey, numeric: boolean) {
    if (key === sortKey) {
      setDescending((d) => !d);
      return;
    }
    setSortKey(key);
    setDescending(numeric);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-6 py-4">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          Landscape summary
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {rows.length} companies · sorted by{" "}
          <span className="text-ink">{COLUMNS.find((c) => c.key === sortKey)?.label}</span>{" "}
          {descending ? "high to low" : "low to high"}. Tap a header to re-sort, a row to
          focus it on the graph.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[900px]">
          {/* Header */}
          <div
            className="sticky top-0 z-10 grid items-center gap-3 border-b border-line bg-canvas px-6 py-2.5"
            style={{ gridTemplateColumns: GRID }}
          >
            {COLUMNS.map((col) => {
              const active = sortKey === col.key;
              return (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => sortBy(col.key, col.numeric)}
                  className={`flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors hover:text-ink ${
                    col.align === "right" ? "justify-end" : "justify-start"
                  } ${active ? "text-ink" : "text-ink-2"}`}
                >
                  <span>{col.label}</span>
                  {active ? (
                    <span className="font-mono text-[9px]">{descending ? "▼" : "▲"}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Rows */}
          <div>
            {sorted.map((row, index) => (
              <motion.button
                key={row.id}
                type="button"
                layout
                transition={{ type: "spring", stiffness: 500, damping: 42 }}
                onClick={() => onSelectCompany?.(row.id)}
                className={`grid w-full items-center gap-3 border-b border-line px-6 py-3 text-left transition-colors hover:bg-surface ${
                  selectedId === row.id ? "bg-wash-blue/60" : ""
                }`}
                style={{ gridTemplateColumns: GRID }}
              >
                {/* Company */}
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="w-4 shrink-0 font-mono text-[11px] text-ink-2">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {row.name}
                    </span>
                    {row.hq ? (
                      <span className="block truncate text-[11px] text-ink-2">{row.hq}</span>
                    ) : null}
                  </span>
                </div>

                {/* Segment */}
                <div className="min-w-0">
                  <span className="inline-flex max-w-full items-center truncate rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-2">
                    {row.segment}
                  </span>
                </div>

                {/* Stage */}
                <div className="text-[12px] text-ink">{row.stage}</div>

                {/* Raised */}
                <div className="text-right">
                  <span className="font-mono text-[13px] font-medium text-ink">
                    {row.raised > 0 ? formatUsd(row.raised) : "—"}
                  </span>
                  <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full rounded-full bg-node-investor"
                      style={{ width: `${(row.raised / maxRaised) * 100}%` }}
                    />
                  </span>
                </div>

                {/* Founded */}
                <div className="text-right font-mono text-[12px] text-ink-2">
                  {row.founded || "—"}
                </div>

                {/* Team */}
                <div className="text-right font-mono text-[12px] text-ink-2">
                  {row.employees ? compactNum(row.employees) : "—"}
                </div>

                {/* Features */}
                <div className="text-right font-mono text-[12px] text-ink">{row.features}</div>

                {/* Traction */}
                <div className="text-right font-mono text-[12px] text-ink">
                  {row.traction ? compactNum(row.traction) : "—"}
                </div>

                {/* Centrality */}
                <div className="text-right">
                  <span className="font-mono text-[12px] text-ink">
                    {row.centrality ? row.centrality.toFixed(3) : "—"}
                  </span>
                  <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full rounded-full bg-node-company"
                      style={{ width: `${(row.centrality / maxCentrality) * 100}%` }}
                    />
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
