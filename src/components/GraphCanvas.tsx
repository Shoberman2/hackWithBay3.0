import { useMemo, type CSSProperties } from 'react'
import { Minus, Plus } from 'lucide-react'
import { CANVAS, type GraphEdge, type GraphNode } from '../lib/marketGraph'
import { NODE_META } from './nodeMeta'

const CENTER = { x: CANVAS.width / 2, y: CANVAS.height / 2 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

interface Layout {
  visible: Set<string>
  pos: Map<string, { x: number; y: number }>
}

function computeLayout(nodes: GraphNode[], expandedIds: Set<string>): Layout {
  const visible = new Set<string>()
  nodes.forEach((node) => {
    if (node.tier === 0) visible.add(node.id)
  })

  let changed = true
  while (changed) {
    changed = false
    nodes.forEach((node) => {
      if (visible.has(node.id)) return
      if (node.revealedBy.some((pid) => expandedIds.has(pid) && visible.has(pid))) {
        visible.add(node.id)
        changed = true
      }
    })
  }

  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((node) => {
    if (node.tier === 0 && visible.has(node.id)) pos.set(node.id, { x: node.x, y: node.y })
  })

  const maxTier = nodes.reduce((max, node) => Math.max(max, node.tier), 0)
  for (let tier = 1; tier <= maxTier; tier++) {
    const groups = new Map<string, string[]>()
    nodes.forEach((node) => {
      if (node.tier !== tier || !visible.has(node.id)) return
      const parent = node.revealedBy.find((pid) => expandedIds.has(pid) && pos.has(pid))
      if (!parent) return
      groups.set(parent, [...(groups.get(parent) ?? []), node.id])
    })

    groups.forEach((childIds, parentId) => {
      const parent = pos.get(parentId)
      if (!parent) return
      const baseAngle = (Math.atan2(parent.y - CENTER.y, parent.x - CENTER.x) * 180) / Math.PI
      const radius = tier === 1 ? 138 : 104
      const spread = Math.min(160, 46 * Math.max(1, childIds.length - 1))
      const start = baseAngle - spread / 2
      childIds.forEach((cid, index) => {
        const angle = childIds.length === 1 ? baseAngle : start + (spread * index) / (childIds.length - 1)
        const rad = (angle * Math.PI) / 180
        pos.set(cid, {
          x: clamp(parent.x + radius * Math.cos(rad), 46, CANVAS.width - 46),
          y: clamp(parent.y + radius * Math.sin(rad), 40, CANVAS.height - 40),
        })
      })
    })
  }

  relax(pos)
  return { visible, pos }
}

// Box de-overlap: nodes are wide chips, so separate them as rectangles.
function relax(pos: Map<string, { x: number; y: number }>) {
  const ids = [...pos.keys()]
  const MIN_X = 170
  const MIN_Y = 48
  for (let iter = 0; iter < 90; iter++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!
        const b = pos.get(ids[j])!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = MIN_X - Math.abs(dx)
        const overlapY = MIN_Y - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue
        moved = true
        const pinA = ids[i] === 'idea'
        const pinB = ids[j] === 'idea'
        if (overlapX < overlapY) {
          const push = (overlapX / 2 + 0.5) * (dx < 0 ? -1 : 1)
          if (!pinA) a.x -= pinB ? push * 2 : push
          if (!pinB) b.x += pinA ? push * 2 : push
        } else {
          const push = (overlapY / 2 + 0.5) * (dy < 0 ? -1 : 1)
          if (!pinA) a.y -= pinB ? push * 2 : push
          if (!pinB) b.y += pinA ? push * 2 : push
        }
      }
    }
    if (!moved) break
  }
  pos.forEach((point) => {
    point.x = clamp(point.x, 82, CANVAS.width - 82)
    point.y = clamp(point.y, 26, CANVAS.height - 26)
  })
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const offset = 0.12
  const cx = midX - dy * offset
  const cy = midY + dx * offset
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`
}

export function GraphCanvas({
  nodes,
  edges,
  expandedIds,
  onToggleExpand,
  selectedId,
  onSelect,
  buildKey,
  building,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  selectedId: string
  onSelect: (id: string) => void
  buildKey: number
  building: boolean
}) {
  const { visible, pos } = useMemo(() => computeLayout(nodes, expandedIds), [nodes, expandedIds])

  const visibleNodes = nodes.filter((node) => visible.has(node.id) && pos.has(node.id))
  const visibleEdges = edges.filter((edge) => pos.has(edge.from) && pos.has(edge.to))

  // stagger base nodes during the initial build, index by draw order
  const baseOrder = new Map<string, number>()
  visibleNodes.filter((node) => node.tier === 0).forEach((node, index) => baseOrder.set(node.id, index))

  return (
    <div className="graph-stage" key={buildKey}>
      <div className="graph-grid" aria-hidden />
      <svg
        className="graph-edges"
        viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="edge-strong" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgba(55,224,176,0.15)" />
            <stop offset="0.5" stopColor="rgba(55,224,176,0.55)" />
            <stop offset="1" stopColor="rgba(78,161,255,0.35)" />
          </linearGradient>
        </defs>
        {visibleEdges.map((edge) => {
          const from = pos.get(edge.from)!
          const to = pos.get(edge.to)!
          const active = selectedId === edge.from || selectedId === edge.to
          return (
            <path
              key={edge.id}
              d={edgePath(from, to)}
              className={`graph-edge strength-${edge.strength} ${active ? 'is-active' : ''}`}
              fill="none"
            />
          )
        })}
      </svg>

      <div className="graph-nodes">
        {visibleNodes.map((node) => {
          const meta = NODE_META[node.kind]
          const Icon = meta.icon
          const point = pos.get(node.id)!
          const isSelected = selectedId === node.id
          const isExpanded = expandedIds.has(node.id)
          const delay = building && node.tier === 0 ? (baseOrder.get(node.id) ?? 0) * 70 : 0
          const nodeStyle = {
            left: `${(point.x / CANVAS.width) * 100}%`,
            top: `${(point.y / CANVAS.height) * 100}%`,
            '--accent': meta.color,
            animationDelay: `${delay}ms`,
          } as CSSProperties

          return (
            <button
              type="button"
              key={node.id}
              className={`gnode kind-${node.kind} tier-${node.tier} ${isSelected ? 'is-selected' : ''} ${
                isExpanded ? 'is-expanded' : ''
              }`}
              style={nodeStyle}
              onClick={() => {
                onSelect(node.id)
                if (node.expandable) onToggleExpand(node.id)
              }}
            >
              <span className="gnode-glow" aria-hidden />
              <span className="gnode-icon" aria-hidden>
                <Icon size={node.tier === 0 ? 15 : 13} />
              </span>
              <span className="gnode-label">{node.label}</span>
              {node.metric ? <span className="gnode-metric">{node.metric}</span> : null}
              {node.expandable ? (
                <span className="gnode-expand" aria-hidden>
                  {isExpanded ? <Minus size={11} /> : <Plus size={11} />}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {building ? (
        <div className="graph-building" aria-live="polite">
          <span className="pulse-dot" />
          Assembling landscape…
        </div>
      ) : null}
    </div>
  )
}
