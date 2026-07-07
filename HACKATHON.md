# Hackathon Eligibility Notes

This file is the competition-facing checklist for Rivalry. Keep the public README product-focused and use this file for event-specific instructions.

## Free-Use Rule

All judged features must be free to use:

- Google sign-in
- Idea input, onboarding, and live graph generation
- Node expansion (founders, lineage, moats, features, investors)
- Industry spreadsheet sorting and Neo graph Q&A
- Saved scans
- Graph Q&A records
- Evidence bundles
- Source-backed report drafts
- Butterbase realtime events
- Industry update subscriptions and in-app update items
- Storage and RAG evidence hooks

**Payment reconciliation.** HackwithBay 3.0's mandatory requirement is that Butterbase
"database, auth, and payment must all be in active use." Rivalry satisfies this with an
**optional supporter checkout** (`client.billing` — see `startSupport` / `loadSupporterProduct`
in [src/lib/butterbase.ts](/Users/shoberman/charityChecker/src/lib/butterbase.ts)). It is a
pay-what-you-want "Rivalry Supporter" product that gates nothing: every judged feature above
stays free. Do not add report gates, paid tiers, or usage paywalls that lock core value.

## Required Technology Proof

### Neo4j

Rivalry must use Neo4j as the graph reasoning layer, not as a key-value store.

Show graph-native behavior:

- Shared-investor paths
- Founder lineage
- Segment clusters
- White-space opportunity paths
- Source-backed claims

Relevant files:

- [neo4j/schema.cypher](/Users/shoberman/charityChecker/neo4j/schema.cypher)
- [neo4j/seed.cypher](/Users/shoberman/charityChecker/neo4j/seed.cypher)
- [scripts/seed-neo4j.mjs](/Users/shoberman/charityChecker/scripts/seed-neo4j.mjs)

### Butterbase

Rivalry should use as many free Butterbase features as possible:

- Google OAuth hooks in [src/lib/butterbase.ts](/Users/shoberman/charityChecker/src/lib/butterbase.ts)
- User-owned Data API tables in [butterbase/schema.json](/Users/shoberman/charityChecker/butterbase/schema.json)
- RLS policies in [butterbase/rls.json](/Users/shoberman/charityChecker/butterbase/rls.json)
- Realtime configuration through `npm run setup:butterbase`
- Opt-in industry update subscriptions and scheduled in-app digest function
- Private storage uploads for evidence bundles
- Native RAG ingestion for source memos
- Free brief serverless function
- AI Gateway in active use: **Neo** industry analyst + graph Q&A via `client.ai.chat`
  (falls back to local synthesis if the gateway is not enabled for the app)
- Realtime subscription streaming `pipeline_events` into the live feed
- Payment in active use: optional supporter checkout via `client.billing` (non-gating)

Google OAuth needs free Google client credentials in `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
BUTTERBASE_OAUTH_REDIRECT_URIS=http://localhost:5173,http://localhost:5173/
```

### RocketRide

RocketRide should host the ingestion/enrichment endpoint before final submission. Set the deployed endpoint in `.env.local`:

```bash
VITE_ROCKETRIDE_ENDPOINT=
```

The endpoint should represent the remote agent pipeline:

1. Expand the founder idea into source queries.
2. Discover public pages and launch sources.
3. Extract companies, people, investors, sources, and relationships.
4. Write graph updates to Neo4j.
5. Emit scan progress into Butterbase `pipeline_events`.

## Setup Checklist

```bash
npm install
npm run setup:butterbase
npm run neo4j:seed
npm run lint
npm run build
npm run dev
```

## Demo Flow

1. Onboarding: type `internship platform`, sharpen the space (buyer, geography, model), Build.
2. Watch the graph assemble in real time as the pipeline ticker streams discovery events.
3. Click a company node to expand founders, moat, features, and investors; click a founder
   to expand prior-company lineage; click a moat to expand its components.
4. Read Neo's graph-native industry summary and ask it questions (shared investors, white space).
5. Below the graph, sort the industry spreadsheet by raise size, moat, or momentum — rows animate.
6. Sign in with Google once OAuth credentials are configured.
7. Save the private scan to Butterbase (entities carry raise/stage/moat metadata).
8. Opt in to industry updates; optionally back the build via the supporter checkout.
9. Show the saved free report draft, source artifact, RAG memo, and realtime event rows.
10. Explain the next step: RocketRide streams fresh discovery events into Neo4j and Butterbase.
