import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  Building2,
  CircleDot,
  Database,
  ExternalLink,
  Filter,
  Globe2,
  KeyRound,
  Layers3,
  Lightbulb,
  Network,
  Play,
  Rocket,
  Route,
  Search,
  Sparkles,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import './App.css'
import { isButterbaseConfigured } from './lib/butterbase'
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

  const runScan = () => {
    setIsScanning(true)

    window.setTimeout(() => {
      setActivePrompt(prompt)
      setScanNumber((value) => value + 1)
      setSelectedNodeId('idea')
      setIsScanning(false)
    }, 650)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">HackwithBay 3.0</div>
          <h1>Rivalry</h1>
        </div>
        <div className="topbar-actions">
          <div className="status-pill">
            <CircleDot size={16} />
            Live graph demo
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
