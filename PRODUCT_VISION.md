# Product Vision: Rivalry

## Vision

Rivalry turns a founder's earliest startup idea into a living competitive landscape graph. Instead of asking founders to assemble 40 browser tabs into a flat spreadsheet, Rivalry shows the companies, founders, investors, features, sources, and white-space opportunities around an idea as connected evidence.

The product belief is simple: relationships are the intelligence. Rows hide the signal.

## Who It Serves

Rivalry is for idea-stage founders who are validating a market before they have a product, customer list, or known competitor set. Their first strategic question is not "what did a named competitor announce?" It is "who is already in this space, how are they connected, and where is the opening?"

Existing competitive intelligence tools serve teams that already know their market. Rivalry serves the founder at day zero.

## Product Promise

A founder enters a plain-language idea, answers a short sharpening interview, and watches a live graph assemble around the market. The graph becomes the workspace for reasoning:

- Which companies cluster around the same segment?
- Which founders share prior employers or operator backgrounds?
- Which investors repeatedly back this category?
- Which features are table stakes versus white space?
- Which claims are backed by inspectable sources?

The output is not a generic market report. It is a source-backed graph that explains why the landscape looks the way it does.

## Core Experience

1. **Idea input.** The founder types a rough idea, such as "internship platform."
2. **Clarifying interview.** The agent asks focused questions to narrow buyer, geography, business model, and segment.
3. **Live graph construction.** Rivalry discovers companies, people, investors, features, launch events, and sources, then links them into Neo4j.
4. **Graph-native exploration.** The founder clicks nodes or asks natural-language questions that resolve to traversals and graph algorithms.
5. **Source-backed report.** A free report draft summarizes competitive clusters, white space, founder patterns, and positioning recommendations.
6. **Industry updates.** The founder opts in to receive private updates when new source-backed signals appear in the market.

## Why Graph-Native

Rivalry should only ship features that need relationships to be useful. The graph is not decoration; it is the product surface and the reasoning layer.

- Shared investor paths reveal capital clusters.
- Founder lineage reveals talent and category formation patterns.
- Feature and launch edges reveal leaders versus fast followers.
- Community detection surfaces real competitive clusters.
- Centrality highlights the company everyone else is positioned against.
- Source edges make every claim inspectable.

## Product Principles

- **Relationships over rows.** If a feature works just as well in a spreadsheet, it is not core.
- **Trust through provenance.** Every meaningful node and edge should trace back to a source.
- **Depth over exhaustiveness.** A smaller graph with useful relationships beats a broad list of shallow facts.
- **Founder-speed insight.** The first valuable graph should appear in minutes, not after a research project.
- **Sharp scope.** Avoid ongoing monitoring, social scraping, and "all public information" traps in the first build.

## MVP Shape

The MVP should prove one polished end-to-end path:

- Founder idea input and onboarding questions.
- Pre-warmed internship-platform demo graph.
- Live incremental graph build for a fresh query.
- Clickable graph nodes and evidence trail.
- Two graph-native questions: shared investors and white space.
- Free landscape report draft backed by Butterbase scans, source artifacts, and RAG evidence.
- Opt-in industry update subscription and in-app update inbox.

## Technology Roles

- **Neo4j:** Stores and queries the competitive landscape graph. Traversals, centrality, and community detection are the core intelligence.
- **RocketRide Cloud:** Runs discovery, extraction, deduplication, graph writes, and insight generation as a deployed agent pipeline.
- **Butterbase:** Handles Google auth, saved sessions, onboarding answers, graph Q&A, realtime events, industry update subscriptions, source artifacts, RAG evidence, functions, and model gateway calls. The flow has no paywall.
- **Cognee, optional:** Remembers founder context and prior scans across sessions.

## Success Criteria

Rivalry succeeds when a founder can enter a vague idea and leave with a defensible point of view:

- The major players are visible.
- The relevant people, investors, features, and sources are connected.
- The white space is explained by graph structure, not hand-wavy copy.
- The founder can click through evidence and trust the recommendation.
- The demo makes it obvious that Neo4j, RocketRide, and Butterbase are load-bearing.

## Demo Thesis

"Every founder starts with 40 tabs and a spreadsheet. Spreadsheets cannot show relationships. Rivalry maps your competitive landscape as a graph, then uses that graph to show who matters, how they connect, and where the opening is."
