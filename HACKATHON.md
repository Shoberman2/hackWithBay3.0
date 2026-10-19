# HackWithBay Eligibility Notes

This file keeps event-specific setup out of the product README.

## Required Live Services

- RocketRide Cloud: run `npm run rocketride:deploy`; runtime uses project `2849d160-3b2a-4119-a6d1-b070070c18d3` and source `webhook_1`.
- Neo4j Aura: set `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, then run `npm run neo4j:schema` and `npm run neo4j:seed`.
- Butterbase: set `BUTTERBASE_APP_ID`, `BUTTERBASE_ANON_KEY`, `BUTTERBASE_SERVICE_KEY`, `BUTTERBASE_AI_KEY`, then run `npm run butterbase:provision`.

## Free Event Mode

Set `FREE_REPORT_UNLOCK=true` so the report unlock persists in Butterbase without charging anyone. This keeps every feature usable for judging while avoiding paid transactions.

Do not set `DEMO_MODE=true` for judging. Demo mode is only for local fallback fixtures.

## Judging Checklist

- `DEMO_MODE=false`
- RocketRide deployment exists and `getTaskToken(project/source)` resolves.
- `/api/graph`, `/api/expand`, report generation, and Q&A read live Neo4j.
- Butterbase Data API tables persist sessions, questions, purchases, reports, and update subscriptions.
- Butterbase AI gateway returns real completions; no canned responses in live mode.
- Report unlock is either real Butterbase Billing/Stripe or persisted free unlock for the event.
