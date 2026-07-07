# Hackathon Eligibility Notes

This file is the competition-facing checklist for Rivalry. Keep the public README product-focused and use this file for event-specific instructions.

## Free-Use Rule

All judged features must be free to use:

- Google sign-in
- Idea input and graph generation
- Saved scans
- Graph Q&A records
- Evidence bundles
- Source-backed report drafts
- Butterbase realtime events
- Storage and RAG evidence hooks

Do not add checkout, billing, paid tiers, report gates, or usage paywalls.

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
- Private storage uploads for evidence bundles
- Native RAG ingestion for source memos
- Free brief serverless function
- AI Gateway-ready report and extraction path

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

1. Start at Rivalry with `internship platform`.
2. Generate the competitive graph.
3. Filter by companies, people, sources, and white space.
4. Click nodes to show evidence and relationship signals.
5. Sign in with Google once OAuth credentials are configured.
6. Save the private scan to Butterbase.
7. Show the saved free report draft, source artifact, RAG memo, and realtime event rows.
8. Explain the next step: RocketRide streams fresh discovery events into Neo4j and Butterbase.
