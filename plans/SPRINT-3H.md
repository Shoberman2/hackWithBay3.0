# Rivalry — 3-Hour Sprint Plan

Supersedes the 8-hour pacing in PLAN.md. Same verified APIs (PLAN.md Phase 0 still applies — every endpoint there is live-tested). This document is the cut.

## The moat (say this in the pitch)

1. **Time-to-landscape: minutes, not days.** The founder's alternative is 40 tabs over a week. Rivalry compresses it to one onboarding flow.
2. **The graph compounds.** Every session enriches a shared graph — the 10th founder searching "internship platform" hits a warm, verified landscape instantly. Data network effect from user #2 onward. Crayon/Klue can't do this; their data is siloed per paying customer.
3. **Provenance as product.** Every edge cites its source. Competitors sell you a database and ask for trust; Rivalry shows receipts on click. In the LLM era, "verifiable" IS the differentiation.
4. **Relationship intelligence is structurally unavailable to incumbents.** Crunchbase sells rows. The signal (shared investors, founder lineage, white space between clusters) only exists in the connections — a graph-native product can't be feature-matched by a table-native one without a rebuild.
5. **Day-zero wedge.** Rivalry meets founders before any other tool does — first product in the founder journey, upstream of everyone.

## The 4 killer features (all are Cypher queries rendered as auto-surfaced Insight Cards — no waiting for the user to ask)

Insight Cards fire automatically as the graph completes. This is the strongest 3-hour feature: it converts traversals into visible product moments.

1. **⚡ Investor Collision.** "Handshake and WayUp share a lead investor (True Ventures)." 2-hop traversal, path lights up on card click. Strategic read: they won't both die — expect consolidation.
2. **🕳️ White Space.** Louvain communities over Company–Feature–Segment → "No company serves {segment} with {feature}. The gap is real: 0 of 23 companies." The empty cluster renders visually as dead space in the graph.
3. **🧱 Table Stakes vs. Edge.** Feature frequency split: "6 of 8 companies have auto-matching — table stakes. Nobody has university-verified skill assessments — your opening."
4. **🎯 The Boss Node.** Highest PageRank company: "Everyone positions against Handshake. Differentiate from THEM, ignore the rest." Node renders bigger + crowned.

Stretch card (only if ahead): **📉 Positioning Drift** — Wayback snapshots: "CompetitorX rewrote its homepage pitch 3× in 18 months — they haven't found PMF either."

## Butterbase = EVERYTHING

- **Every LLM call** → `POST https://api.butterbase.ai/v1/chat/completions` (`bb_sk_` key, `ai:gateway` scope): onboarding agent, query expansion, entity extraction, text2Cypher Q&A, moat/insight card copy, report. Zero raw provider keys in the repo.
- **RocketRide compliance without double LLM stacks:** the `.pipe` on cloud.rocketride.ai runs extraction; point its LLM node at the Butterbase OpenAI-compatible base URL (`https://api.butterbase.ai/v1`) if the node supports custom endpoints (it lists 13 providers — check for "OpenAI-compatible/custom base URL" first). If it doesn't, the pipeline webhook calls back into our extraction prompt via gateway — RocketRide still hosts and orchestrates the stage.
- **Auth** (`@butterbase/sdk` signUp/signIn), **DB** (sessions, question counter, enrichment cache, reports), **Payments** (REST billing: product → purchase → checkout URL → poll `paid`).

## Clay strategy under time pressure

Clay MCP lives in the Claude session, not the app. Division of labor: **Clay verifies the pre-warmed demo vertical NOW (via this session — funding + investors for the ~15 demo companies), written into Neo4j as high-confidence facts with `Source {type: "clay"}`.** The app's live pipeline uses free sources only (YC + HN + gateway websearch). Demo accuracy: guaranteed. Live pipeline: still real.

## CUT LIST (do not touch these in the next 3 hours)

Product Hunt (token friction), GitHub, EDGAR, posts/traction connectors, Cognee, RSS/changelogs, betweenness, click-to-expand beyond 1 hop, saved sessions UI, magic links. Onboarding = 3 questions max, hardcoded axes. Report = one gateway call, one template.

## The 3 hours

**0:00–0:40 — Foundation (all hands)**
- Provision: Butterbase app + `ai:gateway` key + Stripe Connect onboard NOW; Aura Free; RocketRide extension + cloud account.
- `create-next-app` + deps (PLAN.md Phase 1 list minus cut packages) + `.env.local`.
- Apply schema constraints (PLAN.md Phase 2 cypher, incl. FundingRound). `lib/neo4j.ts`, `lib/butterbase.ts` (gateway fetch helper).
- ✅ Gate: smoke script green (Aura connect, gateway chat call, YC meta.json).

**0:40–1:40 — Spine (pipeline + graph on screen)**
- `lib/sources/yc.ts` + `hn.ts` + `websearch.ts` (gateway, citations mandatory).
- Extraction prompt → `.pipe` with webhook source on cloud.rocketride.ai (LLM node → Butterbase base URL). Invoke via `rocketride` SDK.
- `conductor.ts` async generator → dedupe → batched MERGE writer (provenance enforced) → SSE route.
- `LiveGraph.tsx` verbatim from PLAN.md Phase 0.2 snippets (dynamic import, damped alpha, reused refs).
- ✅ Gate (minute 100): type idea → nodes stream onto screen. **This is the milestone; everything after is bonus.**
- Meanwhile (Claude session, parallel): Clay-enrich demo companies → write verified FundingRound/investor edges to Aura.

**1:40–2:20 — Killer features**
- Insight pass: graphology Louvain + PageRank → write back → 4 Insight Cards (each = 1 Cypher + 1 gateway call for card copy + highlight callback).
- Onboarding agent (3 questions, JSON out) wired to pipeline start.
- Q&A box with the 2 hardcoded hero few-shots (shared investors, table stakes) + read-only guardrails.

**2:20–3:00 — Money + insurance**
- Butterbase auth (email/password only) + question counter (5 free) + paywall → billing purchase → poll `paid` → report (one gateway call over graph digest, react-markdown render).
- Prewarm "internship platform" fully; verify hero questions; screenshot RocketRide cloud dashboard for submission; run the 3-min demo script once.
- ✅ Ship gate: idea → onboarding → live graph → insight cards → paywall → paid report, end to end once.

**If a stage overruns:** drop Q&A box (cards carry the demo), then drop live pipeline on stage (pre-warmed graph + replay), then drop report styling. Never drop: cloud `.pipe`, real payment, insight cards, provenance clicks.
