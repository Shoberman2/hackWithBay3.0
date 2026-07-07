/**
 * News monitor: a Daytona-hosted agent + the RocketRide-hosted
 * classification pipe. Watches the famous startup-news platforms
 * (TechCrunch, Google News, Hacker News) for funding, launches,
 * acquisitions, and shutdowns affecting a session's watchlist.
 *
 * Stage 1 — MONITOR AGENT (Daytona). A Python agent runs inside a
 * disposable Daytona sandbox. It is given the watchlist plus a set of
 * app-fetched seed documents, and it (a) attempts a live fetch of each
 * platform from within the sandbox network, then (b) merges, deduplicates,
 * relevance-scores, and kind-tags every document against the watchlist.
 * Step (b) is pure compute and always runs; step (a) lights up wherever
 * the sandbox is granted outbound egress. `reached` reports which hosts
 * the sandbox actually pulled live.
 *
 * Stage 2 — CLASSIFY (RocketRide). The scored documents go to the deployed
 * rivalry-monitor .pipe (LLM node via the Butterbase gateway), which
 * returns typed NewsSignals.
 *
 * Fallback ladder (demo insurance):
 * - DEMO_MODE or no compute engines -> canned demo signals.
 * - Seed fetch always runs app-side (reliable egress) so the agent never
 *   starves. No Daytona -> score in-process.
 * - No RocketRide -> classify via the gateway; gateway down -> heuristic.
 */

import path from "node:path";
import { Daytona } from "@daytonaio/sdk";
import { z } from "zod";
import { env, hasDaytona, hasGateway, hasRocketRide } from "@/lib/env";
import type { RawDoc } from "@/lib/types";
import { chatJSON } from "@/lib/gateway";
import { invokePipe } from "@/lib/rocketride";
import { fetchVentureNews } from "@/lib/sources";

function debug(...args: unknown[]): void {
  if (env.DEBUG) console.error("[monitor]", ...args);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export const newsSignalSchema = z.object({
  headline: z.string(),
  url: z.string(),
  date: z.string().nullish(),
  source: z.string().default("news"),
  kind: z.enum([
    "funding",
    "launch",
    "acquisition",
    "shutdown",
    "product",
    "market",
    "other",
  ]),
  companies_mentioned: z.array(z.string()).default([]),
  relevance: z.number().min(0).max(1),
  summary: z.string(),
});

export type NewsSignal = z.infer<typeof newsSignalSchema>;

export type FetchEngine = "daytona" | "local" | "demo";
export type ClassifyEngine = "rocketride" | "gateway" | "heuristic" | "demo";

export interface MonitorReport {
  signals: NewsSignal[];
  engines: {
    fetch: FetchEngine;
    classify: ClassifyEngine;
    /** Hosts the Daytona sandbox pulled live (empty when egress blocked). */
    reachedLive: string[];
  };
  watchlist: string[];
  fetched_docs: number;
}

/** A seed document enriched by the Daytona agent with a score and kind. */
interface ScoredDoc extends RawDoc {
  relevance: number;
  kind: NewsSignal["kind"];
  companies_mentioned: string[];
}

/* ------------------------------------------------------------------ */
/* Stage 1: monitor agent (Daytona sandbox)                            */
/* ------------------------------------------------------------------ */

const AGENT_INPUT_PATH = "/home/daytona/input.json";
const AGENT_TIMEOUT_S = 120;
const MAX_DOCS = 40;

/**
 * The monitor agent. Fixed code (never LLM-generated), stdlib only.
 * Attempts a live pull of each platform, then merges with the seed docs
 * and scores everything. Prints { reached, docs } as JSON.
 */
const MONITOR_AGENT = `
import json, re, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

with open("${AGENT_INPUT_PATH}") as f:
    payload = json.load(f)

companies = payload.get("companies", [])[:8]
seeds = payload.get("seed_documents", [])

reached = []
docs = list(seeds)

def fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": "rivalry-monitor"})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "ignore")

def strip_html(text):
    return re.sub(r"\\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()

def rss(url, source, host):
    try:
        root = ET.fromstring(fetch(url).encode("utf-8"))
        got = 0
        for item in root.iter("item"):
            link = (item.findtext("link") or "").strip()
            if not link:
                continue
            title = strip_html(item.findtext("title") or link)
            body = strip_html(item.findtext("description") or "")
            docs.append({
                "url": link,
                "source_type": source,
                "title": title,
                "text": (title + ". " + body)[:2000],
                "date": (item.findtext("pubDate") or "").strip() or None,
            })
            got += 1
        if got and host not in reached:
            reached.append(host)
    except Exception:
        pass

# Live pull attempt (works where the sandbox is granted egress).
rss("https://techcrunch.com/category/venture/feed/", "techcrunch", "techcrunch.com")
for c in companies:
    q = urllib.parse.quote('"%s"' % c)
    rss("https://news.google.com/rss/search?q=%s&hl=en-US&gl=US&ceid=US:en" % q,
        "google-news", "news.google.com")
for c in companies:
    try:
        data = json.loads(fetch(
            "https://hn.algolia.com/api/v1/search?query=%s&tags=story&hitsPerPage=4"
            % urllib.parse.quote(c)))
        for hit in data.get("hits", []):
            url = hit.get("url") or ("https://news.ycombinator.com/item?id=%s" % hit.get("objectID"))
            title = hit.get("title") or ""
            if title:
                docs.append({"url": url, "source_type": "hackernews", "title": title,
                             "text": title[:500], "date": hit.get("created_at")})
        if "hn.algolia.com" not in reached:
            reached.append("hn.algolia.com")
    except Exception:
        pass

# Dedup by url.
seen, deduped = set(), []
for d in docs:
    u = d.get("url")
    if not u or u in seen:
        continue
    seen.add(u)
    deduped.append(d)

# Score against the watchlist and tag a coarse kind.
KIND = [
    ("funding", r"raises?|raised|series [a-f]|seed round|funding|valuation|\\$\\d"),
    ("acquisition", r"acquires?|acquired|acquisition|merges?|buyout"),
    ("shutdown", r"shuts? down|shutting down|winds? down|closes|bankrupt|lays? off"),
    ("launch", r"launches?|launched|unveils?|introduces|debuts?"),
    ("product", r"feature|update|releases?|version|integration"),
]

def score(doc):
    text = ((doc.get("title") or "") + " " + (doc.get("text") or ""))
    mentioned = [c for c in companies if re.search(r"\\b%s\\b" % re.escape(c), text, re.I)]
    kind = "other"
    for k, pat in KIND:
        if re.search(pat, text, re.I):
            kind = k
            break
    if mentioned:
        rel = 0.9
    elif kind == "funding":
        rel = 0.45
    else:
        rel = 0.2
    doc["companies_mentioned"] = mentioned
    doc["kind"] = kind
    doc["relevance"] = rel
    return doc

scored = [score(d) for d in deduped]
scored = [d for d in scored if d["relevance"] >= 0.3]
scored.sort(key=lambda d: d["relevance"], reverse=True)

print(json.dumps({"reached": reached, "docs": scored[:${MAX_DOCS}]}))
`;

const agentResultSchema = z.object({
  reached: z.array(z.string()).default([]),
  docs: z.array(
    z.object({
      url: z.string(),
      source_type: z.string().default("news"),
      title: z.string(),
      text: z.string().default(""),
      date: z.string().nullish(),
      relevance: z.number(),
      kind: newsSignalSchema.shape.kind,
      companies_mentioned: z.array(z.string()).default([]),
    }),
  ),
});

async function runDaytonaAgent(
  companies: string[],
  seeds: RawDoc[],
): Promise<{ reached: string[]; docs: ScoredDoc[] }> {
  const daytona = new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    ...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
  });
  const sandbox = await daytona.create({ language: "python" });
  try {
    await sandbox.fs.uploadFile(
      Buffer.from(JSON.stringify({ companies, seed_documents: seeds })),
      AGENT_INPUT_PATH,
    );
    const response = await sandbox.process.codeRun(
      MONITOR_AGENT,
      undefined,
      AGENT_TIMEOUT_S,
    );
    if (response.exitCode !== 0) {
      throw new Error(
        `monitor agent exited ${response.exitCode}: ${response.result.slice(0, 300)}`,
      );
    }
    const parsed = agentResultSchema.parse(JSON.parse(response.result.trim()));
    return { reached: parsed.reached, docs: parsed.docs as ScoredDoc[] };
  } finally {
    try {
      await sandbox.delete();
    } catch (err) {
      debug("sandbox delete failed", err);
    }
  }
}

/** No-Daytona fallback: score the seed docs in-process (same rules). */
function scoreLocally(companies: string[], docs: RawDoc[]): ScoredDoc[] {
  const kindPatterns: Array<[NewsSignal["kind"], RegExp]> = [
    ["funding", /\b(raises?|raised|series [a-f]|seed round|funding|valuation|\$\d)/i],
    ["acquisition", /\b(acquires?|acquired|acquisition|merges?|buyout)/i],
    ["shutdown", /\b(shuts? down|shutting down|winds? down|closes|bankrupt|lays? off)/i],
    ["launch", /\b(launches?|launched|unveils?|introduces|debuts?)/i],
    ["product", /\b(feature|update|releases?|version|integration)/i],
  ];
  const scored: ScoredDoc[] = [];
  for (const doc of docs) {
    const text = `${doc.title} ${doc.text}`;
    const mentioned = companies.filter((c) =>
      new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
    );
    const kind = kindPatterns.find(([, p]) => p.test(text))?.[0] ?? "other";
    const relevance = mentioned.length > 0 ? 0.9 : kind === "funding" ? 0.45 : 0.2;
    if (relevance < 0.3) continue;
    scored.push({ ...doc, relevance, kind, companies_mentioned: mentioned });
  }
  return scored.sort((a, b) => b.relevance - a.relevance).slice(0, MAX_DOCS);
}

/* ------------------------------------------------------------------ */
/* Stage 2: classification (RocketRide pipe -> gateway -> heuristic)   */
/* ------------------------------------------------------------------ */

const MONITOR_PIPE_PATH = path.join(
  process.cwd(),
  "pipelines",
  "rivalry-monitor.pipe",
);

const signalsResponseSchema = z.object({ signals: z.array(newsSignalSchema) });

function parseSignals(raw: unknown): NewsSignal[] {
  return signalsResponseSchema
    .parse(raw)
    .signals.filter((s) => s.relevance >= 0.3)
    .sort((a, b) => b.relevance - a.relevance);
}

const CLASSIFY_SYSTEM_PROMPT =
  "You classify news documents for a competitive-landscape monitor. " +
  'Respond with ONLY JSON: {"signals":[{"headline","url","date","source","kind","companies_mentioned","relevance","summary"}]}. ' +
  "kind is one of funding|launch|acquisition|shutdown|product|market|other. relevance is 0-1 " +
  "(1 = directly about a watchlist company; below 0.3 drop the item). url/date copied verbatim " +
  "from the input document. summary is one factual sentence grounded in the document. One signal per underlying story.";

async function classifyViaRocketRide(
  companies: string[],
  tags: string[],
  docs: ScoredDoc[],
): Promise<NewsSignal[]> {
  const result = await invokePipe(MONITOR_PIPE_PATH, "rivalry-monitor", {
    companies,
    tags,
    raw_documents: docs,
  });
  return parseSignals(result);
}

async function classifyViaGateway(
  companies: string[],
  tags: string[],
  docs: ScoredDoc[],
): Promise<NewsSignal[]> {
  const result = await chatJSON<unknown>(
    [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ companies, tags, raw_documents: docs }),
      },
    ],
    { temperature: 0, purpose: "generic" },
  );
  return parseSignals(result);
}

/** No-LLM fallback: the agent's own scoring becomes the signal set. */
function signalsFromScored(docs: ScoredDoc[]): NewsSignal[] {
  return docs.slice(0, 20).map((d) => ({
    headline: d.title,
    url: d.url,
    date: d.date ?? null,
    source: d.source_type,
    kind: d.kind,
    companies_mentioned: d.companies_mentioned,
    relevance: d.relevance,
    summary: d.title,
  }));
}

/* ------------------------------------------------------------------ */
/* Demo signals                                                        */
/* ------------------------------------------------------------------ */

const DEMO_SIGNALS: NewsSignal[] = [
  {
    headline: "Handshake raises $200M Series F to connect students with employers",
    url: "https://techcrunch.com/2022/01/20/handshake-series-f/",
    date: "2022-01-20T14:00:00.000Z",
    source: "techcrunch",
    kind: "funding",
    companies_mentioned: ["Handshake"],
    relevance: 1,
    summary:
      "Handshake raised a $200M Series F led by EQT Ventures with General Catalyst, Kleiner Perkins, and True Ventures participating.",
  },
  {
    headline: "RippleMatch raises $45M to boost job-matching technology",
    url: "https://techcrunch.com/2021/05/12/ripplematch-series-b/",
    date: "2021-05-12T12:00:00.000Z",
    source: "techcrunch",
    kind: "funding",
    companies_mentioned: ["RippleMatch"],
    relevance: 1,
    summary:
      "RippleMatch raised $45M to expand its automated matching of college students to internships and entry-level roles.",
  },
  {
    headline: "WayUp raises $18.5M Series B for early-career recruiting",
    url: "https://techcrunch.com/2017/07/11/wayup-series-b/",
    date: "2017-07-11T12:00:00.000Z",
    source: "techcrunch",
    kind: "funding",
    companies_mentioned: ["WayUp"],
    relevance: 1,
    summary:
      "WayUp raised an $18.5M Series B to grow its job-search platform for college students and recent graduates.",
  },
];

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

/** True when the monitor runs its live compute lanes (not canned demo). */
export function usesLiveMonitor(): boolean {
  return !env.DEMO_MODE && (hasDaytona() || hasGateway());
}

/**
 * Run the monitor for a watchlist: seed docs are fetched app-side, the
 * Daytona agent pulls/scores them, and the RocketRide pipe (or gateway)
 * classifies the result into NewsSignals.
 */
export async function runMonitor(
  companies: string[],
  tags: string[] = [],
): Promise<MonitorReport> {
  const watchlist = companies.filter(Boolean).slice(0, 8);

  if (env.DEMO_MODE || (!hasDaytona() && !hasGateway())) {
    return {
      signals: DEMO_SIGNALS,
      engines: { fetch: "demo", classify: "demo", reachedLive: [] },
      watchlist,
      fetched_docs: DEMO_SIGNALS.length,
    };
  }

  // Seed documents from the app (reliable egress) so the agent never starves.
  const seeds = await fetchVentureNews(watchlist);

  // Stage 1: the Daytona agent (fresh-pull attempt + always-on scoring).
  let scored: ScoredDoc[] = [];
  let fetchEngine: FetchEngine = "local";
  let reachedLive: string[] = [];
  if (hasDaytona()) {
    try {
      const result = await runDaytonaAgent(watchlist, seeds);
      scored = result.docs;
      reachedLive = result.reached;
      fetchEngine = "daytona";
    } catch (err) {
      debug("daytona agent failed, scoring locally:", err);
    }
  }
  if (scored.length === 0) {
    scored = scoreLocally(watchlist, seeds);
    if (fetchEngine !== "daytona") fetchEngine = "local";
  }

  // Stage 2: classify.
  let signals: NewsSignal[] = [];
  let classifyEngine: ClassifyEngine = "heuristic";
  if (hasRocketRide()) {
    try {
      signals = await classifyViaRocketRide(watchlist, tags, scored);
      classifyEngine = "rocketride";
    } catch (err) {
      debug("rocketride classify failed:", err);
    }
  }
  if (signals.length === 0 && classifyEngine !== "rocketride" && hasGateway()) {
    try {
      signals = await classifyViaGateway(watchlist, tags, scored);
      classifyEngine = "gateway";
    } catch (err) {
      debug("gateway classify failed:", err);
    }
  }
  if (signals.length === 0) {
    signals = signalsFromScored(scored);
    classifyEngine = "heuristic";
  }

  return {
    signals: signals.slice(0, 20),
    engines: { fetch: fetchEngine, classify: classifyEngine, reachedLive },
    watchlist,
    fetched_docs: scored.length,
  };
}
