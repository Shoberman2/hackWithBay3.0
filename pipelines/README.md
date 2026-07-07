# RocketRide pipelines

## rivalry-extract.pipe

The entity-extraction stage of the ingestion pipeline (PLAN.md Phase 3),
built as a RocketRide JSON pipeline. `.pipe` files are JSON (no comments
allowed), so every node is documented here and in each component's
`description` field.

### Topology

```
webhook_1 (source)  -->  llm_extract (LLM via Butterbase gateway)  -->  response_1 (JSON out)
        data lane                    text lane
```

- **`webhook_1`** — the pipeline's source node (every RocketRide pipeline
  needs one of `webhook | chat | dropper`; docs.rocketride.org/concepts/pipelines).
  Receives a synchronous `application/json` payload of shape
  `{ idea: string, tags: string[], raw_documents: [{ url, source_type, title, text, date? }] }`.
  The app sends this over the SDK WebSocket (`client.send(token, JSON.stringify(input), { name: "input.json" }, "application/json")`),
  never plain `fetch()`.
- **`llm_extract`** — the LLM node (docs.rocketride.org/nodes; 13 providers
  supported) configured as an OpenAI-compatible provider pointed at the
  Butterbase gateway base URL `https://api.butterbase.ai/v1` with model
  `anthropic/claude-3.5-sonnet`. The API key is the placeholder
  `${ROCKETRIDE_BUTTERBASE_AI_KEY}`; `lib/rocketride.ts` injects the real
  `BUTTERBASE_AI_KEY` as an env override at `use()` time
  (`client.use({ filepath, env: { ROCKETRIDE_BUTTERBASE_AI_KEY: ... } })`),
  so no raw provider key is ever stored in the pipeline file or on the
  RocketRide dashboard. The system prompt demands ONLY `ExtractedBatch`
  JSON (schema in `lib/types.ts`), `source_url` copied verbatim from the
  input doc on every entity, `props.confidence` 0-1 on every relationship,
  and null for unknowns — never guessed values.
- **`response_1`** — returns the LLM's JSON text as the synchronous result
  of the `send()` call, which `lib/rocketride.ts` zod-validates
  (`parseExtractedBatch`) before anything reaches the graph writer.

## Deploy runbook (managed production endpoint)

The app calls this pipeline as a **deployed, managed production endpoint** on
`cloud.rocketride.ai` — an HTTP webhook trigger URL it POSTs to — not by
uploading the local `.pipe` on every request. Why HTTP and not the SDK: the
installed `rocketride@1.3.0` SDK cannot invoke a *deployed* pipeline by
reference. `client.use()` accepts only `filepath` or an inline `pipeline`
object (both upload the pipe each call — see `dist/types/client.d.ts`), and
`client.deploy.{add,list,status,update,remove}` only *manage* server-side
deployments (cron/manual `schedule`); `DeploymentRecord`
(`dist/types/types/deploy.d.ts`) carries no trigger/webhook URL and offers no
synchronous invoke. So the only way to call a deployed pipeline and get its
`ExtractedBatch` back is over the deployed webhook node's HTTP URL.

Steps:

1. **Import / reconcile.** Open `pipelines/rivalry-extract.pipe` in the
   RocketRide VS Code extension (install "RocketRide" from the IDE marketplace).
   Verify the three nodes resolve in the node inspector — `webhook_1` (source),
   `llm_extract` (LLM), `response_1` (JSON out) — and that the provider-specific
   `config` keys authored here (`base_url`, `response_format`, `lanes`, the
   `webhook_1` `mode: "sync"` HTTP trigger) match the inspector's fields. This
   `.pipe` conforms to the SDK's `PipelineConfig` / `PipelineComponent` typings
   as shipped; no schema changes were required.
2. **Set the secret.** In the extension's deployment secrets, set
   `ROCKETRIDE_BUTTERBASE_AI_KEY` to your Butterbase AI key. The `.pipe`
   references it as `${ROCKETRIDE_BUTTERBASE_AI_KEY}` on `llm_extract.config.api_key`,
   so the raw provider key is interpolated server-side at deploy time and never
   stored in the pipeline file or on the dashboard.
3. **One-click deploy** to `https://cloud.rocketride.ai`. The webhook source
   node is exposed as a public HTTP trigger URL of the form
   `https://cloud.rocketride.ai/webhook/rivalry-extract?auth=<public_auth>`.
4. **Copy the webhook URL** (including the `?auth=<public_auth>` query token)
   into `.env.local` as `ROCKETRIDE_ENDPOINT`. Set `DEMO_MODE=false` — the live
   remote path only runs when demo mode is off (`usesRemoteExtraction()` =
   `hasRocketRide() && !DEMO_MODE`).
5. **Smoke test** with curl (JSON in -> ExtractedBatch JSON out):

   ```bash
   curl -sS -X POST "$ROCKETRIDE_ENDPOINT" \
     -H 'content-type: application/json' \
     -d '{
       "idea": "AI meeting notetaker",
       "tags": ["saas", "ai"],
       "raw_documents": [
         { "url": "https://news.ycombinator.com/item?id=1",
           "source_type": "HN", "title": "Show HN: Otter competitor",
           "text": "We built a notetaker...", "date": "2025-01-01" }
       ]
     }'
   ```

   Expect a single JSON object with the `ExtractedBatch` keys: `companies`,
   `founders`, `investors`, `features`, `launches`, `segments`,
   `funding_rounds`, `snapshots`, `posts`, `moat_claims`, `traction_signals`,
   `relationships` (each an array; empty when nothing was found). Every entity
   carries `source_url`; every relationship carries `props.confidence`.

### Fallback ladder

`lib/rocketride.ts` (`extractEntities`) tries, in order:

1. **Deployed endpoint** — `ROCKETRIDE_ENDPOINT` set: HTTP POST to the webhook
   URL (60s timeout). This is the managed production path.
2. **SDK filepath upload** — `ROCKETRIDE_APIKEY` set: `connect -> use({ filepath })
   -> send() -> terminate -> disconnect`, which uploads this local `.pipe`.
3. **Local extraction** — `lib/pipeline/extract.ts` via the Butterbase gateway
   with the identical prompt and zod validation.

Each rung logs which path ran (`[rocketride]` debug lines when `DEBUG=true`),
and the conductor notes in the SSE event stream when extraction ran locally.
Any rung that throws or returns unparseable / schema-invalid output falls
through to the next. In `DEMO_MODE` (or with no RocketRide config) the app
runs entirely on fixtures. Keep the local Docker engine
(`ghcr.io/rocketride-org/rocketride-engine:latest`, port 5565) as an offline
demo fallback for the SDK path.

### Notes on the `.pipe`

- This file was authored by hand against the SDK's `PipelineConfig` /
  `PipelineComponent` typings (`rocketride@1.3.0`,
  `dist/types/types/pipeline.d.ts`). Reading those typings confirmed no
  schema violations, so the `.pipe` was left unchanged; reconcile the
  provider-specific `config` keys in the extension's node inspector before
  deploy as a belt-and-suspenders check.
