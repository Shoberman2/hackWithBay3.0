import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Sparkles, Waypoints } from 'lucide-react'
import {
  askGraphQuestion,
  askNeoAnalyst,
  type GraphAnswer,
  type NeoResult,
} from '../lib/butterbase'
import type { Company, IndustryStats } from '../lib/marketGraph'

const SUGGESTED = ['Which competitors share investors?', 'Where is the white space?', 'Who has the founder lineage edge?']

function useTypewriter(text: string, active: boolean) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (!active) {
      setShown(text)
      return
    }
    setShown('')
    let index = 0
    const step = Math.max(1, Math.round(text.length / 90))
    const timer = window.setInterval(() => {
      index += step
      setShown(text.slice(0, index))
      if (index >= text.length) window.clearInterval(timer)
    }, 18)
    return () => window.clearInterval(timer)
  }, [text, active])
  return shown
}

export function NeoAnalyst({
  topic,
  industry,
  companies,
}: {
  topic: string
  industry: IndustryStats
  companies: Company[]
}) {
  const [neo, setNeo] = useState<NeoResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answers, setAnswers] = useState<GraphAnswer[]>([])
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    setAnswers([])
    void askNeoAnalyst(topic, industry, companies).then((result) => {
      if (id !== requestId.current) return
      setNeo(result)
      setLoading(false)
    })
  }, [topic, industry, companies])

  const typed = useTypewriter(neo?.text ?? '', !loading)

  const ask = async (value: string) => {
    const query = value.trim()
    if (!query || asking) return
    setAsking(true)
    setQuestion('')
    const answer = await askGraphQuestion(query, industry, companies)
    setAnswers((prev) => [answer, ...prev].slice(0, 4))
    setAsking(false)
  }

  return (
    <section className="neo-panel">
      <div className="neo-head">
        <div className="neo-avatar" aria-hidden>
          <Waypoints size={18} />
        </div>
        <div>
          <strong>Neo</strong>
          <span>Graph-native market analyst</span>
        </div>
        <span className={`neo-source ${neo?.source === 'gateway' ? 'is-live' : ''}`}>
          {neo?.source === 'gateway' ? 'Butterbase AI Gateway' : 'Local synthesis'}
        </span>
      </div>

      <p className={`neo-body ${loading ? 'is-loading' : ''}`}>
        {loading ? 'Reading the graph…' : typed}
        {!loading && typed.length < (neo?.text.length ?? 0) ? <span className="caret" /> : null}
      </p>

      <div className="neo-ask">
        <div className="neo-input">
          <Sparkles size={15} />
          <input
            value={question}
            placeholder="Ask Neo about the graph…"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void ask(question)
            }}
          />
          <button type="button" onClick={() => void ask(question)} disabled={asking} aria-label="Ask Neo">
            <CornerDownLeft size={15} />
          </button>
        </div>
        <div className="neo-suggested">
          {SUGGESTED.map((item) => (
            <button key={item} type="button" className="ghost-chip small" onClick={() => void ask(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>

      {answers.length > 0 ? (
        <div className="neo-answers">
          {answers.map((answer) => (
            <article key={`${answer.question}-${answer.answer.slice(0, 12)}`} className="neo-answer">
              <div className="neo-answer-q">{answer.question}</div>
              <p>{answer.answer}</p>
              <code>{answer.cypher}</code>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
