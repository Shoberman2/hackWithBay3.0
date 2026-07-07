# Rivalry: Competitive Landscape Graphs for Idea-Stage Founders

**HackwithBay 3.0 submission. Built on Neo4j, RocketRide Cloud, and Butterbase.**

---

## 1. What This Is

Rivalry is a competitive intelligence tool for founders at the absolute earliest stage: the moment they have an idea and nothing else. You type your idea in plain language ("internship platform"), answer a short onboarding flow that sharpens what you actually mean, and Rivalry builds a live, explorable graph of the competitive landscape around that idea: the companies, the founders behind them, the investors funding them, the features they have shipped, and how all of it connects.

The core insight: existing competitive intel tools (Crayon, Klue, Contify) are built for companies that already exist and already know who their competitors are. They are monitoring tools. Nobody serves the founder at day zero, whose real question is not "what did my competitor tweet" but "who is already in this space, how are they connected, and where is the white space." That question is fundamentally a graph question, and today founders answer it with 40 open Chrome tabs and a Google Doc.

## 2. The Problem

When a founder starts validating an idea, they do competitive research manually:

- Google "[idea] startups" and click through 20 results
- Search Product Hunt, Hacker News, and YC's company directory
- Stalk founders on LinkedIn to understand their backgrounds
- Try to figure out who raised, from whom, and when
- Build a flat spreadsheet that captures none of the relationships

This takes days, is instantly stale, and the flat format hides the most important signals. A spreadsheet cannot show you that three of your "competitors" share a lead investor, that four founders in the space all left the same company, or that everyone clusters around one feature set while an adjacent segment sits empty. Relationships are the intelligence. Rows destroy them.

## 3. The Product

### User flow

1. **Idea input.** Founder types a one-line idea: "internship platform."
2. **Onboarding interview.** An agent asks 4 to 6 sharpening questions, because "internship platform" is ambiguous. Marketplace or ATS? Students or employers as the paying side? US or global? University-partnered or direct? Each answer narrows the search space and tags the session.
3. **Live graph construction.** The ingestion pipeline kicks off. The graph populates in front of the user as entities are discovered and connected: companies appear, then founder nodes attach, then investor nodes, then feature and launch nodes. Watching the landscape assemble itself is the product moment.
4. **Exploration and insight.** The user can click any node to expand it, or ask the agent natural-language questions that get answered via graph traversal: "which of these companies share investors," "who pivoted into this space from something else," "what feature does everyone have that I should treat as table stakes."
5. **Report.** A paid tier generates a full written landscape report from the graph: competitive clusters, white space analysis, founder pattern analysis, and a positioning recommendation.

### What makes it graph-native, not a database with extra steps

The judging criteria explicitly penalize using Neo4j as a glorified key-value store. Rivalry's core queries are traversals and algorithms that have no clean SQL equivalent:

- **Shared-investor paths.** Two "competitors" connected through a common lead investor is a 2-hop traversal and a major strategic signal (they will not both die; one may get merged into the other).
- **Founder lineage.** WORKED_AT edges reveal talent clusters: "four founders in this space came out of Handshake." That is a pattern query across relationships, invisible in rows.
- **Feature parity lag.** Directed SHIPPED_AFTER edges between launch events with a lag property show who leads and who fast-follows in the space.
- **Community detection.** Run Louvain or label propagation over the company-feature-audience subgraph to discover the actual competitive clusters instead of trusting marketing categories. The white space is the gap between communities.
- **Centrality.** PageRank or betweenness over the full graph surfaces the company everyone else is positioned against, which is the company the founder must differentiate from.

## 4. Graph Schema (Neo4j)

### Node labels

| Label | Key properties |
|---|---|
| `Idea` | text, session_id, created_at, refined_tags[] |
| `Company` | name, url, description, stage, founded_year, hq, status (active/dead/acquired) |
| `Founder` | name, linkedin_url (if surfaced by search), background_summary |
| `Investor` | name, type (VC/angel/accelerator), notable |
| `Feature` | name, category, description |
| `LaunchEvent` | title, date, source, url |
| `Segment` | name (e.g. "university-partnered", "SMB employers") |
| `Source` | url, type (HN/PH/GitHub/blog), fetched_at |
| `FundingRound` | round_type, amount_usd, announced_date |
| `WebsiteSnapshot` | url, captured_at, positioning_summary, digest |
| `Post` | title, url, platform (HN/PH/blog/GitHub), posted_at |
| `MoatClaim` | type (network-effects/data/distribution/brand/switching-costs), summary, confidence |
| `TractionSignal` | metric (users/stars/votes/app_ratings/web_rank), value, observed_at |

### Relationship types

| Relationship | From → To | Properties |
|---|---|---|
| `COMPETES_IN` | Company → Segment | confidence |
| `FOUNDED` | Founder → Company | year, role |
| `WORKED_AT` | Founder → Company | years, role |
| `INVESTED_IN` | Investor → Company | round, year, lead (bool) |
| `HAS_FEATURE` | Company → Feature | first_seen |
| `SHIPPED` | Company → LaunchEvent | |
| `SHIPPED_AFTER` | LaunchEvent → LaunchEvent | lag_days |
| `TARGETS` | Company → Segment | |
| `RELEVANT_TO` | Company → Idea | relevance_score |
| `CITED_BY` | LaunchEvent → Source | |
| `RAISED` | Company → FundingRound | |
| `PARTICIPATED_IN` | Investor → FundingRound | lead (bool) |
| `HAD_SNAPSHOT` | Company → WebsiteSnapshot | |
| `NEXT_SNAPSHOT` | WebsiteSnapshot → WebsiteSnapshot | messaging_changed (bool) |
| `POSTED` | Founder → Post | |
| `ABOUT` | Post → Company | |
| `CLAIMS_MOAT` | Company → MoatClaim | |
| `EVIDENCED_BY` | MoatClaim → Source | |
| `HAS_TRACTION` | Company → TractionSignal | |

`INVESTED_IN` is kept as a direct convenience edge (shared-investor traversals stay 2-hop); `FundingRound` nodes carry the full history — round type, amount, date, participants. `WebsiteSnapshot` chains give positioning history ("this competitor pivoted messaging twice in 18 months"). `Post` nodes give founder activity timelines. `MoatClaim` is derived intelligence — an LLM analysis pass over each company's accumulated evidence — and must cite `Source` nodes like any other fact. `TractionSignal` captures user-base indicators over time.

Every claim in the graph traces back to a Source node. No orphan facts. This matters for trust and for the demo ("click any edge, see where it came from").

## 5. Architecture and Stack Mapping

All three mandatory technologies are load-bearing. None are bolted on.

### Neo4j (mandatory)

The graph above IS the product. The agent answers user questions by generating Cypher, running traversals, and executing GDS algorithms (community detection, centrality). Neo4j Aura free tier for the hackathon.

### RocketRide Cloud (mandatory)

Hosts the ingestion and enrichment pipeline as a managed production endpoint the app calls. Pipeline stages:

1. **Query expansion.** Idea + onboarding answers → search query set.
2. **Discovery.** Hit the data sources (below), collect raw candidate pages.
3. **Entity extraction.** LLM pass turns raw content into typed entities and relationships matching the schema.
4. **Deduplication and linking.** Match extracted entities against existing graph nodes.
5. **Graph write.** Batched Cypher MERGE statements into Neo4j.
6. **Insight pass.** Trigger GDS algorithms, write derived edges (clusters, centrality scores) back.

Built locally in the RocketRide VS Code extension, deployed to cloud.rocketride.ai. A local-only pipeline fails the mandatory requirement, so deployment happens early, not at 4pm.

### Butterbase (mandatory)

- **Auth:** founder accounts, session management.
- **Database:** user profiles, saved sessions, onboarding answers, query history, report artifacts.
- **AI gateway:** all LLM calls (onboarding agent, entity extraction, report generation) route through the Butterbase model gateway rather than raw provider keys.
- **Payments (explicit requirement):** the full written landscape report is gated behind a one-time purchase. Free tier gets the live graph and 5 agent questions; the report and unlimited questions are paid. Payment is in active use in the core flow, which the rules demand.

### Cognee (optional bonus)

Agent memory across sessions. When a founder returns or refines their idea, the agent remembers what it already ingested and only fetches deltas. Also remembers the founder's own context ("user cares about the university-partnered segment") so follow-up questions get sharper. Cheap points, natural fit.

### Daytona (integrated) — two lanes

**1. Q&A compute lane.** When a founder asks a quantitative question (rankings, averages, distributions, funding totals), the agent writes a small Python script and executes it in a disposable Daytona sandbox with the exported session graph mounted as JSON — LLM-generated code never runs in the app process. The sandbox output feeds the final answer and is shown in the chat under "Sandbox analysis · Daytona".

**2. News-monitor agent (with RocketRide).** A Daytona sandbox agent watches the famous startup-news platforms — TechCrunch, Google News, Hacker News — for funding, launches, acquisitions, and shutdowns across the session's watchlist. The agent attempts a live pull of each platform from inside the sandbox and always dedups + relevance-scores + kind-tags every document against the watchlist; the RocketRide-hosted `rivalry-monitor` pipe then classifies the result into typed `NewsSignal`s (via the Butterbase gateway). Rendered in the right rail as the **News monitor** panel (on-demand "Scan for news"). See `lib/monitor.ts` and `pipelines/rivalry-monitor.pipe`.

Both lanes degrade cleanly: demo mode and missing credentials fall back to canned/heuristic results so the product never dead-ends. *Note: some Daytona accounts restrict sandbox outbound egress; when the sandbox can't reach the news hosts the agent still runs its scoring compute over app-fetched seed documents, and the `reachedLive` field reports which hosts (if any) were pulled live.*

## 6. Data Sources

Chosen entirely for being scriptable in an afternoon without fighting anti-bot systems:

| Source | What it provides | Access |
|---|---|---|
| Hacker News (Algolia API) | Launch posts, Show HN, discussion sentiment | Free, no auth |
| Product Hunt GraphQL API | Launches, taglines, categories, makers | Free tier |
| GitHub API | Release cadence, org activity, contributor overlap | Free tier |
| Company blogs / changelogs / RSS | Feature releases, positioning language | Public fetch |
| YC company directory | Batch, description, founders for YC companies | Public |
| LLM web search (via gateway) | Founder backgrounds, funding announcements, everything else | Gateway |
| Clay (MCP / API) | Verified funding totals, latest round, investor lists, employee counts, founder identification | Paid credits (workspace already provisioned) |
| Wayback Machine CDX API | Website history: positioning pivots, dead products, pricing changes | Free, no auth |
| SEC EDGAR Form D | US raise amounts + dates from actual filings | Free (declared User-Agent required) |
| TechCrunch / Google News RSS | Funding announcements as they happen | Free, no auth |
| HN author queries (Algolia) | Founder posting history (stories + comments per username) | Free, no auth |
| GitHub GraphQL `stargazers(starredAt)` | Star history over time (REST endpoint is now gated) | Free tier w/ PAT |
| Tranco / Cloudflare Radar | Domain rank over time (traction trend; top-1M only) | Free |
| Apple iTunes Lookup | App rating counts + release cadence for mobile products | Free, no auth |

**The accuracy layer:** free sources find and connect the landscape; Clay verifies the facts that matter. Clay aggregates paid enrichment providers (funding, investors, headcount) behind per-credit pricing — no enterprise contract — and is the fact-checker for every Company node that makes it into the graph. Validated on Handshake: exact latest round ($200M) and correct investor list (EQT Ventures, General Catalyst, Kleiner Perkins, True Ventures). Crunchbase's API is enterprise-license only and PitchBook starts around $12-30k/yr with no self-serve path, so Clay + EDGAR + press RSS is the indie-accessible way to get accurate funding data.

**Explicitly out:** LinkedIn scraping, X/Twitter scraping, Crunchbase API (enterprise-only licensing). LinkedIn and X actively block scraping and will burn the whole day. Founder posting history comes from HN, Product Hunt, GitHub, and personal blog RSS instead — the platforms where technical founders actually post publicly.

## 7. Scope Discipline

What is IN for the hackathon:

- One polished end-to-end flow: idea → onboarding → live graph → agent Q&A → paid report
- One or two pre-warmed demo verticals (internship platforms, plus one backup) with the pipeline already run so the demo cannot die on stage
- Live incremental pipeline run for one fresh query during the demo, with the pre-warmed graph as fallback
- 20 to 40 companies per vertical. Depth of connection beats breadth of coverage

What is OUT:

- Ongoing monitoring, alerts, or scheduled re-crawls (that is the Crayon business, not this one)
- Founder posting schedules and social media tracking (scraping trap, low signal at idea stage anyway)
- "All public information." The pitch is not exhaustiveness. It is that the relationships are the intelligence

## 8. Demo Script (3 minutes)

1. **Cold open (20s).** "Every founder starts with 40 Chrome tabs and a spreadsheet. Spreadsheets can't show relationships. Relationships are the intelligence."
2. **Type the idea (20s).** "internship platform." Answer 3 onboarding questions live.
3. **The moment (60s).** Graph builds on screen. Companies, founders, investors, features connecting in real time. This is the visual judges remember.
4. **Graph reasoning (60s).** Ask two questions that showcase traversal: "which competitors share investors" (path lights up), "where is the white space" (community detection result, empty cluster highlighted).
5. **Close (20s).** Click "generate full report," hit the Butterbase paywall, pay, report renders. All three mandatory technologies shown load-bearing in one flow.

## 9. Honest Risks

- **Live pipeline on stage.** Ingestion latency is unpredictable. Mitigation: pre-warmed graphs, and the "live" run streams into an already-rich graph so even a slow pipeline shows movement.
- **Entity extraction quality.** LLM extraction will hallucinate or misattribute. Mitigation: every fact carries a Source edge, extraction prompt requires citations, low-confidence facts render visually distinct.
- **This is a one-shot product.** As a business, idea-stage founders use this once and they are broke. Retention is near zero. That is fine for a hackathon and honestly fine for the one-time-payment model the Butterbase requirement forces anyway. Do not pitch it as a SaaS with recurring revenue; pitch it as the first tool in the founder journey.
- **Graph washing.** Biggest disqualification risk per the judging criteria. Mitigation is baked into the product: the headline demo moments (shared investors, white space, lineage) are literally impossible without traversal.

## 10. Name

**Rivalry.** Says what it maps, needs zero explanation in the pitch's first sentence: "Rivalry maps your competitive landscape as a graph." Backup: Flank.

## 11. Team Task Split (assuming 2 to 3 people)

- **Pipeline:** RocketRide stages, source connectors, extraction prompts, deploy to cloud early
- **Graph + agent:** Neo4j schema, GDS setup, Cypher generation agent, Cognee memory
- **Frontend + Butterbase:** live graph viz (force-directed, streaming node arrival), onboarding flow, auth, payment gate, report renderer

First milestone by hour 3: one company flowing end to end from a search result to a rendered node on screen. Everything else is iteration on a working spine.
