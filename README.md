# Startup Radar

Startup Radar is a HackwithBay 3.0 prototype for graph-aware startup and industry tracking. A user enters an industry, startup idea, or company, then the app builds an ecosystem graph of companies, people, investors, websites, trends, and opportunity gaps.

## Local setup

```bash
npm install
npm run dev
```

The Vite dev server will print a local URL, usually `http://localhost:5173/`.

## Hackathon integration plan

- Butterbase: auth, user workspaces, saved scans, billing, and model gateway access.
- Neo4j: property graph for `Company`, `Person`, `Website`, `Investor`, `Segment`, `Trend`, and `Opportunity` nodes.
- RocketRide Cloud: managed agent pipeline for research, extraction, entity resolution, and graph scoring.
- Cognee optional: founder-specific memory across repeated market scans.
- Daytona optional: sandboxed research workers for generated crawlers and analysis scripts.

## Environment

Copy `.env.example` to `.env.local` when service endpoints are available.

```bash
cp .env.example .env.local
```

The current prototype works in local demo mode without credentials. Service keys and database passwords belong in `.env.local` only; `.env.local` is ignored by git.

## Butterbase

The frontend is wired through [src/lib/butterbase.ts](/Users/shoberman/charityChecker/src/lib/butterbase.ts). Create a Butterbase app named `startup-radar`, then apply [butterbase/schema.json](/Users/shoberman/charityChecker/butterbase/schema.json) and enable the policies listed in [butterbase/rls.json](/Users/shoberman/charityChecker/butterbase/rls.json). The schema file uses Butterbase's SDK schema DSL, including `primaryKey` for primary key columns.

## Neo4j

Create a Neo4j AuraDB instance, add the generated URI/user/password/database name from the credentials file to `.env.local`, then run:

```bash
npm run neo4j:seed
```

The schema and demo data live in [neo4j/schema.cypher](/Users/shoberman/charityChecker/neo4j/schema.cypher) and [neo4j/seed.cypher](/Users/shoberman/charityChecker/neo4j/seed.cypher).
