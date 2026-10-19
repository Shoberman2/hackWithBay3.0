# RocketRide pipelines

## rivalry-extract.pipe

The entity-extraction stage of the ingestion pipeline (PLAN.md Phase 3),
built as a RocketRide JSON pipeline. `.pipe` files are JSON (no comments
allowed), so every node is documented here and in each component's
`description` field.

### Topology

```text
webhook_1 -> parse_1 -> extract_data_1 -> response_answers_1
                              ^
                              |
                         llm_openai_1
```

- **`webhook_1`** — the pipeline's source node (every RocketRide pipeline
  needs one of `webhook | chat | dropper`; docs.rocketride.org/concepts/pipelines).
  Receives a synchronous `application/json` payload of shape
  `{ idea: string, tags: string[], raw_documents: [{ url, source_type, title, text, date? }] }`.
  The app sends this over the SDK WebSocket (`client.send(token, JSON.stringify(input), { name: "input.json" }, "application/json")`),
  never plain `fetch()`.
- **`parse_1`** — converts the webhook payload into text for the structured
  extraction component.
- **`extract_data_1`** — structured extraction component. It invokes
  `llm_openai_1` through RocketRide's control plane and emits answers.
- **`llm_openai_1`** — LLM control provider configured for the Butterbase
  OpenAI-compatible gateway (`https://api.butterbase.ai/v1`) with model
  `anthropic/claude-3.5-sonnet`. The `.pipe` keeps the placeholder
  `${ROCKETRIDE_BUTTERBASE_AI_KEY}`; `scripts/deploy-rocketride.ts`
  substitutes the real Butterbase key in memory during validation/deploy,
  so no secret is committed to git. The extraction instructions demand ONLY
  `ExtractedBatch` JSON (schema in `lib/types.ts`), `source_url` copied
  verbatim from the input doc on every entity, `props.confidence` 0-1 on
  every relationship, and null for unknowns — never guessed values.
- **`response_answers_1`** — returns the extraction JSON as the synchronous
  result of the `send()` call, which `lib/rocketride.ts` zod-validates
  (`parseExtractedBatch`) before anything reaches the graph writer.

### Caveats

- Deploy with `npm run rocketride:deploy`. The script validates the pipe
  against RocketRide Cloud, creates or updates the deployment, and starts a
  reusable cloud task for project `2849d160-3b2a-4119-a6d1-b070070c18d3`
  and source `webhook_1`.
- In live mode, RocketRide failures are surfaced instead of falling back
  locally. `DEMO_MODE=true` is the only path that uses local fixture/demo
  behavior.
