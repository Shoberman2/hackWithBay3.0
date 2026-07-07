"use client";

/**
 * CompanyTimeline -- the popup that opens when a Company node is clicked.
 * One chronological startup story: founding, every raise (+investors),
 * launches, founder posts, positioning shifts, traction milestones,
 * hiring, exit. Graph-known events render instantly; live enrichment from
 * /api/timeline/:id streams in and merges (deduped) with a "live" tag.
 * Every event keeps its source link — provenance on click is the beat.
 */

import { useEffect, useMemo, useState } from "react";
import type { GraphNode } from "@/lib/types";
import type { GraphData } from "@/hooks/useGraphStream";
import {
  buildTimelineFromGraph,
  mergeTimelineEvents,
  type TimelineEvent,
  type TimelineEventKind,
} from "@/lib/timeline";
import { LABEL_WASH } from "./graph-utils";

const KIND_META: Record<TimelineEventKind, { label: string; color: string }> = {
  founded: { label: "Founded", color: "#3E8E68" },
  funding: { label: "Funding", color: "#B8863B" },
  launch: { label: "Launch", color: "#A85D6E" },
  post: { label: "Founder post", color: "#83729B" },
  traction: { label: "Traction", color: "#5C8B7E" },
  positioning: { label: "Positioning", color: "#7A8699" },
  hiring: { label: "Hiring", color: "#4E8E96" },
  acquisition: { label: "Exit", color: "#4F6D9E" },
  milestone: { label: "Milestone", color: "#6B7280" },
  news: { label: "News", color: "#A3A19C" },
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDate(date?: string): string {
  if (!date) return "Undated";
  const [y, m, d] = date.split("-");
  const month = m ? MONTHS[Number(m) - 1] : undefined;
  if (month && d) return `${month} ${Number(d)}, ${y}`;
  if (month) return `${month} ${y}`;
  return y;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/* Session-lifetime cache: reopening a company never refetches. */
const enrichmentCache = new Map<string, TimelineEvent[]>();

interface CompanyTimelineProps {
  company: GraphNode;
  data: GraphData;
  onClose: () => void;
}

export default function CompanyTimeline({
  company,
  data,
  onClose,
}: CompanyTimelineProps) {
  const graphTimeline = useMemo(
    () => buildTimelineFromGraph(company.id, data),
    [company.id, data],
  );

  const [liveEvents, setLiveEvents] = useState<TimelineEvent[]>(
    () => enrichmentCache.get(company.id) ?? [],
  );
  const [enriching, setEnriching] = useState(
    () => !enrichmentCache.has(company.id),
  );
  const [activeKinds, setActiveKinds] = useState<Set<TimelineEventKind>>(
    () => new Set(),
  );

  /* Live enrichment: news, archives, filings, HN — once per company. */
  useEffect(() => {
    if (enrichmentCache.has(company.id)) {
      setLiveEvents(enrichmentCache.get(company.id) ?? []);
      setEnriching(false);
      return;
    }
    const controller = new AbortController();
    setEnriching(true);
    const params = new URLSearchParams({ name: company.name });
    if (typeof company.url === "string" && company.url) {
      params.set("url", company.url);
    }
    fetch(`/api/timeline/${encodeURIComponent(company.id)}?${params}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((body: { events?: TimelineEvent[] }) => {
        const events = Array.isArray(body.events) ? body.events : [];
        enrichmentCache.set(company.id, events);
        setLiveEvents(events);
      })
      .catch(() => {
        /* graph events still render; enrichment is additive */
      })
      .finally(() => {
        if (!controller.signal.aborted) setEnriching(false);
      });
    return () => controller.abort();
  }, [company.id, company.name, company.url]);

  /* Esc to close. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const events = useMemo(
    () => mergeTimelineEvents(graphTimeline.events, liveEvents),
    [graphTimeline.events, liveEvents],
  );

  const kindsPresent = useMemo(() => {
    const present = new Map<TimelineEventKind, number>();
    for (const e of events) present.set(e.kind, (present.get(e.kind) ?? 0) + 1);
    return present;
  }, [events]);

  const visible = useMemo(
    () =>
      activeKinds.size === 0
        ? events
        : events.filter((e) => activeKinds.has(e.kind)),
    [events, activeKinds],
  );

  /* Group by year for the rail; undated events land in a trailing group. */
  const yearGroups = useMemo(() => {
    const groups: Array<{ year: string; events: TimelineEvent[] }> = [];
    for (const e of visible) {
      const year = e.date ? e.date.slice(0, 4) : "Undated";
      const last = groups[groups.length - 1];
      if (last && last.year === year) last.events.push(e);
      else groups.push({ year, events: [e] });
    }
    return groups;
  }, [visible]);

  const sourceCount = useMemo(
    () => new Set(events.map((e) => e.source_url).filter(Boolean)).size,
    [events],
  );

  const toggleKind = (kind: TimelineEventKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const meta: string[] = [];
  if (typeof company.founded_year === "number")
    meta.push(`est. ${company.founded_year}`);
  if (typeof company.hq === "string" && company.hq) meta.push(company.hq);
  if (typeof company.stage === "string" && company.stage)
    meta.push(company.stage);
  if (typeof company.status === "string" && company.status)
    meta.push(company.status);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`${company.name} timeline`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fade-up flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-6 pb-4 pt-5">
          <div className="flex min-w-0 items-start gap-3">
            {typeof company.logo_url === "string" && company.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo_url}
                alt=""
                className="mt-0.5 h-8 w-8 rounded-md border border-line bg-white object-contain p-1"
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                  {company.name}
                </h2>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink ${LABEL_WASH.Company}`}
                >
                  Timeline
                </span>
              </div>
              {meta.length > 0 && (
                <p className="mt-0.5 font-mono text-[11px] text-ink-2">
                  {meta.join(" · ")}
                </p>
              )}
              {typeof company.description === "string" && (
                <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-ink-2">
                  {company.description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close timeline"
            className="rounded-[6px] border border-line px-2 py-0.5 text-sm leading-5 text-ink-2 transition hover:bg-surface active:scale-[0.98]"
          >
            Close
          </button>
        </div>

        {/* Filter chips */}
        {kindsPresent.size > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-3">
            <button
              type="button"
              onClick={() => setActiveKinds(new Set())}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                activeKinds.size === 0
                  ? "border-ink bg-ink text-white"
                  : "border-line text-ink-2 hover:bg-surface"
              }`}
            >
              All {events.length}
            </button>
            {[...kindsPresent.entries()].map(([kind, count]) => (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                  activeKinds.has(kind)
                    ? "border-ink bg-ink text-white"
                    : "border-line text-ink-2 hover:bg-surface"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: KIND_META[kind].color }}
                />
                {KIND_META[kind].label} {count}
              </button>
            ))}
          </div>
        )}

        {/* Timeline body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {visible.length === 0 && !enriching && (
            <p className="text-[13px] leading-5 text-ink-2">
              No dated history recorded for this company yet. Expand its
              connections in the graph to pull more sources.
            </p>
          )}

          {yearGroups.map((group) => (
            <div key={group.year} className="mb-6 last:mb-0">
              <h3 className="mb-3 font-mono text-[11px] font-medium tracking-[0.08em] text-ink-2">
                {group.year}
              </h3>
              <ol className="space-y-4 border-l border-line pl-5">
                {group.events.map((event) => (
                  <li key={event.id} className="relative">
                    <span
                      className="absolute -left-[26.5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-canvas"
                      style={{ background: KIND_META[event.kind].color }}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] text-ink-2">
                        {formatDate(event.date)}
                      </span>
                      <span
                        className="text-[10px] font-medium uppercase tracking-[0.08em]"
                        style={{ color: KIND_META[event.kind].color }}
                      >
                        {KIND_META[event.kind].label}
                      </span>
                      {event.origin === "live" && (
                        <span className="rounded-full border border-line px-1.5 text-[9px] uppercase tracking-[0.08em] text-ink-2">
                          live
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] font-medium leading-5 text-ink">
                      {event.title}
                    </p>
                    {event.detail && (
                      <p className="mt-0.5 text-xs leading-5 text-ink-2">
                        {event.detail}
                      </p>
                    )}
                    {event.source_url && (
                      <a
                        href={event.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-block font-mono text-[11px] text-accent underline decoration-line underline-offset-2 hover:decoration-accent"
                      >
                        {hostOf(event.source_url)}
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {enriching && (
            <div className="mt-2 space-y-2 border-l border-line pl-5">
              <p className="font-mono text-[11px] text-ink-2">
                Pulling live history — news, web archives, SEC filings, HN…
              </p>
              <div className="shimmer h-3 w-4/5 rounded" />
              <div className="shimmer h-3 w-3/5 rounded" />
              <div className="shimmer h-3 w-2/3 rounded" />
            </div>
          )}

          {/* Moat context: undated, but part of the whole story */}
          {graphTimeline.moats.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
                Claimed moat
              </h3>
              {graphTimeline.moats.map((moat) => (
                <div key={moat.id} className="mt-2">
                  <p className="text-xs font-medium text-ink">
                    {moat.type.replace(/-/g, " ")}
                    {typeof moat.confidence === "number" && (
                      <span className="ml-2 font-mono text-[11px] font-normal text-ink-2">
                        confidence {moat.confidence.toFixed(2)}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-2">
                    {moat.summary}
                  </p>
                  {moat.source_url && (
                    <a
                      href={moat.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-block font-mono text-[11px] text-accent underline decoration-line underline-offset-2 hover:decoration-accent"
                    >
                      {hostOf(moat.source_url)}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line px-6 py-3">
          <p className="font-mono text-[11px] text-ink-2">
            {events.length} events · {sourceCount} sources
            {enriching ? " · enriching…" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
