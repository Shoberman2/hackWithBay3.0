import { useMemo, useState } from 'react'
import { ArrowRight, Compass, Lightbulb, Sparkles, Target, Wand2 } from 'lucide-react'
import type { ScanDepth, ScanMode } from '../lib/marketGraph'
import type { OnboardingAnswer } from '../lib/butterbase'

export interface FounderBrief {
  idea: string
  space: string
  buyer: string
  geography: string
  model: string
  mode: ScanMode
  depth: ScanDepth
  onboarding: OnboardingAnswer[]
}

const IDEA_EXAMPLES = [
  'internship platform',
  'AI voice agents for clinics',
  'carbon accounting for SMBs',
  'creator payouts infrastructure',
]

const BUYERS = ['Businesses', 'Consumers', 'Developers', 'Enterprises']
const GEOS = ['US', 'Global', 'Europe', 'Emerging']
const MODELS = ['Marketplace', 'SaaS', 'Infra / API', 'Services']

const deriveSpace = (idea: string) => {
  const cleaned = idea.trim().toLowerCase()
  if (!cleaned) return ''
  const forMatch = idea.match(/\bfor\s+(.+)$/i)
  if (forMatch) return forMatch[1].trim()
  return idea.trim()
}

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="chip-field">
      <span className="chip-field-label">{label}</span>
      <div className="chip-row">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'chip is-active' : 'chip'}
            onClick={() => onChange(value === option ? '' : option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Onboarding({
  onLaunch,
  busy,
}: {
  onLaunch: (brief: FounderBrief) => void
  busy: boolean
}) {
  const [step, setStep] = useState(0)
  const [idea, setIdea] = useState('')
  const [space, setSpace] = useState('')
  const [buyer, setBuyer] = useState('')
  const [geography, setGeography] = useState('')
  const [model, setModel] = useState('')
  const [depth, setDepth] = useState<ScanDepth>('deep')

  const suggestedSpace = useMemo(() => deriveSpace(idea), [idea])
  const effectiveSpace = space.trim() || suggestedSpace

  const canContinue = idea.trim().length > 2
  const canLaunch = canContinue && effectiveSpace.length > 0

  const goToSpace = () => {
    if (!canContinue) return
    if (!space) setSpace(suggestedSpace)
    setStep(1)
  }

  const launch = () => {
    if (!canLaunch) return
    const onboarding: OnboardingAnswer[] = [
      { question: 'What are you building?', answer: idea.trim(), signal: 'Idea anchor for the landscape graph.' },
      { question: 'Which space do you want to investigate?', answer: effectiveSpace, signal: 'Narrows graph discovery and report framing.' },
    ]
    if (buyer) onboarding.push({ question: 'Who is the buyer?', answer: buyer, signal: 'Segments the demand side.' })
    if (geography) onboarding.push({ question: 'Which geography?', answer: geography, signal: 'Bounds the competitive set.' })
    if (model) onboarding.push({ question: 'Business model?', answer: model, signal: 'Shapes moat and pricing analysis.' })

    onLaunch({
      idea: idea.trim(),
      space: effectiveSpace,
      buyer,
      geography,
      model,
      mode: 'idea',
      depth,
      onboarding,
    })
  }

  return (
    <div className="onboarding">
      <div className="onboarding-aura" aria-hidden />
      <div className="onboarding-card">
        <div className="onboarding-progress">
          <span className={step >= 0 ? 'is-active' : ''} />
          <span className={step >= 1 ? 'is-active' : ''} />
        </div>

        {step === 0 ? (
          <div className="onboarding-step">
            <div className="onboarding-kicker">
              <Lightbulb size={15} />
              Step 1 · Your idea
            </div>
            <h2>What are you building?</h2>
            <p className="onboarding-sub">
              Type a rough, one-line idea. Rivalry maps the competitive landscape around it as a live graph — no
              spreadsheet required.
            </p>
            <div className="onboarding-input">
              <Sparkles size={18} />
              <input
                autoFocus
                value={idea}
                placeholder="e.g. internship platform"
                onChange={(event) => setIdea(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') goToSpace()
                }}
              />
            </div>
            <div className="onboarding-examples">
              {IDEA_EXAMPLES.map((example) => (
                <button key={example} type="button" className="ghost-chip" onClick={() => setIdea(example)}>
                  {example}
                </button>
              ))}
            </div>
            <button type="button" className="launch-button" onClick={goToSpace} disabled={!canContinue}>
              Continue
              <ArrowRight size={18} />
            </button>
          </div>
        ) : (
          <div className="onboarding-step">
            <div className="onboarding-kicker">
              <Compass size={15} />
              Step 2 · The space
            </div>
            <h2>Which space should Rivalry investigate?</h2>
            <p className="onboarding-sub">
              Sharpen the market. A tighter space builds a denser, more useful graph.
            </p>
            <div className="onboarding-input">
              <Target size={18} />
              <input
                autoFocus
                value={space}
                placeholder={suggestedSpace || 'e.g. early-career talent'}
                onChange={(event) => setSpace(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') launch()
                }}
              />
            </div>

            <div className="onboarding-chips">
              <ChipRow label="Buyer" options={BUYERS} value={buyer} onChange={setBuyer} />
              <ChipRow label="Geography" options={GEOS} value={geography} onChange={setGeography} />
              <ChipRow label="Model" options={MODELS} value={model} onChange={setModel} />
            </div>

            <div className="onboarding-depth">
              <span className="chip-field-label">Graph depth</span>
              <div className="segmented-control">
                <button
                  type="button"
                  className={depth === 'fast' ? 'is-active' : ''}
                  onClick={() => setDepth('fast')}
                >
                  Fast
                </button>
                <button
                  type="button"
                  className={depth === 'deep' ? 'is-active' : ''}
                  onClick={() => setDepth('deep')}
                >
                  Deep
                </button>
              </div>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="text-button" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="launch-button" onClick={launch} disabled={!canLaunch || busy}>
                <Wand2 size={18} />
                {busy ? 'Building graph…' : 'Build the graph'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
