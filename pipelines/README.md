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

### Caveats

- This file was authored by hand against the SDK's `PipelineConfig` /
  `PipelineComponent` typings (`rocketride@1.3.0`,
  `dist/types/types/pipeline.d.ts`) and the docs.rocketride.org
  conventions. The VS Code extension could not be run in this
  environment, so provider-specific `config` keys on `llm_extract` /
  `response_1` (`base_url`, `response_format`, `lanes`, ...) are
  best-effort and should be reconciled in the extension's node inspector
  before the one-click deploy to cloud.rocketride.ai.
- Deploy early (PLAN.md Phase 3): open the file in the RocketRide VS Code
  extension, verify the three nodes resolve, then one-click deploy to
  `https://cloud.rocketride.ai`. Keep the local Docker engine
  (`ghcr.io/rocketride-org/rocketride-engine:latest`, port 5565) as the
  demo fallback.
- If the remote pipe fails at runtime (connect error, unparseable output,
  schema violation), `lib/rocketride.ts` falls back to local extraction
  through the Butterbase gateway (`lib/pipeline/extract.ts`) with the
  identical prompt and validation, and the pipeline conductor notes in
  the SSE event stream that extraction ran locally.

## rivalry-monitor.pipe

The classification stage of the news monitor (`lib/monitor.ts`). The fetch
stage is NOT this pipe: raw documents are gathered by a fixed Python agent
running inside a **Daytona sandbox** (TechCrunch venture RSS, one Google
News RSS query per watchlist company, Hacker News via Algolia — all
outbound fetching happens in the sandbox, never in the app process).

### Topology

```
webhook_1 (source)  -->  llm_classify (LLM via Butterbase gateway)  -->  response_1 (JSON out)
        data lane                    text lane
```

- **`webhook_1`** — receives `{ companies: string[], tags: string[], raw_documents: RawDoc[] }`
  sent by `lib/monitor.ts` through the shared `invokePipe()` helper in
  `lib/rocketride.ts` (SDK WebSocket, same pattern as extraction).
- **`llm_classify`** — OpenAI-compatible LLM node pointed at the Butterbase
  gateway (`${ROCKETRIDE_BUTTERBASE_AI_KEY}` injected at `use()` time).
  Emits `{"signals": [...]}` — one entry per underlying story with
  `kind` (funding | launch | acquisition | shutdown | product | market | other),
  `companies_mentioned`, `relevance` 0-1 (items under 0.3 dropped), and a
  one-sentence grounded `summary`. URLs and dates copied verbatim from input.
- **`response_1`** — returns the JSON synchronously; `lib/monitor.ts`
  zod-validates with `newsSignalSchema` before anything reaches the UI.

Fallback ladder when the pipe or its deps are unavailable: gateway
classification -> keyword heuristic -> canned demo signals (see
`lib/monitor.ts`).
