"use client";

/**
 * MonitorPanel -- a live news-monitor agent for the session watchlist.
 *
 * Runs itself: it starts a scan as soon as the session mounts, then keeps
 * watching on an interval (the Daytona agent + RocketRide pipe behind
 * /api/monitor). New signals animate in and carry a brief "new" pulse;
 * prior signals stay put. Polling pauses while the tab is hidden and
 * fires an immediate catch-up scan when it returns to the foreground.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type SignalKind =
  | "funding"
  | "launch"
  | "acquisition"
  | "shutdown"
  | "product"
  | "market"
  | "other";

interface NewsSignal {
  headline: string;
  url: string;
  date?: string | null;
  source: string;
  kind: SignalKind;
  companies_mentioned: string[];
  relevance: number;
  summary: string;
}

interface MonitorReport {
  signals: NewsSignal[];
  engines: {
    fetch: "daytona" | "local" | "demo";
    classify: "rocketride" | "gateway" | "heuristic" | "demo";
    reachedLive: string[];
  };
  watchlist: string[];
  fetched_docs: number;
}

/** How often the agent re-checks the wire. */
const POLL_INTERVAL_MS = 90_000;
/** How long a freshly-arrived signal keeps its "new" pulse. */
const NEW_PULSE_MS = 8_000;

const KIND_STYLE: Record<SignalKind, { label: string; className: string }> = {
  funding: { label: "Funding", className: "bg-[#EAF3EC] text-[#2F6B45]" },
  acquisition: { label: "Acquisition", className: "bg-[#EDEBF6] text-[#4B3F86]" },
  shutdown: { label: "Shutdown", className: "bg-[#F7EAEA] text-[#B42318]" },
  launch: { label: "Launch", className: "bg-[#EAF0F7] text-[#2F5A8C]" },
  product: { label: "Product", className: "bg-[#F1F0EE] text-[#5B564E]" },
  market: { label: "Market", className: "bg-[#F5F1E9] text-[#8A6A2F]" },
  other: { label: "News", className: "bg-[#F1F0EE] text-[#5B564E]" },
};

const FETCH_LABEL: Record<MonitorReport["engines"]["fetch"], string> = {
  daytona: "Daytona agent",
  local: "local fetch",
  demo: "demo",
};

const CLASSIFY_LABEL: Record<MonitorReport["engines"]["classify"], string> = {
  rocketride: "RocketRide pipe",
  gateway: "Butterbase gateway",
  heuristic: "heuristic",
  demo: "demo",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatDate(date?: string | null): string {
  if (!date) return "";
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface MonitorPanelProps {
  sessionId: string;
}

export default function MonitorPanel({ sessionId }: MonitorPanelProps) {
  const [signals, setSignals] = useState<NewsSignal[]>([]);
  const [engines, setEngines] = useState<MonitorReport["engines"] | null>(null);
  const [status, setStatus] = useState<"idle" | "checking" | "live" | "error">(
    "idle",
  );
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [newUrls, setNewUrls] = useState<Set<string>>(() => new Set());

  const inFlightRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scan = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus((prev) => (prev === "live" ? "live" : "checking"));
    try {
      const res = await fetch(
        `/api/monitor?sessionId=${encodeURIComponent(sessionId)}`,
      );
      const data = (await res.json()) as MonitorReport & { error?: string };
      if (!mountedRef.current) return;
      if (!res.ok || data.error) {
        setStatus((prev) => (signalsCountRef.current > 0 ? "live" : "error"));
      } else {
        const fresh = data.signals.filter((s) => !seenRef.current.has(s.url));
        for (const s of fresh) seenRef.current.add(s.url);

        setSignals((prev) => {
          const byUrl = new Map(prev.map((s) => [s.url, s]));
          for (const s of data.signals) byUrl.set(s.url, s);
          return [...byUrl.values()].sort(
            (a, b) =>
              b.relevance - a.relevance ||
              (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0),
          );
        });
        setEngines(data.engines);
        setLastChecked(Date.now());
        setStatus("live");

        if (fresh.length > 0) {
          setNewUrls(new Set(fresh.map((s) => s.url)));
          if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
          pulseTimerRef.current = setTimeout(() => {
            if (mountedRef.current) setNewUrls(new Set());
          }, NEW_PULSE_MS);
        }
      }
    } catch {
      if (mountedRef.current) {
        setStatus((prev) => (signalsCountRef.current > 0 ? "live" : "error"));
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId]);

  // Keep a ref of the current signal count for the catch handlers above
  // (so a transient poll failure never wipes an already-live feed).
  const signalsCountRef = useRef(0);
  useEffect(() => {
    signalsCountRef.current = signals.length;
  }, [signals]);

  // Self-starting: scan on mount, then poll; pause when hidden, catch up
  // on return to foreground.
  useEffect(() => {
    mountedRef.current = true;
    scan();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") scan();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") scan();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, [scan]);

  const firstLoad = status === "checking" && signals.length === 0;

  return (
    <section className="border-t border-line px-5 py-5" aria-label="News monitor">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`relative flex h-2 w-2 ${
              status === "error" ? "" : "monitor-live-dot"
            }`}
            aria-hidden="true"
          >
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                status === "error"
                  ? "bg-[#B42318]"
                  : status === "live"
                    ? "bg-[#2F6B45]"
                    : "bg-[#8A6A2F]"
              }`}
            />
          </span>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">
            News monitor
          </h2>
        </div>
        <span className="font-mono text-[11px] text-ink-2">
          {status === "checking" && signals.length === 0
            ? "starting…"
            : status === "checking"
              ? "checking…"
              : lastChecked
                ? formatClock(lastChecked)
                : ""}
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-5 text-ink-2">
        A Daytona agent continuously watches TechCrunch, Google News, and Hacker
        News for funding, launches, and acquisitions across this landscape; the
        RocketRide pipe classifies what it finds.
      </p>

      {firstLoad && (
        <div className="mt-4 space-y-3">
          <div className="shimmer h-20 rounded-lg" />
          <div className="shimmer h-20 rounded-lg" />
        </div>
      )}

      {status === "error" && signals.length === 0 && (
        <p className="mt-3 text-xs text-[#B42318]">
          The monitor is unreachable. Retrying automatically…
        </p>
      )}

      {signals.length > 0 && (
        <ul className="mt-4 space-y-3">
          {signals.map((s) => {
            const style = KIND_STYLE[s.kind];
            const host = hostOf(s.url);
            const date = formatDate(s.date);
            const isNew = newUrls.has(s.url);
            return (
              <li
                key={s.url}
                className={`rounded-lg border p-3 fade-up transition-colors ${
                  isNew
                    ? "border-[#2F6B45]/40 bg-[#F1F7F3]"
                    : "border-line bg-surface"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${style.className}`}
                  >
                    {style.label}
                  </span>
                  {isNew && (
                    <span className="rounded-full bg-[#2F6B45] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                      New
                    </span>
                  )}
                  {date && (
                    <span className="font-mono text-[10px] text-ink-2">
                      {date}
                    </span>
                  )}
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-sm font-medium leading-snug text-ink hover:text-accent"
                >
                  {s.headline}
                </a>
                <p className="mt-1 text-[13px] leading-5 text-ink-2">
                  {s.summary}
                </p>
                {host && (
                  <p className="mt-1.5 font-mono text-[10px] text-ink-2">
                    {host}
                    {s.companies_mentioned.length > 0 &&
                      ` · ${s.companies_mentioned.join(", ")}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {engines && (
        <p className="mt-4 font-mono text-[10px] leading-4 text-ink-2">
          Fetched by {FETCH_LABEL[engines.fetch]} · classified by{" "}
          {CLASSIFY_LABEL[engines.classify]}
          {engines.reachedLive.length > 0 && (
            <> · live: {engines.reachedLive.join(", ")}</>
          )}
        </p>
      )}
    </section>
  );
}
