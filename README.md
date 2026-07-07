# Rivalry: Competitive Landscape Graphs for Idea-Stage Founders

**Built on Neo4j, RocketRide Cloud, and Butterbase. Free for founders.**

See [PRODUCT_VISION.md](/Users/shoberman/charityChecker/PRODUCT_VISION.md) for the distilled product vision derived from this plan.

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
5. **Report.** A free source-backed landscape memo is generated from the graph: competitive clusters, white space analysis, founder pattern analysis, and a positioning recommendation.
6. **Industry updates.** The founder can opt in to receive private in-app updates for the saved market, with an email preference stored for future delivery.

### What makes it graph-native, not a database with extra steps

Rivalry's core queries are traversals and algorithms that have no clean SQL equivalent:

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

Every claim in the graph traces back to a Source node. No orphan facts. This matters for trust and for the demo ("click any edge, see where it came from").

## 5. Architecture and Stack Mapping

All three platform layers are load-bearing. None are bolted on.

### Neo4j

The graph above IS the product. The agent answers user questions by generating Cypher, running traversals, and executing GDS algorithms such as community detection and centrality.

### RocketRide Cloud

Hosts the ingestion and enrichment pipeline as a managed production endpoint the app calls. Pipeline stages:

1. **Query expansion.** Idea + onboarding answers → search query set.
2. **Discovery.** Hit the data sources (below), collect raw candidate pages.
3. **Entity extraction.** LLM pass turns raw content into typed entities and relationships matching the schema.
4. **Deduplication and linking.** Match extracted entities against existing graph nodes.
5. **Graph write.** Batched Cypher MERGE statements into Neo4j.
6. **Insight pass.** Trigger GDS algorithms, write derived edges (clusters, centrality scores) back.

Built locally in the RocketRide VS Code extension and designed to run as a remote pipeline endpoint rather than a local-only background script.

### Butterbase

- **Auth:** Google sign-in for founder accounts and persistent sessions.
- **Database:** user profiles, saved sessions, onboarding answers, graph Q&A, source artifacts, report drafts, and realtime pipeline events.
- **Row-level security:** every saved scan table is isolated by `user_id`.
- **Realtime:** graph and pipeline rows are configured for live updates as the ingestion flow writes new data.
- **Industry updates:** opt-in subscriptions and update inbox items are stored privately, with a scheduled function that can generate fresh in-app digest rows.
- **Storage:** source-backed evidence bundles are saved as private JSON artifacts.
- **RAG:** compact source memos are ingested so the agent can answer follow-up questions from saved evidence.
- **Functions:** a free brief function generates next questions and report-prep hints for a saved scan.
- **AI gateway:** onboarding, extraction, and report generation can route through Butterbase rather than raw provider keys.
- **No paywall:** saved scans, questions, evidence bundles, and report drafts are free to use. Billing and checkout are intentionally absent.

### Cognee (optional bonus)

Agent memory across sessions. When a founder returns or refines their idea, the agent remembers what it already ingested and only fetches deltas. It also remembers the founder's own context ("user cares about the university-partnered segment") so follow-up questions get sharper.

### Daytona (optional, likely cut)

Could give the agent a sandbox to run ad-hoc analysis scripts over exported graph data. Nice to have, not core. Cut if time is tight, which it will be.

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

**Explicitly out:** LinkedIn scraping, X/Twitter scraping, Crunchbase API. LinkedIn and X actively block scraping and will burn the whole day. Crunchbase is paywalled. Funding and founder background data comes from web search over press coverage instead, which is lower fidelity but actually works.

## 7. Scope Discipline

What is in scope:

- One polished end-to-end flow: idea → onboarding → live graph → agent Q&A → free report draft
- One or two pre-warmed verticals, starting with internship platforms
- Live incremental pipeline run for a fresh query, with the pre-warmed graph as fallback
- 20 to 40 companies per vertical. Depth of connection beats breadth of coverage

What is out of scope:

- Ongoing monitoring, alerts, or scheduled re-crawls (that is the Crayon business, not this one)
- Founder posting schedules and social media tracking (scraping trap, low signal at idea stage anyway)
- "All public information." The pitch is not exhaustiveness. It is that the relationships are the intelligence

## 8. Guided Walkthrough

1. **Cold open (20s).** "Every founder starts with 40 Chrome tabs and a spreadsheet. Spreadsheets can't show relationships. Relationships are the intelligence."
2. **Type the idea (20s).** "internship platform." Answer 3 onboarding questions live.
3. **The moment (60s).** Graph builds on screen. Companies, founders, investors, and features connect in real time.
4. **Graph reasoning (60s).** Ask two questions that showcase traversal: "which competitors share investors" (path lights up), "where is the white space" (community detection result, empty cluster highlighted).
5. **Close (20s).** Click "save private scan," show the Butterbase-backed free report draft, source artifact, RAG memo, and realtime event records.

## 9. Honest Risks

- **Live pipeline on stage.** Ingestion latency is unpredictable. Mitigation: pre-warmed graphs, and the "live" run streams into an already-rich graph so even a slow pipeline shows movement.
- **Entity extraction quality.** LLM extraction will hallucinate or misattribute. Mitigation: every fact carries a Source edge, extraction prompt requires citations, low-confidence facts render visually distinct.
- **This is a one-shot product.** Idea-stage founders may use this most intensely at the start of a company. Rivalry should earn repeat use by becoming the saved research workspace as the idea changes.
- **Graph washing.** The mitigation is baked into the product: the headline moments (shared investors, white space, lineage) are literally impossible without traversal.

## 10. Name

**Rivalry.** Says what it maps, needs zero explanation in the pitch's first sentence: "Rivalry maps your competitive landscape as a graph." Backup: Flank.

## 11. Team Task Split (assuming 2 to 3 people)

- **Pipeline:** RocketRide stages, source connectors, extraction prompts, deploy to cloud early
- **Graph + agent:** Neo4j schema, GDS setup, Cypher generation agent, Cognee memory
- **Frontend + Butterbase:** live graph viz (force-directed, streaming node arrival), onboarding flow, Google auth, saved scans, free report renderer

First milestone: one company flowing end to end from a search result to a rendered node on screen. Everything else is iteration on a working spine.

## 12. Local Prototype Setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` for real service credentials. Keep service keys and database passwords in `.env.local`; it is ignored by git.

### Butterbase

The frontend is wired through [src/lib/butterbase.ts](/Users/shoberman/charityChecker/src/lib/butterbase.ts). Apply [butterbase/schema.json](/Users/shoberman/charityChecker/butterbase/schema.json) and enable the policies in [butterbase/rls.json](/Users/shoberman/charityChecker/butterbase/rls.json).

```bash
npm run setup:butterbase
```

The setup command dry-runs and applies the schema, enables RLS, configures realtime for the user-owned tables, restricts storage to private artifacts, deploys the free brief and industry-update functions, and optionally configures Google OAuth when `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are present. All core features are free; there is no checkout, billing flow, or paid report gate.

### Neo4j

Add the generated Aura URI, username, password, and database name to `.env.local`, then seed the graph:

```bash
npm run neo4j:seed
```

The schema and demo data live in [neo4j/schema.cypher](/Users/shoberman/charityChecker/neo4j/schema.cypher) and [neo4j/seed.cypher](/Users/shoberman/charityChecker/neo4j/seed.cypher).
