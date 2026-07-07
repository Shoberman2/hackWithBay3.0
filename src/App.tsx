import { useEffect, useMemo, useState } from 'react'
import type { User } from '@butterbase/sdk'
import {
  Archive,
  BadgeCheck,
  Bell,
  BrainCircuit,
  Building2,
  CheckCircle2,
  CircleDot,
  Cloud,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  KeyRound,
  Layers3,
  Lightbulb,
  LogIn,
  LogOut,
  Mail,
  Network,
  Play,
  RadioTower,
  Rocket,
  Route,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import './App.css'
import {
  butterbaseFeatures,
  getCurrentUser,
  handleOAuthRedirect,
  saveIndustryUpdatePreference,
  isButterbaseConfigured,
  saveScanSnapshot,
  signInWithGoogle,
  signOutOfButterbase,
  type IndustryUpdateResult,
  type SavedScanResult,
  type UpdateCadence,
} from './lib/butterbase'
import {
  buildMarketGraph,
  type GraphNode,
  type NodeKind,
  type ScanDepth,
  type ScanMode,
} from './lib/marketGraph'

const DEFAULT_PROMPT = 'internship platform'

const NODE_STYLE: Record<NodeKind, { label: string; icon: LucideIcon; color: string }> = {
  idea: { label: 'Idea', icon: Sparkles, color: '#2f6f68' },
  company: { label: 'Companies', icon: Building2, color: '#c65a3a' },
  person: { label: 'Founders', icon: UserRound, color: '#7c5a9b' },
  website: { label: 'Sources', icon: Globe2, color: '#5276a7' },
  segment: { label: 'Segments', icon: Layers3, color: '#847332' },
  investor: { label: 'Investors', icon: BadgeCheck, color: '#517f45' },
  opportunity: { label: 'White Space', icon: Lightbulb, color: '#b26b1f' },
  trend: { label: 'Trends', icon: TrendingUp, color: '#5f6f3a' },
}

const FEATURE_ICONS: Record<string, LucideIcon> = {
  'Google OAuth': KeyRound,
  'RLS Data API': ShieldCheck,
  Realtime: RadioTower,
  'Industry Updates': Bell,
  Storage: Archive,
  'Native RAG': BrainCircuit,
  Functions: Cloud,
  'AI Gateway': Sparkles,
  'No Paywall': FileText,
}

const featureToneLabel = {
  ready: 'Ready',
  hooked: 'Hooked',
  free: 'Free',
  off: 'Off',
}

const FILTERS: Array<'all' | NodeKind> = [
  'all',
  'company',
  'person',
  'website',
  'opportunity',
]

const modeOptions: Array<{ value: ScanMode; label: string }> = [
  { value: 'industry', label: 'Industry' },
  { value: 'idea', label: 'Idea' },
  { value: 'company', label: 'Company' },
]

const depthOptions: Array<{ value: ScanDepth; label: string }> = [
  { value: 'fast', label: 'Fast' },
  { value: 'deep', label: 'Deep' },
]

const cadenceOptions: Array<{ value: UpdateCadence; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
  { value: 'major', label: 'Major' },
]

const shortLabel = (label: string) => {
  if (label.includes('-')) return `${label.split('-')[0]}...`
  return label.length > 15 ? `${label.slice(0, 13)}...` : label
}

const envStatus = [
  {
    label: 'Butterbase',
    detail: 'Auth, sessions, reports',
    configured: isButterbaseConfigured,
    icon: KeyRound,
  },
  {
    label: 'Neo4j',
    detail: 'Competitive graph storage',
    configured: Boolean(import.meta.env.VITE_NEO4J_GRAPH_ENDPOINT),
    icon: Database,
  },
  {
    label: 'RocketRide',
    detail: 'Research agent pipeline',
    configured: Boolean(import.meta.env.VITE_ROCKETRIDE_ENDPOINT),
    icon: Rocket,
  },
]

function GraphCanvas({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
}: {
  nodes: GraphNode[]
  edges: ReturnType<typeof buildMarketGraph>['edges']
  selectedNode: string
  onSelectNode: (id: string) => void
}) {
  const visibleIds = new Set(nodes.map((node) => node.id))
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  return (
    <svg className="graph-canvas" viewBox="0 0 100 100" role="img" aria-label="Competitive landscape graph">
      {visibleEdges.map((edge) => {
        const from = nodeById.get(edge.from)
        const to = nodeById.get(edge.to)

        if (!from || !to) return null

        const midX = (from.x + to.x) / 2
        const midY = (from.y + to.y) / 2

        return (
          <g key={edge.id} className={`graph-edge graph-edge-${edge.strength}`}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            <text x={midX} y={midY} textAnchor="middle">
              {edge.label}
            </text>
          </g>
        )
      })}

      {nodes.map((node) => {
        const style = NODE_STYLE[node.kind]
        const isSelected = selectedNode === node.id

        return (
          <g
            key={node.id}
            className={`graph-node ${isSelected ? 'is-selected' : ''}`}
            transform={`translate(${node.x} ${node.y})`}
            onClick={() => onSelectNode(node.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.id)
            }}
          >
            <circle r={isSelected ? 4.4 : 3.7} fill={style.color} />
            <circle r={isSelected ? 6.4 : 5.2} className="node-ring" />
            <text y={8.5} textAnchor="middle">
              {shortLabel(node.label)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function App() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [activePrompt, setActivePrompt] = useState(DEFAULT_PROMPT)
  const [mode, setMode] = useState<ScanMode>('idea')
  const [depth, setDepth] = useState<ScanDepth>('deep')
  const [filter, setFilter] = useState<'all' | NodeKind>('all')
  const [selectedNodeId, setSelectedNodeId] = useState('idea')
  const [scanNumber, setScanNumber] = useState(1)
  const [isScanning, setIsScanning] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authMessage, setAuthMessage] = useState('Google sign-in keeps saved scans private.')
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedScan, setLastSavedScan] = useState<SavedScanResult | null>(null)
  const [saveMessage, setSaveMessage] = useState('Save the graph to Butterbase after sign-in.')
  const [updatesEnabled, setUpdatesEnabled] = useState(false)
  const [updatesCadence, setUpdatesCadence] = useState<UpdateCadence>('weekly')
  const [updatesEmail, setUpdatesEmail] = useState('')
  const [isSavingUpdates, setIsSavingUpdates] = useState(false)
  const [updatesMessage, setUpdatesMessage] = useState('Sign in to receive updates for this industry.')
  const [industryUpdates, setIndustryUpdates] = useState<IndustryUpdateResult | null>(null)

  const graph = useMemo(
    () => buildMarketGraph(activePrompt, mode, depth, scanNumber),
    [activePrompt, depth, mode, scanNumber],
  )

  const visibleNodes = useMemo(() => {
    if (filter === 'all') return graph.nodes
    const filtered = graph.nodes.filter((node) => node.kind === filter || node.id === selectedNodeId)
    return filtered.length > 0 ? filtered : graph.nodes
  }, [filter, graph.nodes, selectedNodeId])

  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes.find((node) => node.id === 'idea')

  const updateTopic = activePrompt.trim() || DEFAULT_PROMPT

  useEffect(() => {
    let isMounted = true

    const hydrateAuth = async () => {
      if (!isButterbaseConfigured) {
        setAuthMessage('Add Butterbase env values to enable Google sign-in.')
        return
      }

      setIsAuthBusy(true)

      try {
        const callbackUser = await handleOAuthRedirect()
        const currentUser = callbackUser ?? (await getCurrentUser())

        if (!isMounted) return
        setAuthUser(currentUser)
        setAuthMessage(
          currentUser
            ? `Signed in as ${currentUser.email}`
            : 'Google sign-in is ready once the provider is configured.',
        )
      } catch (error) {
        if (!isMounted) return
        setAuthMessage(error instanceof Error ? error.message : 'Could not restore the Butterbase session.')
      } finally {
        if (isMounted) setIsAuthBusy(false)
      }
    }

    void hydrateAuth()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (authUser?.email && !updatesEmail) {
      setUpdatesEmail(authUser.email)
      setUpdatesMessage(`Ready to receive updates at ${authUser.email}.`)
    }
  }, [authUser, updatesEmail])

  const runScan = () => {
    setIsScanning(true)
    setLastSavedScan(null)
    setIndustryUpdates(null)
    setUpdatesEnabled(false)
    setSaveMessage('New graph generated locally. Save it to Butterbase when ready.')
    setUpdatesMessage('New graph generated locally. Opt in to receive updates for it.')

    window.setTimeout(() => {
      setActivePrompt(prompt)
      setScanNumber((value) => value + 1)
      setSelectedNodeId('idea')
      setIsScanning(false)
    }, 650)
  }

  const startGoogleSignIn = async () => {
    setIsAuthBusy(true)
    setAuthMessage('Opening Google sign-in through Butterbase.')

    try {
      signInWithGoogle()
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Google sign-in could not start.')
      setIsAuthBusy(false)
    }
  }

  const signOut = async () => {
    setIsAuthBusy(true)

    try {
      await signOutOfButterbase()
      setAuthUser(null)
      setLastSavedScan(null)
      setIndustryUpdates(null)
      setUpdatesEnabled(false)
      setAuthMessage('Signed out of Butterbase.')
      setSaveMessage('Sign back in with Google to save private scans.')
      setUpdatesMessage('Sign back in with Google to receive industry updates.')
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Could not sign out.')
    } finally {
      setIsAuthBusy(false)
    }
  }

  const saveToButterbase = async () => {
    setIsSaving(true)
    setSaveMessage('Saving scan, evidence, and free report draft.')

    try {
      const savedScan = await saveScanSnapshot({
        graph,
        prompt: activePrompt,
        mode,
        depth,
        scanNumber,
      })

      setLastSavedScan(savedScan)
      setSaveMessage(`Saved ${savedScan.tableWrites} rows to Butterbase.`)
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Could not save the scan to Butterbase.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveIndustryUpdates = async (enabled = updatesEnabled) => {
    setIsSavingUpdates(true)
    setUpdatesMessage(enabled ? `Saving updates for ${updateTopic}.` : `Pausing updates for ${updateTopic}.`)

    try {
      const result = await saveIndustryUpdatePreference({
        topic: updateTopic,
        cadence: updatesCadence,
        deliveryEmail: updatesEmail,
        enabled,
        graph,
        scanId: lastSavedScan?.scanId,
      })

      setIndustryUpdates(result)
      setUpdatesEnabled(result.enabled)
      setUpdatesMessage(result.message)
    } catch (error) {
      setUpdatesEnabled(!enabled)
      setUpdatesMessage(error instanceof Error ? error.message : 'Could not save industry update preference.')
    } finally {
      setIsSavingUpdates(false)
    }
  }

  const toggleIndustryUpdates = (enabled: boolean) => {
    setUpdatesEnabled(enabled)
    void saveIndustryUpdates(enabled)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Competitive graph workspace</div>
          <h1>Rivalry</h1>
        </div>
        <div className="topbar-actions">
          <div className="status-pill">
            <CircleDot size={16} />
            Free founder mode
          </div>
          <div className="auth-card" aria-live="polite">
            <div>
              <strong>{authUser ? authUser.display_name ?? authUser.email : 'Founder account'}</strong>
              <span>{authMessage}</span>
            </div>
            {authUser ? (
              <button type="button" className="icon-button" onClick={signOut} disabled={isAuthBusy} aria-label="Sign out">
                <LogOut size={18} />
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={startGoogleSignIn}
                disabled={!isButterbaseConfigured || isAuthBusy}
              >
                <LogIn size={16} />
                Google
              </button>
            )}
          </div>
          <button type="button" className="icon-button" aria-label="Filter graph">
            <Filter size={18} />
          </button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="panel scan-panel" aria-label="Scan controls">
          <div className="panel-heading">
            <Search size={18} />
            <h2>Founder Brief</h2>
          </div>

          <label className="field-label" htmlFor="scan-input">
            Startup idea or competitive space
          </label>
          <textarea
            id="scan-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            spellCheck="true"
          />

          <div className="control-row">
            <div>
              <span className="field-label">Mode</span>
              <div className="segmented-control" role="group" aria-label="Scan mode">
                {modeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={mode === option.value ? 'is-active' : ''}
                    onClick={() => setMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="field-label">Depth</span>
              <div className="segmented-control" role="group" aria-label="Scan depth">
                {depthOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={depth === option.value ? 'is-active' : ''}
                    onClick={() => setDepth(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button type="button" className="primary-button" onClick={runScan} disabled={isScanning}>
            {isScanning ? <Route size={18} /> : <Play size={18} />}
            {isScanning ? 'Mapping' : 'Build graph'}
          </button>

          <div className="save-card">
            <div className="save-card-header">
              <div>
                <strong>Butterbase Save</strong>
                <span>{saveMessage}</span>
              </div>
              <Save size={18} />
            </div>
            <button
              type="button"
              className="secondary-button full-width"
              onClick={saveToButterbase}
              disabled={!authUser || isSaving || !isButterbaseConfigured}
            >
              <Save size={16} />
              {isSaving ? 'Saving' : 'Save private scan'}
            </button>
            {lastSavedScan ? (
              <div className="save-meta">
                <span>{lastSavedScan.scanId.slice(0, 8)}</span>
                <span>{lastSavedScan.storageObjectId ? 'Storage file' : 'Storage skipped'}</span>
                <span>{lastSavedScan.ragDocumentId ? 'RAG memo' : 'RAG queued'}</span>
              </div>
            ) : null}
            {lastSavedScan?.warnings.length ? (
              <p className="save-warning">{lastSavedScan.warnings[0]}</p>
            ) : null}
          </div>

          <div className="updates-card">
            <div className="save-card-header">
              <div>
                <strong>Industry Updates</strong>
                <span>{updatesMessage}</span>
              </div>
              <Bell size={18} />
            </div>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={updatesEnabled}
                onChange={(event) => toggleIndustryUpdates(event.target.checked)}
                disabled={!authUser || isSavingUpdates || !isButterbaseConfigured}
              />
              <span>
                <strong>Receive updates for {updateTopic}</strong>
                <small>Private in-app digest, email preference saved for later delivery.</small>
              </span>
            </label>

            <label className="field-label compact-label" htmlFor="updates-email">
              Delivery email
            </label>
            <div className="input-with-icon">
              <Mail size={16} />
              <input
                id="updates-email"
                type="email"
                value={updatesEmail}
                onChange={(event) => setUpdatesEmail(event.target.value)}
                placeholder="founder@example.com"
                disabled={!authUser || isSavingUpdates}
              />
            </div>

            <span className="field-label compact-label">Cadence</span>
            <div className="segmented-control compact-control" role="group" aria-label="Industry update cadence">
              {cadenceOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={updatesCadence === option.value ? 'is-active' : ''}
                  onClick={() => setUpdatesCadence(option.value)}
                  disabled={isSavingUpdates}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="secondary-button full-width"
              onClick={() => saveIndustryUpdates(updatesEnabled)}
              disabled={!authUser || isSavingUpdates || !isButterbaseConfigured}
            >
              <CheckCircle2 size={16} />
              {isSavingUpdates ? 'Saving' : 'Save update preference'}
            </button>
          </div>

          <section className="butterbase-stack" aria-label="Butterbase feature coverage">
            <div className="mini-heading">
              <KeyRound size={16} />
              <span>Butterbase Stack</span>
            </div>
            <div className="feature-grid">
              {butterbaseFeatures.map((feature) => {
                const Icon = FEATURE_ICONS[feature.label] ?? Sparkles
                return (
                  <article key={feature.label} className={`feature-tile feature-${feature.tone}`}>
                    <div>
                      <Icon size={16} />
                      <strong>{feature.label}</strong>
                    </div>
                    <p>{feature.detail}</p>
                    <span>{featureToneLabel[feature.tone]}</span>
                  </article>
                )
              })}
            </div>
          </section>

          <div className="integration-list">
            {envStatus.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="integration-row">
                  <Icon size={18} />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <span className={item.configured ? 'configured' : 'pending'}>
                    {item.configured ? 'Ready' : 'Local'}
                  </span>
                </div>
              )
            })}
          </div>
        </aside>

        <section className="panel graph-panel" aria-label="Generated market graph">
          <div className="graph-header">
            <div>
              <div className="panel-heading">
                <Network size={18} />
                <h2>{graph.title}</h2>
              </div>
              <p>{graph.subtitle}</p>
            </div>
            <div className="filter-strip">
              {FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? 'is-active' : ''}
                  onClick={() => setFilter(item)}
                >
                  {item === 'all' ? 'All' : NODE_STYLE[item].label}
                </button>
              ))}
            </div>
          </div>

          <GraphCanvas
            nodes={visibleNodes}
            edges={graph.edges}
            selectedNode={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />

          <div className="insight-grid">
            {graph.insights.map((insight) => (
              <article key={insight.label} className="metric-card">
                <span>{insight.label}</span>
                <strong>{insight.value}</strong>
                <p>{insight.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel detail-panel" aria-label="Graph details">
          <div className="selected-node">
            {selectedNode ? (
              <>
                <div className="node-kicker">
                  {(() => {
                    const Icon = NODE_STYLE[selectedNode.kind].icon
                    return <Icon size={18} />
                  })()}
                  {NODE_STYLE[selectedNode.kind].label}
                </div>
                <h2>{selectedNode.label}</h2>
                <p>{selectedNode.summary}</p>
                <div className="signal-row">
                  <TrendingUp size={16} />
                  {selectedNode.signal}
                </div>
                {selectedNode.url ? (
                  <a className="source-link" href={selectedNode.url} target="_blank" rel="noreferrer">
                    <Globe2 size={16} />
                    Website
                    <ExternalLink size={14} />
                  </a>
                ) : null}
              </>
            ) : null}
          </div>

          <section className="side-section">
            <h3>Free Report Draft</h3>
            <article className="report-item">
              <div>
                <FileText size={16} />
                <strong>{lastSavedScan ? 'Saved in Butterbase' : 'Ready after save'}</strong>
              </div>
              <p>
                {lastSavedScan
                  ? 'Private scan rows, source artifacts, graph Q&A, and a free memo record are linked together.'
                  : 'Google sign-in unlocks private saved scans, evidence bundles, and a free memo artifact.'}
              </p>
              {lastSavedScan?.functionPlan?.length ? <span>{lastSavedScan.functionPlan[0]}</span> : null}
            </article>
          </section>

          <section className="side-section">
            <h3>Updates Inbox</h3>
            <div className="update-inbox">
              {industryUpdates?.previewItems.length ? (
                industryUpdates.previewItems.map((item) => (
                  <article key={`${item.title}-${item.signal}`} className="update-item">
                    <div>
                      <Bell size={16} />
                      <strong>{item.title}</strong>
                    </div>
                    <p>{item.summary}</p>
                    <span>{item.signal}</span>
                  </article>
                ))
              ) : (
                <article className="update-item">
                  <div>
                    <Bell size={16} />
                    <strong>{updatesEnabled ? 'Waiting for first signal' : 'Not subscribed yet'}</strong>
                  </div>
                  <p>
                    {updatesEnabled
                      ? `Rivalry will surface ${updatesCadence} changes for ${updateTopic}.`
                      : 'Opt in from the scan panel to receive source-backed industry changes.'}
                  </p>
                  <span>{updatesCadence} cadence</span>
                </article>
              )}
            </div>
          </section>

          <section className="side-section">
            <h3>Landscape Signals</h3>
            <div className="activity-list">
              {graph.movers.map((item) => (
                <article key={`${item.name}-${item.signal}`} className="activity-item">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.type}</span>
                  </div>
                  <p>{item.activity}</p>
                  <small>{item.signal}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="side-section">
            <h3>White Space</h3>
            <div className="opportunity-list">
              {graph.opportunities.map((item) => (
                <article key={item.title} className="opportunity-item">
                  <strong>{item.title}</strong>
                  <p>{item.reason}</p>
                  <span>{item.wedge}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="side-section">
            <h3>Evidence Trail</h3>
            <div className="source-list">
              {graph.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                  <Globe2 size={16} />
                  <span>{source.title}</span>
                  <small>{source.signal}</small>
                </a>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}

export default App
