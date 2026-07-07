import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@butterbase/sdk'
import {
  Activity,
  Bell,
  BrainCircuit,
  Cloud,
  Database,
  ExternalLink,
  Globe2,
  Heart,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  Network,
  Plus,
  RadioTower,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import './App.css'
import {
  butterbaseFeatures,
  getCurrentUser,
  handleOAuthRedirect,
  saveIndustryUpdatePreference,
  isButterbaseConfigured,
  loadSupporterProduct,
  saveScanSnapshot,
  signInWithGoogle,
  signOutOfButterbase,
  startSupport,
  subscribeToPipelineEvents,
  type IndustryUpdateResult,
  type SavedScanResult,
  type SupporterProduct,
  type UpdateCadence,
} from './lib/butterbase'
import { buildMarketGraph, formatUsd, type ScanDepth, type ScanMode } from './lib/marketGraph'
import { Onboarding, type FounderBrief } from './components/Onboarding'
import { GraphCanvas } from './components/GraphCanvas'
import { NODE_META } from './components/nodeMeta'
import { IndustryTable } from './components/IndustryTable'
import { NeoAnalyst } from './components/NeoAnalyst'

const FEATURE_ICONS: Record<string, LucideIcon> = {
  'Google OAuth': KeyRound,
  'RLS Data API': ShieldCheck,
  Realtime: RadioTower,
  'Industry Updates': Bell,
  Storage: Save,
  'Native RAG': BrainCircuit,
  Functions: Cloud,
  'AI Gateway': Waypoints,
  Payments: Heart,
}

const featureToneLabel: Record<string, string> = {
  ready: 'Ready',
  hooked: 'Hooked',
  free: 'Free',
  off: 'Off',
}

const cadenceOptions: Array<{ value: UpdateCadence; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
  { value: 'major', label: 'Major' },
]

const envStatus = [
  { label: 'Butterbase', detail: 'Auth · data · AI gateway · payments', configured: isButterbaseConfigured, icon: KeyRound },
  { label: 'Neo4j', detail: 'Competitive graph reasoning', configured: Boolean(import.meta.env.VITE_NEO4J_GRAPH_ENDPOINT), icon: Database },
  { label: 'RocketRide', detail: 'Discovery + extraction pipeline', configured: Boolean(import.meta.env.VITE_ROCKETRIDE_ENDPOINT), icon: Rocket },
]

const BUILD_STEPS = [
  'Expanding the idea into search queries',
  'Discovering companies in the space',
  'Extracting founders and lineage',
  'Linking shared investors',
  'Scoring moats and momentum',
  'Detecting white space',
]

interface FeedItem {
  id: string
  label: string
  source: 'pipeline' | 'butterbase'
}

function App() {
  const [phase, setPhase] = useState<'onboarding' | 'workspace'>('onboarding')
  const [brief, setBrief] = useState<FounderBrief | null>(null)
  const [activePrompt, setActivePrompt] = useState('internship platform')
  const [mode, setMode] = useState<ScanMode>('idea')
  const [depth, setDepth] = useState<ScanDepth>('deep')
  const [scanNumber, setScanNumber] = useState(1)
  const [buildKey, setBuildKey] = useState(0)
  const [building, setBuilding] = useState(false)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState('idea')

  const [authUser, setAuthUser] = useState<User | null>(null)
  const [authMessage, setAuthMessage] = useState('Sign in to save private scans.')
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

  const [supporter, setSupporter] = useState<SupporterProduct | null>(null)
  const [supportMessage, setSupportMessage] = useState('')

  const [feed, setFeed] = useState<FeedItem[]>([])
  const buildTimers = useRef<number[]>([])

  const graph = useMemo(
    () => buildMarketGraph(activePrompt, mode, depth, scanNumber),
    [activePrompt, mode, depth, scanNumber],
  )

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0]
  const selectedCompany = graph.companies.find((company) => company.id === selectedNodeId)
  const updateTopic = activePrompt.trim() || 'internship platform'

  // --- auth hydrate + realtime + billing ---
  useEffect(() => {
    let isMounted = true

    const hydrate = async () => {
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
        setAuthMessage(currentUser ? `Signed in as ${currentUser.email}` : 'Google sign-in is ready.')
      } catch (error) {
        if (isMounted) setAuthMessage(error instanceof Error ? error.message : 'Could not restore the session.')
      } finally {
        if (isMounted) setIsAuthBusy(false)
      }
    }

    void hydrate()
    void loadSupporterProduct().then((product) => {
      if (isMounted) setSupporter(product)
    })

    const unsubscribe = subscribeToPipelineEvents((event) => {
      setFeed((prev) =>
        [{ id: crypto.randomUUID(), label: event.message ?? 'Butterbase event', source: 'butterbase' as const }, ...prev].slice(0, 8),
      )
    })

    const params = new URLSearchParams(window.location.search)
    if (params.get('support') === 'success') setSupportMessage('Thank you for supporting Rivalry! Everything stays free.')

    return () => {
      isMounted = false
      unsubscribe()
      buildTimers.current.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  useEffect(() => {
    if (authUser?.email && !updatesEmail) {
      setUpdatesEmail(authUser.email)
      setUpdatesMessage(`Ready to receive updates at ${authUser.email}.`)
    }
  }, [authUser, updatesEmail])

  const runBuild = (nextPrompt: string, nextMode: ScanMode, nextDepth: ScanDepth) => {
    buildTimers.current.forEach((timer) => window.clearTimeout(timer))
    buildTimers.current = []

    setActivePrompt(nextPrompt)
    setMode(nextMode)
    setDepth(nextDepth)
    setScanNumber((value) => value + 1)
    setBuildKey((value) => value + 1)
    setExpandedIds(new Set())
    setSelectedNodeId('idea')
    setLastSavedScan(null)
    setIndustryUpdates(null)
    setUpdatesEnabled(false)
    setSaveMessage('New graph generated locally. Save it to Butterbase when ready.')
    setUpdatesMessage('Opt in to receive updates for this market.')
    setBuilding(true)
    setFeed([])

    BUILD_STEPS.forEach((label, index) => {
      const timer = window.setTimeout(() => {
        setFeed((prev) => [{ id: `build-${index}`, label, source: 'pipeline' as const }, ...prev].slice(0, 8))
      }, 250 + index * 380)
      buildTimers.current.push(timer)
    })

    const done = window.setTimeout(() => {
      setFeed((prev) => [{ id: 'build-done', label: 'Graph ready — explore the landscape', source: 'pipeline' as const }, ...prev].slice(0, 8))
      setBuilding(false)
    }, 260 + BUILD_STEPS.length * 380)
    buildTimers.current.push(done)
  }

  const launchFromOnboarding = (nextBrief: FounderBrief) => {
    setBrief(nextBrief)
    setPhase('workspace')
    runBuild(nextBrief.idea, nextBrief.mode, nextBrief.depth)
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startGoogleSignIn = () => {
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
        onboarding: brief?.onboarding,
      })
      setLastSavedScan(savedScan)
      setSaveMessage(`Saved ${savedScan.tableWrites} rows across the Butterbase Data API.`)
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

  const support = async () => {
    if (!supporter) return
    setSupportMessage('Opening supporter checkout…')
    const result = await startSupport(supporter.id)
    if (result.url) window.location.assign(result.url)
    else setSupportMessage(result.message)
  }

  const legendKinds = ['company', 'founder', 'investor', 'moat', 'opportunity', 'source'] as const

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <Network size={18} />
          </div>
          <div>
            <div className="brand-name">Rivalry</div>
            <div className="brand-tag">Competitive landscape graphs for day-zero founders</div>
          </div>
        </div>

        <div className="topbar-actions">
          {phase === 'workspace' ? (
            <button type="button" className="ghost-button" onClick={() => setPhase('onboarding')}>
              <Plus size={16} />
              New idea
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={() => void support()} disabled={!supporter}>
            <Heart size={15} />
            Support
          </button>
          <div className="auth-card" aria-live="polite">
            <div>
              <strong>{authUser ? authUser.display_name ?? authUser.email : 'Founder account'}</strong>
              <span>{authMessage}</span>
            </div>
            {authUser ? (
              <button type="button" className="icon-button" onClick={() => void signOut()} disabled={isAuthBusy} aria-label="Sign out">
                <LogOut size={17} />
              </button>
            ) : (
              <button type="button" className="primary-pill" onClick={startGoogleSignIn} disabled={!isButterbaseConfigured || isAuthBusy}>
                <LogIn size={15} />
                Google
              </button>
            )}
          </div>
        </div>
      </header>

      {supportMessage ? <div className="flash">{supportMessage}</div> : null}

      {phase === 'onboarding' ? (
        <Onboarding onLaunch={launchFromOnboarding} busy={building} />
      ) : (
        <main className="workspace">
          <div className="main-col">
            <section className="panel graph-panel">
              <div className="graph-panel-head">
                <div>
                  <div className="panel-eyebrow">Live competitive graph</div>
                  <h2>{graph.title}</h2>
                  <p>{graph.subtitle}</p>
                </div>
                <div className="graph-live">
                  <span className={`live-dot ${building ? 'is-pulsing' : ''}`} />
                  {building ? 'Building' : 'Live'}
                </div>
              </div>

              <GraphCanvas
                nodes={graph.nodes}
                edges={graph.edges}
                expandedIds={expandedIds}
                onToggleExpand={toggleExpand}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
                buildKey={buildKey}
                building={building}
              />

              <div className="graph-legend">
                {legendKinds.map((kind) => (
                  <span key={kind} className="legend-item">
                    <span className="legend-dot" style={{ background: NODE_META[kind].color }} />
                    {NODE_META[kind].label}
                  </span>
                ))}
                <span className="legend-hint">Click a node to expand its connections</span>
              </div>
            </section>

            <section className="analysis-row">
              <NeoAnalyst topic={updateTopic} industry={graph.industry} companies={graph.companies} />
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

            <section className="panel table-panel">
              <IndustryTable
                companies={graph.companies}
                selectedCompanyId={selectedCompany?.id}
                onSelectCompany={setSelectedNodeId}
              />
            </section>
          </div>

          <aside className="rail">
            <section className="panel detail-panel">
              {selectedNode ? (
                <>
                  <div className="detail-kicker" style={{ color: NODE_META[selectedNode.kind].color }}>
                    {(() => {
                      const Icon = NODE_META[selectedNode.kind].icon
                      return <Icon size={16} />
                    })()}
                    {NODE_META[selectedNode.kind].label}
                  </div>
                  <h2>{selectedNode.label}</h2>
                  <p>{selectedNode.summary}</p>

                  {selectedCompany ? (
                    <div className="company-stats">
                      <div>
                        <span>Raised</span>
                        <strong>{formatUsd(selectedCompany.raiseUsd)}</strong>
                      </div>
                      <div>
                        <span>Stage</span>
                        <strong>{selectedCompany.stage}</strong>
                      </div>
                      <div>
                        <span>Moat</span>
                        <strong>{selectedCompany.moat} · {selectedCompany.moatScore}</strong>
                      </div>
                      <div>
                        <span>Momentum</span>
                        <strong>{selectedCompany.momentum}/100</strong>
                      </div>
                      <div>
                        <span>Investors</span>
                        <strong>{selectedCompany.investors.join(', ')}</strong>
                      </div>
                      <div>
                        <span>Founders</span>
                        <strong>{selectedCompany.founders.join(', ')}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="signal-row">
                      <TrendingUp size={15} />
                      {selectedNode.signal}
                    </div>
                  )}

                  {selectedNode.expandable ? (
                    <div className="expand-hint">
                      <Plus size={13} /> Click this node in the graph to {expandedIds.has(selectedNode.id) ? 'collapse' : 'expand'} its connections
                    </div>
                  ) : null}

                  {selectedNode.url ? (
                    <a className="source-link" href={selectedNode.url} target="_blank" rel="noreferrer">
                      <Globe2 size={15} />
                      Visit source
                      <ExternalLink size={13} />
                    </a>
                  ) : null}
                </>
              ) : null}
            </section>

            <section className="panel feed-panel">
              <div className="panel-heading">
                <Activity size={16} />
                <h3>Live pipeline</h3>
              </div>
              <div className="feed-list">
                {feed.length === 0 ? (
                  <p className="feed-empty">Pipeline events stream here as the graph builds and saves to Butterbase.</p>
                ) : (
                  feed.map((item) => (
                    <div key={item.id} className={`feed-item source-${item.source}`}>
                      <span className="feed-tag">{item.source === 'butterbase' ? 'Butterbase' : 'RocketRide'}</span>
                      {item.label}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel save-panel">
              <div className="save-head">
                <div>
                  <strong>Save private scan</strong>
                  <span>{saveMessage}</span>
                </div>
                <Save size={17} />
              </div>
              <button
                type="button"
                className="rail-button"
                onClick={() => void saveToButterbase()}
                disabled={!authUser || isSaving || !isButterbaseConfigured}
              >
                <Save size={15} />
                {isSaving ? 'Saving…' : 'Save to Butterbase'}
              </button>
              {lastSavedScan ? (
                <div className="save-meta">
                  <span>{lastSavedScan.tableWrites} rows</span>
                  <span>{lastSavedScan.storageObjectId ? 'Storage ✓' : 'Storage skipped'}</span>
                  <span>{lastSavedScan.ragDocumentId ? 'RAG ✓' : 'RAG queued'}</span>
                </div>
              ) : null}
            </section>

            <section className="panel updates-panel">
              <div className="save-head">
                <div>
                  <strong>Industry updates</strong>
                  <span>{updatesMessage}</span>
                </div>
                <Bell size={17} />
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={updatesEnabled}
                  onChange={(event) => toggleIndustryUpdates(event.target.checked)}
                  disabled={!authUser || isSavingUpdates || !isButterbaseConfigured}
                />
                <span>
                  <strong>Watch {updateTopic}</strong>
                  <small>Private in-app digest. Email saved for later delivery.</small>
                </span>
              </label>
              <div className="input-with-icon">
                <Mail size={15} />
                <input
                  type="email"
                  value={updatesEmail}
                  onChange={(event) => setUpdatesEmail(event.target.value)}
                  placeholder="founder@example.com"
                  disabled={!authUser || isSavingUpdates}
                />
              </div>
              <div className="segmented-control compact">
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
              {industryUpdates?.previewItems.length ? (
                <div className="update-preview">
                  {industryUpdates.previewItems.map((item) => (
                    <article key={item.title}>
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="panel supporter-panel">
              <div className="save-head">
                <div>
                  <strong>Free forever · supporter optional</strong>
                  <span>Every judged feature is free. Back the build if you want.</span>
                </div>
                <Heart size={17} />
              </div>
              <button type="button" className="rail-button ghost" onClick={() => void support()} disabled={!supporter}>
                <Heart size={15} />
                {supporter?.configured ? `Support · ${supporter.priceLabel}` : 'Support Rivalry'}
              </button>
            </section>

            <section className="panel stack-panel">
              <div className="panel-heading">
                <Sparkles size={16} />
                <h3>Butterbase stack</h3>
              </div>
              <div className="stack-grid">
                {butterbaseFeatures.map((feature) => {
                  const Icon = FEATURE_ICONS[feature.label] ?? Sparkles
                  return (
                    <article key={feature.label} className={`stack-tile tone-${feature.tone}`}>
                      <div>
                        <Icon size={14} />
                        <strong>{feature.label}</strong>
                        <span>{featureToneLabel[feature.tone]}</span>
                      </div>
                      <p>{feature.detail}</p>
                    </article>
                  )
                })}
              </div>
              <div className="integration-list">
                {envStatus.map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="integration-row">
                      <Icon size={16} />
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                      <span className={item.configured ? 'configured' : 'pending'}>{item.configured ? 'Ready' : 'Local'}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
