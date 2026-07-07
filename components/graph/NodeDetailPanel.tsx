"use client";

/**
 * NodeDetailPanel -- right-rail detail view for the selected node.
 * White surface, hairline dividers, definition-list properties in mono,
 * a funding timeline for companies, and ALWAYS the source URLs
 * (provenance on click is a core demo beat).
 */

import { useMemo } from "react";
import type { GraphLink, GraphNode, NodeLabel } from "@/lib/types";
import type { GraphData } from "@/hooks/useGraphStream";
import {
  endpointId,
  formatUsd,
  LABEL_TEXT,
  LABEL_WASH,
} from "./graph-utils";

const HIDDEN_KEYS = new Set([
  "id",
  "label",
  "name",
  "community",
  "pagerank",
  "source_url",
  "x",
  "y",
  "vx",
  "vy",
  "fx",
  "fy",
  "index",
  "__indexColor",
]);

interface NodeDetailPanelProps {
  node: GraphNode;
  data: GraphData;
  expanding: boolean;
  expandError: string | null;
  onExpand: (node: GraphNode) => void;
  /** Opens the full company-history timeline popup (Company nodes only). */
  onTimeline?: (node: GraphNode) => void;
  onClose: () => void;
}

export default function NodeDetailPanel({
  node,
  data,
  expanding,
  expandError,
  onExpand,
  onTimeline,
  onClose,
}: NodeDetailPanelProps) {
  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of data.nodes) map.set(n.id, n);
    return map;
  }, [data]);

  const incident = useMemo(
    () =>
      data.links.filter(
        (link) =>
          endpointId(link.source) === node.id ||
          endpointId(link.target) === node.id,
      ),
    [data, node.id],
  );

  const properties = useMemo(() => {
    const rows: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(node)) {
      if (HIDDEN_KEYS.has(key) || value == null) continue;
      if (Array.isArray(value)) {
        const scalars = value.filter(
          (v) => typeof v === "string" || typeof v === "number",
        );
        if (scalars.length) rows.push([key, scalars.join(", ")]);
        continue;
      }
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        rows.push([key, String(value)]);
      }
    }
    return rows;
  }, [node]);

  const fundingRounds = useMemo(() => {
    const rounds: Array<{
      round: GraphNode;
      participants: string[];
    }> = [];
    for (const link of incident) {
      if (link.type !== "RAISED" || endpointId(link.source) !== node.id) {
        continue;
      }
      const round = nodeById.get(endpointId(link.target));
      if (!round) continue;
      const participants = data.links
        .filter(
          (l) =>
            l.type === "PARTICIPATED_IN" &&
            endpointId(l.target) === round.id,
        )
        .map((l) => nodeById.get(endpointId(l.source))?.name)
        .filter((name): name is string => Boolean(name));
      rounds.push({ round, participants });
    }
    rounds.sort((a, b) =>
      String(a.round.announced_date ?? "").localeCompare(
        String(b.round.announced_date ?? ""),
      ),
    );
    return rounds;
  }, [incident, data, node.id, nodeById]);

  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of incident) {
      counts.set(link.type, (counts.get(link.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [incident]);

  const sourceUrls = useMemo(() => {
    const urls = new Set<string>();
    if (typeof node.source_url === "string" && node.source_url) {
      urls.add(node.source_url);
    }
    for (const link of incident) {
      const fromProps = link.props?.source_url;
      if (typeof fromProps === "string" && fromProps) urls.add(fromProps);
      const otherId =
        endpointId(link.source) === node.id
          ? endpointId(link.target)
          : endpointId(link.source);
      const other = nodeById.get(otherId);
      if (other?.label === "Source" && typeof other.url === "string") {
        urls.add(other.url);
      }
    }
    return [...urls];
  }, [node, incident, nodeById]);

  const label = node.label as NodeLabel;
  const hasBody =
    properties.length > 0 ||
    fundingRounds.length > 0 ||
    connectionCounts.length > 0;

  return (
    <section className="fade-up border-b border-line" aria-label="Node detail">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink ${LABEL_WASH[label] ?? "bg-surface border border-line"}`}
          >
            {LABEL_TEXT[label] ?? String(node.label)}
          </span>
          <h2 className="mt-2 truncate text-base font-semibold tracking-tight text-ink">
            {node.name}
          </h2>
          {(typeof node.pagerank === "number" ||
            typeof node.community === "number") && (
            <p className="mt-0.5 font-mono text-[11px] text-ink-2">
              {typeof node.community === "number" &&
                `community ${node.community}`}
              {typeof node.community === "number" &&
                typeof node.pagerank === "number" &&
                " · "}
              {typeof node.pagerank === "number" &&
                `pagerank ${node.pagerank.toFixed(4)}`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-[6px] border border-line px-2 py-0.5 text-sm leading-5 text-ink-2 transition hover:bg-surface active:scale-[0.98]"
        >
          Close
        </button>
      </div>

      <div className="space-y-5 px-5 py-5">
        {!hasBody && !expanding && (
          <p className="text-[13px] leading-5 text-ink-2">
            Nothing else recorded for this node yet. Expand it to pull its
            connections into the graph.
          </p>
        )}

        {properties.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
              Properties
            </h3>
            <dl className="mt-2 space-y-1.5">
              {properties.map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="w-28 shrink-0 text-xs text-ink-2">
                    {key.replace(/_/g, " ")}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-xs text-ink">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {fundingRounds.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
              Funding
            </h3>
            <ol className="mt-2 space-y-3 border-l border-line pl-4">
              {fundingRounds.map(({ round, participants }) => (
                <li key={round.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-node-investor" />
                  <p className="text-xs font-medium text-ink">
                    {String(round.round_type ?? round.name)}
                    <span className="ml-2 font-mono text-ink">
                      {formatUsd(
                        typeof round.amount_usd === "number"
                          ? round.amount_usd
                          : undefined,
                      )}
                    </span>
                  </p>
                  {typeof round.announced_date === "string" && (
                    <p className="font-mono text-[11px] text-ink-2">
                      {round.announced_date}
                    </p>
                  )}
                  {participants.length > 0 && (
                    <p className="mt-0.5 text-[11px] leading-4 text-ink-2">
                      {participants.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {connectionCounts.length > 0 && (
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
              Connections
            </h3>
            <dl className="mt-2 space-y-1">
              {connectionCounts.map(([type, count]) => (
                <div key={type} className="flex items-baseline justify-between">
                  <dt className="font-mono text-[11px] text-ink-2">{type}</dt>
                  <dd className="font-mono text-xs text-ink">{count}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
            Sources
          </h3>
          {sourceUrls.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {sourceUrls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-mono text-[11px] text-accent underline decoration-line underline-offset-2 hover:decoration-accent"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] leading-5 text-ink-2">
              No sources recorded for this node.
            </p>
          )}
        </div>

        <div>
          {label === "Company" && onTimeline && (
            <button
              type="button"
              onClick={() => onTimeline(node)}
              className="mb-2 w-full rounded-[6px] border border-line px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface active:scale-[0.98]"
            >
              Company timeline
            </button>
          )}
          <button
            type="button"
            onClick={() => onExpand(node)}
            disabled={expanding}
            className="w-full rounded-[6px] bg-ink px-3 py-2 text-sm font-medium text-white transition hover:bg-[#333333] active:scale-[0.98] disabled:cursor-default disabled:opacity-50"
          >
            {expanding ? "Expanding" : "Expand connections"}
          </button>
          {expanding && (
            <div className="mt-3 space-y-2">
              <div className="shimmer h-3 w-full rounded" />
              <div className="shimmer h-3 w-4/5 rounded" />
              <div className="shimmer h-3 w-3/5 rounded" />
            </div>
          )}
          {expandError && !expanding && (
            <p className="mt-2 text-xs text-[#B42318]">{expandError}</p>
          )}
        </div>
      </div>
    </section>
  );
}
