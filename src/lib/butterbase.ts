import { createClient, type User } from '@butterbase/sdk'
import type { MarketGraph, ScanDepth, ScanMode } from './marketGraph'

type ButterbaseFeatureTone = 'ready' | 'hooked' | 'free' | 'off'
export type UpdateCadence = 'daily' | 'weekly' | 'major'

export interface ButterbaseFeature {
  label: string
  detail: string
  tone: ButterbaseFeatureTone
}

export interface ScanSaveInput {
  graph: MarketGraph
  prompt: string
  mode: ScanMode
  depth: ScanDepth
  scanNumber: number
}

export interface SavedScanResult {
  scanId: string
  tableWrites: number
  storageObjectId?: string
  ragDocumentId?: string
  functionPlan?: string[]
  warnings: string[]
}

export interface IndustryUpdateInput {
  topic: string
  cadence: UpdateCadence
  deliveryEmail?: string
  enabled: boolean
  graph: MarketGraph
  scanId?: string
}

export interface IndustryUpdateItem {
  title: string
  summary: string
  sourceUrl?: string
  signal?: string
}

export interface IndustryUpdateResult {
  subscriptionId: string
  enabled: boolean
  cadence: UpdateCadence
  deliveryEmail?: string
  previewItems: IndustryUpdateItem[]
  functionPlan?: string[]
  message: string
}

interface WorkspaceRow {
  id: string
  user_id: string
  name: string
}

interface IndustryUpdateSubscriptionRow {
  id: string
  workspace_id: string
  user_id: string
  scan_id?: string | null
  topic: string
  cadence: UpdateCadence
  channel: string
  delivery_email?: string | null
  enabled: boolean
}

interface ButterbaseErrorLike {
  message?: string
  remediation?: string
}

export const butterbaseConfig = {
  appId: import.meta.env.VITE_BUTTERBASE_APP_ID as string | undefined,
  apiUrl: import.meta.env.VITE_BUTTERBASE_API_URL as string | undefined,
  oauthRedirect:
    (import.meta.env.VITE_BUTTERBASE_OAUTH_REDIRECT as string | undefined) ??
    (typeof window !== 'undefined' ? window.location.origin : undefined),
}

export const isButterbaseConfigured = Boolean(
  butterbaseConfig.appId && butterbaseConfig.apiUrl,
)

export const butterbase = butterbaseConfig.appId && butterbaseConfig.apiUrl
  ? createClient({
      appId: butterbaseConfig.appId,
      apiUrl: butterbaseConfig.apiUrl,
    })
  : null

export const butterbaseFeatures: ButterbaseFeature[] = [
  {
    label: 'Google OAuth',
    detail: 'Founder identity and persistent sessions.',
    tone: isButterbaseConfigured ? 'ready' : 'hooked',
  },
  {
    label: 'RLS Data API',
    detail: 'Private scans, entities, edges, notes, and Q&A history.',
    tone: isButterbaseConfigured ? 'ready' : 'hooked',
  },
  {
    label: 'Realtime',
    detail: 'Pipeline events can stream into the graph as rows change.',
    tone: isButterbaseConfigured ? 'ready' : 'hooked',
  },
  {
    label: 'Industry Updates',
    detail: 'Opt-in digests track changes for saved markets.',
    tone: 'ready',
  },
  {
    label: 'Storage',
    detail: 'Evidence bundles upload as private JSON artifacts.',
    tone: 'hooked',
  },
  {
    label: 'Native RAG',
    detail: 'Saved source memos become queryable evidence collections.',
    tone: 'hooked',
  },
  {
    label: 'Functions',
    detail: 'Free brief function prepares follow-up questions.',
    tone: 'hooked',
  },
  {
    label: 'AI Gateway',
    detail: 'Ready for report and extraction calls through Butterbase.',
    tone: 'hooked',
  },
  {
    label: 'No Paywall',
    detail: 'Every core feature is free to use.',
    tone: 'off',
  },
]

const RAG_COLLECTION = 'rivalry-market-evidence'
const FUNCTION_NAME = 'rivalry-free-brief'
const INDUSTRY_UPDATES_FUNCTION_NAME = 'rivalry-industry-updates'

const isOAuthCallbackUrl = () => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.has('access_token') && params.has('refresh_token')
}

const errorMessage = (error: unknown) => {
  if (!error) return 'Unknown Butterbase error.'
  const maybeError = error as ButterbaseErrorLike
  return maybeError.remediation
    ? `${maybeError.message ?? 'Butterbase request failed.'} ${maybeError.remediation}`
    : maybeError.message ?? 'Butterbase request failed.'
}

const compactSourceMemo = (input: ScanSaveInput) => {
  const { graph, prompt, mode, depth } = input

  return [
    `Rivalry scan: ${graph.title}`,
    `Prompt: ${prompt}`,
    `Mode: ${mode}`,
    `Depth: ${depth}`,
    `Summary: ${graph.subtitle}`,
    '',
    'Entities:',
    ...graph.nodes.map((node) => `- ${node.kind}: ${node.label} - ${node.summary}`),
    '',
    'Relationships:',
    ...graph.edges.map((edge) => `- ${edge.from} ${edge.label} ${edge.to} (${edge.strength})`),
    '',
    'Sources:',
    ...graph.sources.map((source) => `- ${source.title}: ${source.url} (${source.signal})`),
    '',
    'Opportunities:',
    ...graph.opportunities.map((item) => `- ${item.title}: ${item.reason} Wedge: ${item.wedge}`),
  ].join('\n')
}

const firstRow = <T,>(value: T | T[] | null) => {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

const requireButterbase = () => {
  if (!butterbase) throw new Error('Butterbase is not configured yet.')
  return butterbase
}

export const handleOAuthRedirect = async () => {
  const client = requireButterbase()
  if (!isOAuthCallbackUrl()) return null

  const { data, error } = await client.auth.handleOAuthCallback()
  if (error) throw new Error(errorMessage(error))
  return data?.user ?? null
}

export const getCurrentUser = async () => {
  const client = requireButterbase()
  const { data, error } = await client.auth.getUser()
  if (error) return null
  return data
}

export const signInWithGoogle = () => {
  const client = requireButterbase()
  if (!butterbaseConfig.oauthRedirect) {
    throw new Error('Set VITE_BUTTERBASE_OAUTH_REDIRECT before starting Google sign-in.')
  }

  const { url } = client.auth.signInWithOAuth({
    provider: 'google',
    redirectTo: butterbaseConfig.oauthRedirect,
  })

  window.location.assign(url)
}

export const signOutOfButterbase = async () => {
  const client = requireButterbase()
  const { error } = await client.auth.signOut()
  if (error) throw new Error(errorMessage(error))
}

const getOrCreateWorkspace = async (user: User) => {
  const client = requireButterbase()
  const existing = await client
    .from<WorkspaceRow>('workspaces')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)

  if (existing.error) throw new Error(errorMessage(existing.error))

  const workspace = firstRow<WorkspaceRow>(existing.data)
  if (workspace) return workspace

  const nextWorkspace: WorkspaceRow = {
    id: crypto.randomUUID(),
    user_id: user.id,
    name: 'Rivalry Workspace',
  }

  const created = await client.from<WorkspaceRow>('workspaces').insert(nextWorkspace).select('*')
  if (created.error) throw new Error(errorMessage(created.error))

  return firstRow<WorkspaceRow>(created.data) ?? nextWorkspace
}

const insertRows = async (table: string, rows: Array<Record<string, unknown>>) => {
  if (rows.length === 0) return 0

  const client = requireButterbase()
  const { error } = await client.from(table).insert(rows)
  if (error) throw new Error(errorMessage(error))
  return rows.length
}

const maybeUploadEvidenceBundle = async (input: ScanSaveInput, scanId: string, warnings: string[]) => {
  const client = requireButterbase()

  try {
    const file = new Blob(
      [
        JSON.stringify(
          {
            scan_id: scanId,
            prompt: input.prompt,
            mode: input.mode,
            depth: input.depth,
            graph: input.graph,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const { data, error } = await client.storage.upload(file, `rivalry-${scanId}.json`, {
      public: false,
    })

    if (error) {
      warnings.push(`Storage skipped: ${errorMessage(error)}`)
      return undefined
    }

    return data?.objectId
  } catch (error) {
    warnings.push(`Storage skipped: ${errorMessage(error)}`)
    return undefined
  }
}

const maybeIngestRagMemo = async (input: ScanSaveInput, scanId: string, warnings: string[]) => {
  const client = requireButterbase()

  try {
    await client.rag.createCollection({
      name: RAG_COLLECTION,
      description: 'Source-backed Rivalry scan evidence for free founder reports.',
      accessMode: 'private',
      chunkSize: 800,
      chunkOverlap: 120,
    })
  } catch {
    // Existing collections are fine; the ingest call below is the useful work.
  }

  try {
    const { data, error } = await client.rag.ingest(RAG_COLLECTION, {
      text: compactSourceMemo(input),
      filename: `rivalry-${scanId}-evidence.txt`,
      metadata: {
        scan_id: scanId,
        prompt: input.prompt,
        mode: input.mode,
        depth: input.depth,
      },
    })

    if (error) {
      warnings.push(`RAG skipped: ${errorMessage(error)}`)
      return undefined
    }

    return data?.documentId
  } catch (error) {
    warnings.push(`RAG skipped: ${errorMessage(error)}`)
    return undefined
  }
}

const maybeInvokeFreeBriefFunction = async (input: ScanSaveInput, scanId: string, warnings: string[]) => {
  const client = requireButterbase()

  try {
    const { data, error } = await client.functions.invoke<{ next_questions?: string[] }>(FUNCTION_NAME, {
      method: 'POST',
      body: {
        scan_id: scanId,
        prompt: input.prompt,
        graph_title: input.graph.title,
        opportunities: input.graph.opportunities.map((item) => item.title),
      },
    })

    if (error) {
      warnings.push(`Function skipped: ${errorMessage(error)}`)
      return undefined
    }

    return data?.next_questions
  } catch (error) {
    warnings.push(`Function skipped: ${errorMessage(error)}`)
    return undefined
  }
}

const nextRunForCadence = (cadence: UpdateCadence) => {
  const days = cadence === 'daily' ? 1 : cadence === 'weekly' ? 7 : 14
  const nextRun = new Date()
  nextRun.setDate(nextRun.getDate() + days)
  return nextRun.toISOString()
}

const createIndustryPreviewItems = (
  input: IndustryUpdateInput,
  subscriptionId: string,
  userId: string,
): Array<Record<string, unknown>> => {
  if (!input.enabled) return []

  const source = input.graph.sources[0]
  const opportunity = input.graph.opportunities[0]

  return [
    {
      id: crypto.randomUUID(),
      subscription_id: subscriptionId,
      user_id: userId,
      title: `${input.topic} watch started`,
      summary: `Rivalry will collect source-backed changes for ${input.topic} and surface them in this updates feed.`,
      source_url: source?.url ?? null,
      signal: `${input.cadence} digest`,
    },
    {
      id: crypto.randomUUID(),
      subscription_id: subscriptionId,
      user_id: userId,
      title: opportunity ? `${opportunity.title} monitor` : 'White-space monitor',
      summary: opportunity?.wedge ?? 'Track competitor movement, new sources, and white-space shifts.',
      source_url: source?.url ?? null,
      signal: 'Opportunity tracking',
    },
  ]
}

const maybeInvokeIndustryUpdatesFunction = async (
  input: IndustryUpdateInput,
  subscriptionId: string,
  warnings: string[],
) => {
  const client = requireButterbase()

  try {
    const { data, error } = await client.functions.invoke<{ planned_signals?: string[] }>(
      INDUSTRY_UPDATES_FUNCTION_NAME,
      {
        method: 'POST',
        body: {
          subscription_id: subscriptionId,
          topic: input.topic,
          cadence: input.cadence,
          enabled: input.enabled,
        },
      },
    )

    if (error) {
      warnings.push(`Updates function skipped: ${errorMessage(error)}`)
      return undefined
    }

    return data?.planned_signals
  } catch (error) {
    warnings.push(`Updates function skipped: ${errorMessage(error)}`)
    return undefined
  }
}

export const saveScanSnapshot = async (input: ScanSaveInput): Promise<SavedScanResult> => {
  const client = requireButterbase()
  const userResponse = await client.auth.getUser()
  if (userResponse.error || !userResponse.data) {
    throw new Error('Sign in with Google before saving scans to Butterbase.')
  }

  const user = userResponse.data
  const workspace = await getOrCreateWorkspace(user)
  const scanId = crypto.randomUUID()
  const warnings: string[] = []
  const storageObjectId = await maybeUploadEvidenceBundle(input, scanId, warnings)
  const ragDocumentId = await maybeIngestRagMemo(input, scanId, warnings)
  const functionPlan = await maybeInvokeFreeBriefFunction(input, scanId, warnings)

  let tableWrites = 0
  tableWrites += await insertRows('startup_scans', [
    {
      id: scanId,
      workspace_id: workspace.id,
      user_id: user.id,
      prompt: input.prompt,
      mode: input.mode,
      depth: input.depth,
      neo4j_graph_id: `rivalry-demo-${input.scanNumber}`,
      rocketride_run_id: null,
      status: 'ready',
      summary: input.graph.subtitle,
    },
  ])

  tableWrites += await insertRows(
    'scan_entities',
    input.graph.nodes.map((node) => ({
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      external_id: node.id,
      kind: node.kind,
      name: node.label,
      summary: node.summary,
      url: node.url ?? null,
      signal: node.signal,
      score: node.kind === 'opportunity' ? 0.84 : 0.72,
      metadata: {
        x: node.x,
        y: node.y,
        generated_at: input.graph.generatedAt,
      },
    })),
  )

  tableWrites += await insertRows(
    'scan_relationships',
    input.graph.edges.map((edge) => ({
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      source_external_id: edge.from,
      target_external_id: edge.to,
      relationship_type: edge.label,
      strength: edge.strength,
      evidence: `Generated from ${input.graph.title}.`,
    })),
  )

  tableWrites += await insertRows(
    'research_sources',
    input.graph.sources.map((source) => ({
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      title: source.title,
      url: source.url,
      source_type: 'web',
      signal: source.signal,
    })),
  )

  tableWrites += await insertRows(
    'opportunity_notes',
    input.graph.opportunities.map((item, index) => ({
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      title: item.title,
      reason: item.reason,
      wedge: item.wedge,
      confidence: 0.78 + index * 0.04,
    })),
  )

  tableWrites += await insertRows('onboarding_answers', [
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      question: 'Which buyer or segment should Rivalry prioritize first?',
      answer: input.graph.nodes.find((node) => node.id === 'segment')?.label ?? input.prompt,
      signal: 'Narrows graph discovery and report framing.',
    },
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      question: 'How should Rivalry handle monetization?',
      answer: 'Keep the graph, saved scan, evidence bundle, and report draft free.',
      signal: 'Payments intentionally disabled.',
    },
  ])

  tableWrites += await insertRows('graph_questions', [
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      question: 'Where is the strongest white space?',
      answer: input.graph.opportunities[0]?.wedge ?? 'Inspect weakly connected opportunity nodes first.',
      cypher: 'MATCH path=(idea:Idea)-[*1..3]-(gap:Opportunity) RETURN path',
      status: 'answered',
    },
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      question: 'Which graph path should the founder inspect next?',
      answer: functionPlan?.[0] ?? 'Compare direct competitors by shared segments and investor paths.',
      cypher: 'MATCH (c:Company)-[:SERVES|TARGETS]->(s:Segment) RETURN c, s',
      status: functionPlan ? 'function_suggested' : 'draft',
    },
  ])

  tableWrites += await insertRows('report_artifacts', [
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      title: `${input.graph.title} free memo`,
      report_kind: 'free_landscape',
      status: 'draft',
      object_id: storageObjectId ?? null,
      rag_document_id: ragDocumentId ?? null,
      summary: `Free founder memo for ${input.prompt}: ${input.graph.subtitle}`,
    },
  ])

  tableWrites += await insertRows(
    'source_artifacts',
    input.graph.sources.map((source) => ({
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      title: source.title,
      url: source.url,
      artifact_type: 'source_snapshot',
      storage_object_id: storageObjectId ?? null,
      rag_document_id: ragDocumentId ?? null,
      metadata: {
        signal: source.signal,
      },
    })),
  )

  tableWrites += await insertRows('pipeline_events', [
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      event_type: 'scan.saved',
      message: 'Scan persisted through Butterbase Data API with RLS.',
      metadata: {
        table_writes: tableWrites,
        free_mode: true,
      },
    },
    {
      id: crypto.randomUUID(),
      scan_id: scanId,
      user_id: user.id,
      event_type: 'realtime.ready',
      message: 'Realtime subscribers can stream graph updates for this scan.',
      metadata: {
        tables: ['startup_scans', 'scan_entities', 'scan_relationships', 'pipeline_events'],
      },
    },
  ])

  return {
    scanId,
    tableWrites,
    storageObjectId,
    ragDocumentId,
    functionPlan,
    warnings,
  }
}

export const saveIndustryUpdatePreference = async (
  input: IndustryUpdateInput,
): Promise<IndustryUpdateResult> => {
  const client = requireButterbase()
  const userResponse = await client.auth.getUser()
  if (userResponse.error || !userResponse.data) {
    throw new Error('Sign in with Google before enabling industry updates.')
  }

  const user = userResponse.data
  const workspace = await getOrCreateWorkspace(user)
  const topic = input.topic.trim()
  if (!topic) throw new Error('Add an industry or idea before enabling updates.')

  const existing = await client
    .from<IndustryUpdateSubscriptionRow>('industry_update_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .eq('topic', topic)
    .order('created_at', { ascending: false })
    .limit(1)

  if (existing.error) throw new Error(errorMessage(existing.error))

  const existingSubscription = firstRow<IndustryUpdateSubscriptionRow>(existing.data)
  const subscriptionId = existingSubscription?.id ?? crypto.randomUUID()
  const payload = {
    workspace_id: workspace.id,
    user_id: user.id,
    scan_id: input.scanId ?? existingSubscription?.scan_id ?? null,
    topic,
    cadence: input.cadence,
    channel: 'in_app',
    delivery_email: input.deliveryEmail?.trim() || user.email,
    enabled: input.enabled,
    next_run_at: input.enabled ? nextRunForCadence(input.cadence) : null,
    updated_at: new Date().toISOString(),
  }

  if (existingSubscription) {
    const updated = await client
      .from('industry_update_subscriptions')
      .update(payload)
      .eq('id', existingSubscription.id)
    if (updated.error) throw new Error(errorMessage(updated.error))
  } else {
    const created = await client
      .from('industry_update_subscriptions')
      .insert({
        id: subscriptionId,
        ...payload,
      })
    if (created.error) throw new Error(errorMessage(created.error))
  }

  const warnings: string[] = []
  const functionPlan = await maybeInvokeIndustryUpdatesFunction(
    {
      ...input,
      topic,
    },
    subscriptionId,
    warnings,
  )
  const previewRows = createIndustryPreviewItems(
    {
      ...input,
      topic,
    },
    subscriptionId,
    user.id,
  )
  await insertRows('industry_update_items', previewRows)

  const previewItems = previewRows.map((row) => ({
    title: String(row.title),
    summary: String(row.summary),
    sourceUrl: typeof row.source_url === 'string' ? row.source_url : undefined,
    signal: typeof row.signal === 'string' ? row.signal : undefined,
  }))

  return {
    subscriptionId,
    enabled: input.enabled,
    cadence: input.cadence,
    deliveryEmail: payload.delivery_email,
    previewItems,
    functionPlan,
    message: input.enabled
      ? `Industry updates are on for ${topic}.`
      : `Industry updates are paused for ${topic}.`,
  }
}
