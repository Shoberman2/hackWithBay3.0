// Rivalry market-graph model.
//
// This module turns a founder's plain-language idea + onboarding answers into a
// competitive landscape: structured company records for the spreadsheet view and
// a tiered, expandable node/edge set for the live graph view. Everything is
// deterministic per prompt so the same idea always yields the same landscape,
// with a curated internship-platform vertical so the flagship demo is credible.

export type ScanMode = 'idea' | 'company' | 'industry'
export type ScanDepth = 'fast' | 'deep'

export type NodeKind =
  | 'idea'
  | 'segment'
  | 'company'
  | 'founder'
  | 'investor'
  | 'feature'
  | 'moat'
  | 'source'
  | 'opportunity'
  | 'trend'

export type Stage = 'Pre-seed' | 'Seed' | 'Series A' | 'Series B' | 'Series C' | 'Public'

export interface Company {
  id: string
  name: string
  stage: Stage
  raiseUsd: number
  foundedYear: number
  employees: number
  hq: string
  segment: string
  moat: string
  moatScore: number
  momentum: number
  leadInvestor: string
  investors: string[]
  founders: string[]
  features: string[]
  url: string
  signal: string
  summary: string
}

export interface GraphNode {
  id: string
  label: string
  kind: NodeKind
  x: number
  y: number
  summary: string
  signal: string
  url?: string
  /** 0 = base landscape, revealed nodes have tier >= 1. */
  tier: number
  /** Node ids that reveal this node when expanded. */
  revealedBy: string[]
  /** Whether clicking this node reveals more connections. */
  expandable: boolean
  /** Optional metric shown on the node badge (e.g. raise size). */
  metric?: string
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

export interface IndustryStats {
  companyCount: number
  totalRaisedUsd: number
  medianRaiseUsd: number
  topStage: Stage
  hottestSegment: string
  mostBacked: string
  avgMoat: number
  whitespace: string
}

export interface MarketGraph {
  title: string
  subtitle: string
  concept: string
  segment: string
  companies: Company[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  industry: IndustryStats
  insights: Insight[]
  movers: Array<{ name: string; type: string; activity: string; signal: string }>
  opportunities: Array<{ title: string; reason: string; wedge: string }>
  sources: Array<{ title: string; url: string; signal: string }>
  generatedAt: string
}

const DEFAULT_PROMPT = 'internship platform'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of',
  'on', 'or', 'the', 'their', 'to', 'with', 'platform', 'app', 'tool', 'startup',
])

const STAGES: Stage[] = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Public']

const MOATS = [
  'Network effects',
  'Proprietary data',
  'Regulatory license',
  'Distribution lock-in',
  'Switching costs',
  'Brand trust',
  'Supply density',
]

const PEOPLE = [
  'Maya Chen', 'Jon Bell', 'Priya Shah', 'Alex Morgan', 'Nadia Park',
  'Leo Fischer', 'Sofia Reyes', 'Ibrahim Khan', 'Grace Liu', 'Marco Neri',
]

const EX_EMPLOYERS = ['Stripe', 'Google', 'Palantir', 'Ramp', 'Airbnb', 'Rippling', 'Plaid', 'Notion']

const INVESTORS = [
  'Northstar Ventures',
  'Signal Ridge Capital',
  'Foundry Lane',
  'Operator Collective',
  'Seedline Partners',
  'Frontier Fund',
]

const HQS = ['San Francisco', 'New York', 'Austin', 'London', 'Boston', 'Toronto']
const SUFFIXES = ['OS', 'Flow', 'Works', 'Stack', 'Grid', 'Loop', 'Base', 'Labs']
const FEATURE_POOL = [
  'AI matching',
  'Verified profiles',
  'Realtime analytics',
  'Workflow automation',
  'Integrations hub',
  'Compliance engine',
  'Mobile-first UX',
  'Provenance ledger',
]

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.toLowerCase() === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ')

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const compact = (value: string) => value.replace(/[^a-z0-9]/gi, '')

const wordsFrom = (prompt: string) =>
  prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))

const checksum = (value: string) =>
  Array.from(value).reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0)

const pick = <T,>(items: T[], seed: number) => items[Math.abs(seed) % items.length]

const primaryConcept = (prompt: string) => {
  const words = wordsFrom(prompt)
  if (words.length === 0) return 'Market'
  return titleCase(words.slice(0, 2).join(' '))
}

const deriveSegment = (prompt: string) => {
  const forMatch = prompt.match(/\bfor\s+(.+)$/i)
  const inMatch = prompt.match(/\bin\s+(.+)$/i)
  const segment = forMatch?.[1] ?? inMatch?.[1] ?? prompt
  return titleCase(segment.slice(0, 48))
}

export const formatUsd = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value}`
}

// ---------------------------------------------------------------------------
// curated verticals (make the flagship demo credible + graph-native)
// ---------------------------------------------------------------------------

interface SeedCompany {
  name: string
  stage: Stage
  raiseUsd: number
  foundedYear: number
  employees: number
  hq: string
  segment: string
  moat: string
  moatScore: number
  momentum: number
  leadInvestor: string
  investors: string[]
  founders: string[]
  features: string[]
  signal: string
  summary: string
}

interface Vertical {
  concept: string
  segment: string
  companies: SeedCompany[]
  opportunities: Array<{ title: string; reason: string; wedge: string }>
  whitespace: string
  trend: string
}

const INTERNSHIP_VERTICAL: Vertical = {
  concept: 'Internship Platform',
  segment: 'Early-career talent',
  whitespace: 'SMB employers with no recruiting stack are unserved between job boards and enterprise ATS.',
  trend: 'AI-matched early talent',
  companies: [
    {
      name: 'Handshake', stage: 'Series C', raiseUsd: 434_000_000, foundedYear: 2014, employees: 900,
      hq: 'San Francisco', segment: 'University-partnered', moat: 'Distribution lock-in', moatScore: 92, momentum: 71,
      leadInvestor: 'Northstar Ventures', investors: ['Northstar Ventures', 'Frontier Fund'],
      founders: ['Garrett Lord'], features: ['Verified profiles', 'AI matching', 'Realtime analytics'],
      signal: 'Category anchor', summary: 'Owns university career-center distribution, the deepest moat in the space.',
    },
    {
      name: 'RippleMatch', stage: 'Series B', raiseUsd: 63_500_000, foundedYear: 2016, employees: 180,
      hq: 'New York', segment: 'University-partnered', moat: 'Proprietary data', moatScore: 74, momentum: 80,
      leadInvestor: 'Signal Ridge Capital', investors: ['Signal Ridge Capital', 'Northstar Ventures'],
      founders: ['Andrew Myers'], features: ['AI matching', 'Workflow automation'],
      signal: 'Matching workflow', summary: 'Automated candidate-to-role matching, sharpest ML wedge among challengers.',
    },
    {
      name: 'Parker Dewey', stage: 'Series A', raiseUsd: 18_000_000, foundedYear: 2015, employees: 70,
      hq: 'Chicago', segment: 'SMB employers', moat: 'Supply density', moatScore: 61, momentum: 76,
      leadInvestor: 'Operator Collective', investors: ['Operator Collective'],
      founders: ['Jeffrey Moss'], features: ['Micro-internships', 'Integrations hub'],
      signal: 'Micro-internship wedge', summary: 'Short paid projects let employers trial talent before committing.',
    },
    {
      name: 'Symplicity', stage: 'Public', raiseUsd: 120_000_000, foundedYear: 1996, employees: 650,
      hq: 'Arlington', segment: 'University-partnered', moat: 'Switching costs', moatScore: 83, momentum: 38,
      leadInvestor: 'Frontier Fund', investors: ['Frontier Fund'],
      founders: ['Ariel Friedler'], features: ['Compliance engine', 'Integrations hub'],
      signal: 'Incumbent platform', summary: 'Legacy career-services software with high switching costs but low momentum.',
    },
    {
      name: 'WayUp', stage: 'Series B', raiseUsd: 27_500_000, foundedYear: 2014, employees: 120,
      hq: 'New York', segment: 'Diversity hiring', moat: 'Brand trust', moatScore: 58, momentum: 64,
      leadInvestor: 'Seedline Partners', investors: ['Seedline Partners', 'Signal Ridge Capital'],
      founders: ['Liz Wessel'], features: ['Mobile-first UX', 'Verified profiles'],
      signal: 'Diversity distribution', summary: 'Consumer-brand early-talent marketplace focused on diverse candidates.',
    },
  ],
  opportunities: [
    {
      title: 'SMB internship OS',
      reason: 'Every scaled player optimizes for universities and enterprise recruiting teams.',
      wedge: 'Own the small employer with a zero-setup workflow, expand into adjacent early-talent hiring.',
    },
    {
      title: 'Proof-backed candidate layer',
      reason: 'No competitor connects candidate work to inspectable evidence.',
      wedge: 'Make every recommendation explainable through source-linked project history.',
    },
    {
      title: 'Founder lineage advantage',
      reason: 'Talent clusters out of the incumbents but nobody recruits them systematically.',
      wedge: 'Recruit operators from Handshake / Symplicity before scaling acquisition.',
    },
  ],
}

const matchVertical = (prompt: string): Vertical | null => {
  const lower = prompt.toLowerCase()
  if (/(intern|early talent|early-career|campus|student|recruit|new grad)/.test(lower)) {
    return INTERNSHIP_VERTICAL
  }
  return null
}

// ---------------------------------------------------------------------------
// synthetic vertical (any other idea)
// ---------------------------------------------------------------------------

const syntheticVertical = (prompt: string, seed: number, count: number): Vertical => {
  const concept = primaryConcept(prompt)
  const segment = deriveSegment(prompt)
  const primary = compact(concept).slice(0, 12) || 'Market'
  const secondary = compact(segment.split(' ')[0] ?? 'Market') || 'Market'
  const segments = [segment, `${titleCase(segment.split(' ')[0] ?? 'SMB')} mid-market`, 'Self-serve']

  const companies: SeedCompany[] = Array.from({ length: count }).map((_, index) => {
    const s = seed + index * 37
    const base = index % 2 === 0 ? primary : secondary
    const name = `${base}${pick(SUFFIXES, s)}`
    const stageIndex = Math.max(0, Math.min(STAGES.length - 1, 4 - Math.round((index / count) * 4) + (s % 2)))
    const stage = STAGES[stageIndex]
    const raiseBase = [1_500_000, 6_000_000, 22_000_000, 65_000_000, 140_000_000, 380_000_000][stageIndex]
    const raiseUsd = Math.round((raiseBase * (0.65 + ((s % 70) / 100))) / 100_000) * 100_000
    return {
      name,
      stage,
      raiseUsd,
      foundedYear: 2013 + (s % 11),
      employees: 12 + ((s * 7) % 640),
      hq: pick(HQS, s),
      segment: pick(segments, s),
      moat: pick(MOATS, s + 2),
      moatScore: 46 + ((s * 13) % 50),
      momentum: 40 + ((s * 17) % 58),
      leadInvestor: pick(INVESTORS, s),
      investors: [pick(INVESTORS, s), pick(INVESTORS, s + 3)].filter((v, i, arr) => arr.indexOf(v) === i),
      founders: [pick(PEOPLE, s), ...(s % 3 === 0 ? [pick(PEOPLE, s + 5)] : [])],
      features: [pick(FEATURE_POOL, s), pick(FEATURE_POOL, s + 4)].filter((v, i, arr) => arr.indexOf(v) === i),
      signal: ['Category anchor', 'Fast follower', 'New entrant', 'Incumbent', 'Emerging wedge'][index % 5],
      summary: `${['Direct competitor', 'Adjacent player', 'Emerging entrant', 'Broad incumbent', 'Niche challenger'][index % 5]} in ${pick(segments, s).toLowerCase()}.`,
    }
  })

  return {
    concept,
    segment,
    whitespace: `Most players speak broadly to ${segment.toLowerCase()} while a sharper buyer segment stays underserved.`,
    trend: `${concept} automation`,
    companies,
    opportunities: [
      {
        title: 'Narrow buyer wedge',
        reason: `Mapped players all target ${segment.toLowerCase()} broadly.`,
        wedge: 'Win one painful workflow first, then expand across graph-adjacent jobs.',
      },
      {
        title: 'Proof and provenance layer',
        reason: 'Few competitors connect claims to inspectable evidence.',
        wedge: 'Make every recommendation explainable through source-linked graph paths.',
      },
      {
        title: 'Operator-led distribution',
        reason: 'Founders and channels sit between buyers and products.',
        wedge: 'Recruit trusted operators before pushing broad acquisition.',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// layout — organic radial placement on a 1000 x 620 canvas
// ---------------------------------------------------------------------------

export const CANVAS = { width: 1000, height: 620 }

const polar = (cx: number, cy: number, radius: number, angleDeg: number) => ({
  x: cx + radius * Math.cos((angleDeg * Math.PI) / 180),
  y: cy + radius * Math.sin((angleDeg * Math.PI) / 180),
})

// ---------------------------------------------------------------------------
// graph assembly
// ---------------------------------------------------------------------------

const buildFromVertical = (vertical: Vertical, mode: ScanMode, scanNumber: number): MarketGraph => {
  const { concept, segment, companies: seeds } = vertical
  const cx = CANVAS.width / 2
  const cy = CANVAS.height / 2

  const companies: Company[] = seeds.map((seed, index) => ({
    id: `company-${index}`,
    url: `https://${slugify(seed.name)}.com`,
    ...seed,
  }))

  const segments = Array.from(new Set(companies.map((c) => c.segment)))
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const edge = (from: string, to: string, label: string, strength: GraphEdge['strength']) =>
    edges.push({ id: `e-${from}-${to}-${label}`, from, to, label, strength })

  // --- base tier: idea, segments, companies, shared investors, trend ---
  nodes.push({
    id: 'idea',
    label: mode === 'company' ? `${concept} ecosystem` : concept,
    kind: 'idea',
    x: cx,
    y: cy,
    summary: `Day-zero founder thesis around ${concept.toLowerCase()}.`,
    signal: 'Idea anchor',
    tier: 0,
    revealedBy: [],
    expandable: false,
  })

  nodes.push({
    id: 'trend',
    label: vertical.trend,
    kind: 'trend',
    ...polar(cx, cy, 150, -125),
    summary: 'Recurring positioning theme across product pages, launches, and hiring.',
    signal: 'Category narrative',
    tier: 0,
    revealedBy: [],
    expandable: false,
  })

  segments.forEach((name, index) => {
    const angle = -70 + (index * 140) / Math.max(1, segments.length - 1 || 1)
    const pos = polar(cx, cy, 150, segments.length === 1 ? -90 : angle)
    const id = `segment-${index}`
    nodes.push({
      id,
      label: name,
      kind: 'segment',
      x: pos.x,
      y: pos.y,
      summary: `Buyer or market segment: ${name}.`,
      signal: 'Segment focus',
      tier: 0,
      revealedBy: [],
      expandable: false,
    })
    edge('idea', id, 'TARGETS', 'strong')
  })

  const segmentIdOf = (name: string) => `segment-${segments.indexOf(name)}`

  // shared investors that appear on >= 2 companies become base-tier nodes so the
  // shared-investor structure is visible immediately.
  const investorCompanies = new Map<string, string[]>()
  companies.forEach((company) => {
    company.investors.forEach((inv) => {
      investorCompanies.set(inv, [...(investorCompanies.get(inv) ?? []), company.id])
    })
  })
  const sharedInvestors = [...investorCompanies.entries()].filter(([, list]) => list.length >= 2).map(([inv]) => inv)
  const investorNodeId = (inv: string) => `investor-${slugify(inv)}`

  sharedInvestors.forEach((inv, index) => {
    const pos = polar(cx, cy, 250, 40 + index * 55)
    nodes.push({
      id: investorNodeId(inv),
      label: inv,
      kind: 'investor',
      x: pos.x,
      y: pos.y,
      summary: `Backs multiple companies in this space — a shared-investor cluster.`,
      signal: 'Capital cluster',
      tier: 0,
      revealedBy: [],
      expandable: true,
    })
  })

  // companies on a ring around the idea
  const companyCount = companies.length
  companies.forEach((company, index) => {
    const angle = -150 + (index * 300) / Math.max(1, companyCount - 1)
    const pos = polar(cx, cy, 285, angle)
    nodes.push({
      id: company.id,
      label: company.name,
      kind: 'company',
      x: pos.x,
      y: pos.y,
      summary: company.summary,
      signal: company.signal,
      url: company.url,
      tier: 0,
      revealedBy: [],
      expandable: true,
      metric: formatUsd(company.raiseUsd),
    })
    edge(company.id, segmentIdOf(company.segment), 'COMPETES_IN', 'strong')

    // company -> shared investor edges (base tier)
    company.investors.forEach((inv) => {
      if (sharedInvestors.includes(inv)) edge(company.id, investorNodeId(inv), 'FUNDED_BY', 'medium')
    })

    // --- tier 1 expansions revealed by this company ---
    // founders
    company.founders.forEach((founder, fIndex) => {
      const fid = `${company.id}-founder-${fIndex}`
      nodes.push({
        id: fid,
        label: founder,
        kind: 'founder',
        x: pos.x,
        y: pos.y,
        summary: `Founder of ${company.name}. Expand to trace prior-company lineage.`,
        signal: 'Founder lineage',
        tier: 1,
        revealedBy: [company.id],
        expandable: true,
      })
      edge(company.id, fid, 'FOUNDED_BY', 'strong')

      // tier 2: founder lineage (ex-employer)
      const exEmployer = pick(EX_EMPLOYERS, checksum(founder))
      const exId = `${fid}-ex`
      nodes.push({
        id: exId,
        label: exEmployer,
        kind: 'company',
        x: pos.x,
        y: pos.y,
        summary: `${founder} previously worked at ${exEmployer} — talent lineage signal.`,
        signal: 'Prior employer',
        tier: 2,
        revealedBy: [fid],
        expandable: false,
      })
      edge(fid, exId, 'WORKED_AT', 'weak')
    })

    // moat node
    const moatId = `${company.id}-moat`
    nodes.push({
      id: moatId,
      label: company.moat,
      kind: 'moat',
      x: pos.x,
      y: pos.y,
      summary: `${company.name}'s defensibility: ${company.moat} (${company.moatScore}/100). Expand for components.`,
      signal: `Moat ${company.moatScore}/100`,
      tier: 1,
      revealedBy: [company.id],
      expandable: true,
      metric: `${company.moatScore}`,
    })
    edge(company.id, moatId, 'DEFENDS_WITH', company.moatScore > 75 ? 'strong' : 'medium')

    // tier 2: moat components
    ;['Data', 'Distribution', 'Relationships'].forEach((component, cIndex) => {
      const compId = `${moatId}-c${cIndex}`
      nodes.push({
        id: compId,
        label: `${component}`,
        kind: 'moat',
        x: pos.x,
        y: pos.y,
        summary: `${component} advantage compounding ${company.name}'s ${company.moat.toLowerCase()}.`,
        signal: 'Moat component',
        tier: 2,
        revealedBy: [moatId],
        expandable: false,
      })
      edge(moatId, compId, 'COMPOSED_OF', 'weak')
    })

    // features
    company.features.slice(0, 2).forEach((feature, ftIndex) => {
      const featId = `${company.id}-feat-${ftIndex}`
      nodes.push({
        id: featId,
        label: feature,
        kind: 'feature',
        x: pos.x,
        y: pos.y,
        summary: `${company.name} ships ${feature}. Shared features become table stakes.`,
        signal: 'Product surface',
        tier: 1,
        revealedBy: [company.id],
        expandable: false,
      })
      edge(company.id, featId, 'HAS_FEATURE', 'weak')
    })

    // company-specific (non-shared) investors revealed on expand
    company.investors
      .filter((inv) => !sharedInvestors.includes(inv))
      .forEach((inv) => {
        const invId = `${company.id}-inv-${slugify(inv)}`
        nodes.push({
          id: invId,
          label: inv,
          kind: 'investor',
          x: pos.x,
          y: pos.y,
          summary: `${inv} backs ${company.name}.`,
          signal: 'Cap table',
          tier: 1,
          revealedBy: [company.id],
          expandable: false,
        })
        edge(company.id, invId, 'FUNDED_BY', 'weak')
      })
  })

  // competitive edges between companies in the same segment
  companies.forEach((a, i) => {
    companies.slice(i + 1).forEach((b) => {
      if (a.segment === b.segment) edge(a.id, b.id, 'COMPETES_WITH', 'medium')
    })
  })

  // sources + opportunities (base tier)
  const sources = [
    { title: `${concept} launches`, url: `https://news.ycombinator.com`, signal: 'Launch archive' },
    { title: `${segment} hiring`, url: `https://${slugify(segment)}-jobs.example`, signal: 'Hiring taxonomy' },
    { title: `${concept} funding`, url: `https://${slugify(concept)}-funding.example`, signal: 'Investor pattern' },
  ]
  const sourcePos = polar(cx, cy, 250, 150)
  nodes.push({
    id: 'source-0',
    label: 'Evidence cluster',
    kind: 'source',
    x: sourcePos.x,
    y: sourcePos.y,
    summary: 'Source-backed launches, hiring, and funding pages behind every claim.',
    signal: 'Provenance',
    tier: 0,
    revealedBy: [],
    expandable: false,
  })
  edge('source-0', 'company-0', 'MENTIONS', 'weak')

  vertical.opportunities.slice(0, 2).forEach((opp, index) => {
    const pos = polar(cx, cy, 175, 95 + index * 40)
    const id = `opportunity-${index}`
    nodes.push({
      id,
      label: opp.title,
      kind: 'opportunity',
      x: pos.x,
      y: pos.y,
      summary: opp.reason,
      signal: 'White space',
      tier: 0,
      revealedBy: [],
      expandable: false,
    })
    edge('idea', id, 'COULD_WIN', 'medium')
  })

  // --- industry stats for the spreadsheet + Neo ---
  const raises = companies.map((c) => c.raiseUsd).sort((a, b) => a - b)
  const totalRaised = raises.reduce((sum, v) => sum + v, 0)
  const median = raises[Math.floor(raises.length / 2)] ?? 0
  const stageCounts = new Map<Stage, number>()
  companies.forEach((c) => stageCounts.set(c.stage, (stageCounts.get(c.stage) ?? 0) + 1))
  const topStage = [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Seed'
  const segmentRaise = new Map<string, number>()
  companies.forEach((c) => segmentRaise.set(c.segment, (segmentRaise.get(c.segment) ?? 0) + c.raiseUsd))
  const hottestSegment = [...segmentRaise.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? segment
  const mostBacked = [...companies].sort((a, b) => b.raiseUsd - a.raiseUsd)[0]?.name ?? ''
  const avgMoat = Math.round(companies.reduce((sum, c) => sum + c.moatScore, 0) / companies.length)

  const industry: IndustryStats = {
    companyCount: companies.length,
    totalRaisedUsd: totalRaised,
    medianRaiseUsd: median,
    topStage,
    hottestSegment,
    mostBacked,
    avgMoat,
    whitespace: vertical.whitespace,
  }

  return {
    title: `${concept} competitive graph`,
    subtitle: `${segment} · ${companies.length} companies · ${formatUsd(totalRaised)} raised · session ${scanNumber}`,
    concept,
    segment,
    companies,
    nodes,
    edges,
    industry,
    insights: [
      { label: 'Companies', value: String(companies.length), detail: 'Mapped by relevance and graph proximity.' },
      { label: 'Total raised', value: formatUsd(totalRaised), detail: 'Capital concentrated in this landscape.' },
      { label: 'Avg moat', value: `${avgMoat}`, detail: 'Mean defensibility score across players.' },
      { label: 'White space', value: '2', detail: 'Relationship gaps worth validating first.' },
    ],
    movers: [
      { name: mostBacked, type: 'Best funded', activity: `Leads the space with ${formatUsd(raises[raises.length - 1] ?? 0)} raised.`, signal: 'Capital concentration' },
      { name: [...companies].sort((a, b) => b.momentum - a.momentum)[0]?.name ?? '', type: 'Hottest momentum', activity: 'Fastest hiring and launch cadence in the graph.', signal: 'Momentum signal' },
      { name: companies[0]?.founders[0] ?? '', type: 'Founder signal', activity: `Operator lineage traces back to top incumbents.`, signal: 'Founder lineage' },
      { name: sharedInvestors[0] ?? INVESTORS[0], type: 'Investor', activity: 'Repeat backer across multiple players — shared-investor path.', signal: 'Shared-investor path' },
    ],
    opportunities: vertical.opportunities,
    sources,
    generatedAt: new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(new Date()),
  }
}

export const buildMarketGraph = (
  rawPrompt: string,
  mode: ScanMode,
  depth: ScanDepth,
  scanNumber: number,
): MarketGraph => {
  const prompt = rawPrompt.trim() || DEFAULT_PROMPT
  const seed = checksum(`${prompt}:${mode}:${depth}:${scanNumber}`)
  const vertical = matchVertical(prompt) ?? syntheticVertical(prompt, seed, depth === 'deep' ? 6 : 4)
  return buildFromVertical(vertical, mode, scanNumber)
}
