export type ScanMode = 'industry' | 'idea' | 'company'
export type ScanDepth = 'fast' | 'deep'

export type NodeKind =
  | 'idea'
  | 'company'
  | 'person'
  | 'website'
  | 'segment'
  | 'investor'
  | 'opportunity'
  | 'trend'

export interface GraphNode {
  id: string
  label: string
  kind: NodeKind
  x: number
  y: number
  summary: string
  signal: string
  url?: string
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  label: string
  strength: 'weak' | 'medium' | 'strong'
}

export interface Insight {
  label: string
  value: string
  detail: string
}

export interface MarketGraph {
  title: string
  subtitle: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  insights: Insight[]
  movers: Array<{
    name: string
    type: string
    activity: string
    signal: string
  }>
  opportunities: Array<{
    title: string
    reason: string
    wedge: string
  }>
  sources: Array<{
    title: string
    url: string
    signal: string
  }>
  generatedAt: string
}

const DEFAULT_PROMPT = 'AI tools for independent insurance brokers'

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'their',
  'to',
  'with',
])

const PEOPLE = [
  'Maya Chen',
  'Jon Bell',
  'Priya Shah',
  'Alex Morgan',
  'Nadia Park',
  'Leo Fischer',
]

const INVESTORS = [
  'Northstar Ventures',
  'Signal Ridge Capital',
  'Foundry Lane',
  'Operator Collective',
  'Seedline Partners',
  'Frontier Fund',
]

const COMPANY_SUFFIXES = ['OS', 'Flow', 'Works', 'Stack', 'Grid', 'Loop']

const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase()
      if (lower === 'ai') return 'AI'
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const compact = (value: string) => value.replace(/[^a-z0-9]/gi, '')

const wordsFrom = (prompt: string) =>
  prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))

const pick = <T,>(items: T[], seed: number) => items[Math.abs(seed) % items.length]

const checksum = (value: string) =>
  Array.from(value).reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0)

const deriveSegment = (prompt: string) => {
  const forMatch = prompt.match(/\bfor\s+(.+)$/i)
  const inMatch = prompt.match(/\bin\s+(.+)$/i)
  const segment = forMatch?.[1] ?? inMatch?.[1] ?? prompt
  return titleCase(segment.slice(0, 64))
}

const primaryConcept = (prompt: string) => {
  const words = wordsFrom(prompt)
  if (words.length === 0) return 'Market'
  return titleCase(words.slice(0, 2).join(' '))
}

const relationshipCount = (depth: ScanDepth) => (depth === 'deep' ? '28' : '16')

export const buildMarketGraph = (
  rawPrompt: string,
  mode: ScanMode,
  depth: ScanDepth,
  scanNumber: number,
): MarketGraph => {
  const prompt = rawPrompt.trim() || DEFAULT_PROMPT
  const seed = checksum(`${prompt}:${mode}:${depth}:${scanNumber}`)
  const concept = primaryConcept(prompt)
  const segment = deriveSegment(prompt)
  const primary = compact(concept).slice(0, 12) || 'Market'
  const secondary = compact(segment.split(' ')[0] ?? 'Market') || 'Market'

  const companies = COMPANY_SUFFIXES.slice(0, depth === 'deep' ? 5 : 4).map(
    (suffix, index) => `${index % 2 === 0 ? primary : secondary}${suffix}`,
  )

  const personA = pick(PEOPLE, seed)
  const personB = pick(PEOPLE, seed + 3)
  const investorA = pick(INVESTORS, seed + 1)
  const investorB = pick(INVESTORS, seed + 4)
  const websiteRoot = slugify(segment || concept || 'market')

  const nodes: GraphNode[] = [
    {
      id: 'idea',
      label: mode === 'company' ? `${concept} ecosystem` : concept,
      kind: 'idea',
      x: 50,
      y: 48,
      summary: `Initial thesis around ${prompt}.`,
      signal: 'Anchor query',
    },
    {
      id: 'segment',
      label: segment,
      kind: 'segment',
      x: 50,
      y: 16,
      summary: `Primary buyer or market segment detected from the scan input.`,
      signal: 'Customer gravity',
    },
    {
      id: 'trend',
      label: `${concept} automation`,
      kind: 'trend',
      x: 22,
      y: 20,
      summary: `A recurring positioning theme across products, hiring, and web copy.`,
      signal: 'Rising narrative',
    },
    {
      id: 'company-1',
      label: companies[0],
      kind: 'company',
      x: 23,
      y: 45,
      summary: `Targets ${segment.toLowerCase()} with workflow automation and data capture.`,
      signal: 'Product velocity',
      url: `https://${slugify(companies[0])}.com`,
    },
    {
      id: 'company-2',
      label: companies[1],
      kind: 'company',
      x: 78,
      y: 39,
      summary: `Positions around integrations, reporting, and faster operational handoffs.`,
      signal: 'Hiring signal',
      url: `https://${slugify(companies[1])}.com`,
    },
    {
      id: 'company-3',
      label: companies[2],
      kind: 'company',
      x: 70,
      y: 69,
      summary: `Emerging entrant with narrow wedge and strong content footprint.`,
      signal: 'New entrant',
      url: `https://${slugify(companies[2])}.ai`,
    },
    {
      id: 'person-1',
      label: personA,
      kind: 'person',
      x: 17,
      y: 73,
      summary: `Operator profile connected to product launches and sector commentary.`,
      signal: 'Founder / operator',
    },
    {
      id: 'person-2',
      label: personB,
      kind: 'person',
      x: 85,
      y: 67,
      summary: `Visible expert source across talks, posts, and adjacent company activity.`,
      signal: 'Market voice',
    },
    {
      id: 'investor-1',
      label: investorA,
      kind: 'investor',
      x: 83,
      y: 15,
      summary: `Backs tools with industry-specific workflow depth.`,
      signal: 'Capital cluster',
    },
    {
      id: 'website-1',
      label: `${websiteRoot || 'market'}-brief.com`,
      kind: 'website',
      x: 37,
      y: 82,
      summary: `Source cluster for product messaging, customer claims, and category terms.`,
      signal: 'Web evidence',
      url: `https://${websiteRoot || 'market'}-brief.com`,
    },
    {
      id: 'opportunity-1',
      label: 'Workflow gap',
      kind: 'opportunity',
      x: 48,
      y: 70,
      summary: `A narrow wedge where incumbents appear broad and buyers still stitch tools together.`,
      signal: 'White space',
    },
    {
      id: 'opportunity-2',
      label: 'Trust layer',
      kind: 'opportunity',
      x: 62,
      y: 28,
      summary: `A defensible layer around verification, provenance, or explainable recommendations.`,
      signal: 'Differentiation',
    },
  ]

  if (depth === 'deep') {
    nodes.push(
      {
        id: 'company-4',
        label: companies[3],
        kind: 'company',
        x: 8,
        y: 33,
        summary: `Older platform with broad feature surface and partnership reach.`,
        signal: 'Incumbent',
        url: `https://${slugify(companies[3])}.com`,
      },
      {
        id: 'investor-2',
        label: investorB,
        kind: 'investor',
        x: 58,
        y: 90,
        summary: `Shows repeat exposure to this market through adjacent bets.`,
        signal: 'Adjacent thesis',
      },
      {
        id: 'website-2',
        label: `${websiteRoot || 'market'}-jobs.com`,
        kind: 'website',
        x: 92,
        y: 50,
        summary: `Hiring and role taxonomy source for what teams are building next.`,
        signal: 'Hiring evidence',
        url: `https://${websiteRoot || 'market'}-jobs.com`,
      },
    )
  }

  const edges: GraphEdge[] = [
    { id: 'e1', from: 'idea', to: 'segment', label: 'TARGETS', strength: 'strong' },
    { id: 'e2', from: 'idea', to: 'trend', label: 'EXPLORES', strength: 'medium' },
    { id: 'e3', from: 'company-1', to: 'segment', label: 'SERVES', strength: 'strong' },
    { id: 'e4', from: 'company-2', to: 'segment', label: 'SERVES', strength: 'medium' },
    { id: 'e5', from: 'company-3', to: 'opportunity-1', label: 'VALIDATES', strength: 'medium' },
    { id: 'e6', from: 'company-1', to: 'person-1', label: 'FOUNDED_BY', strength: 'strong' },
    { id: 'e7', from: 'company-2', to: 'person-2', label: 'LED_BY', strength: 'medium' },
    { id: 'e8', from: 'company-2', to: 'investor-1', label: 'FUNDED_BY', strength: 'medium' },
    { id: 'e9', from: 'website-1', to: 'company-1', label: 'MENTIONS', strength: 'weak' },
    { id: 'e10', from: 'website-1', to: 'company-3', label: 'MENTIONS', strength: 'weak' },
    { id: 'e11', from: 'trend', to: 'opportunity-2', label: 'SUGGESTS', strength: 'medium' },
    { id: 'e12', from: 'opportunity-2', to: 'segment', label: 'UNLOCKS', strength: 'strong' },
  ]

  if (depth === 'deep') {
    edges.push(
      { id: 'e13', from: 'company-4', to: 'segment', label: 'SERVES', strength: 'medium' },
      { id: 'e14', from: 'company-4', to: 'company-1', label: 'COMPETES_WITH', strength: 'strong' },
      { id: 'e15', from: 'company-3', to: 'investor-2', label: 'WATCHED_BY', strength: 'weak' },
      { id: 'e16', from: 'website-2', to: 'company-2', label: 'HIRING_FOR', strength: 'medium' },
      { id: 'e17', from: 'website-2', to: 'trend', label: 'EVIDENCES', strength: 'medium' },
    )
  }

  return {
    title: `${concept} market graph`,
    subtitle: `${segment} | ${relationshipCount(depth)} mapped relationships | scan ${scanNumber}`,
    nodes,
    edges,
    insights: [
      {
        label: 'Companies',
        value: String(nodes.filter((node) => node.kind === 'company').length),
        detail: 'Ranked by velocity, focus, and graph proximity.',
      },
      {
        label: 'People',
        value: String(nodes.filter((node) => node.kind === 'person').length),
        detail: 'Founder, operator, and market voice candidates.',
      },
      {
        label: 'Web signals',
        value: String(nodes.filter((node) => node.kind === 'website').length),
        detail: 'Messaging, hiring, partnership, and content sources.',
      },
      {
        label: 'Open wedges',
        value: '2',
        detail: 'Relationship gaps worth validating first.',
      },
    ],
    movers: [
      {
        name: companies[0],
        type: 'Major player',
        activity: `Tightening product language around ${segment.toLowerCase()}.`,
        signal: 'Messaging changed',
      },
      {
        name: companies[1],
        type: 'Fast mover',
        activity: 'Adding integration-heavy roles and partner pages.',
        signal: 'Hiring and site updates',
      },
      {
        name: personA,
        type: 'Person',
        activity: `Publishing sector-specific takes on ${concept.toLowerCase()}.`,
        signal: 'Thought leadership',
      },
      {
        name: investorA,
        type: 'Investor',
        activity: 'Clusters around workflow software with vertical data moats.',
        signal: 'Portfolio pattern',
      },
    ],
    opportunities: [
      {
        title: 'Narrower buyer wedge',
        reason: `Most mapped players speak broadly to ${segment.toLowerCase()}.`,
        wedge: 'Start with one painful workflow and expand from graph-adjacent jobs.',
      },
      {
        title: 'Proof and provenance layer',
        reason: 'Few nodes are connected to evidence trails users can inspect.',
        wedge: 'Make every recommendation explainable through source-linked graph paths.',
      },
      {
        title: 'Partner-led distribution',
        reason: 'People and websites sit between buyers and products.',
        wedge: 'Recruit trusted operators before pushing paid acquisition.',
      },
    ],
    sources: [
      {
        title: companies[0],
        url: `https://${slugify(companies[0])}.com`,
        signal: 'Product and positioning scan',
      },
      {
        title: `${segment} jobs`,
        url: `https://${websiteRoot || 'market'}-jobs.com`,
        signal: 'Hiring taxonomy',
      },
      {
        title: `${concept} funding cluster`,
        url: `https://${slugify(concept)}-funding.example`,
        signal: 'Investor pattern',
      },
    ],
    generatedAt: new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(new Date()),
  }
}
