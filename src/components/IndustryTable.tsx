import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Table2 } from 'lucide-react'
import { formatUsd, type Company, type Stage } from '../lib/marketGraph'

type SortKey = 'name' | 'segment' | 'stage' | 'raiseUsd' | 'foundedYear' | 'moatScore' | 'momentum'

const STAGE_RANK: Record<Stage, number> = {
  'Pre-seed': 0,
  Seed: 1,
  'Series A': 2,
  'Series B': 3,
  'Series C': 4,
  Public: 5,
}

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; align?: 'left' | 'right' }> = [
  { key: 'name', label: 'Company', numeric: false, align: 'left' },
  { key: 'segment', label: 'Segment', numeric: false, align: 'left' },
  { key: 'stage', label: 'Stage', numeric: true, align: 'left' },
  { key: 'raiseUsd', label: 'Raised', numeric: true, align: 'right' },
  { key: 'foundedYear', label: 'Founded', numeric: true, align: 'right' },
  { key: 'moatScore', label: 'Moat', numeric: true, align: 'left' },
  { key: 'momentum', label: 'Momentum', numeric: true, align: 'left' },
]

const valueFor = (company: Company, key: SortKey): number | string => {
  if (key === 'stage') return STAGE_RANK[company.stage]
  return company[key]
}

export function IndustryTable({
  companies,
  selectedCompanyId,
  onSelectCompany,
}: {
  companies: Company[]
  selectedCompanyId?: string
  onSelectCompany?: (id: string) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('raiseUsd')
  const [descending, setDescending] = useState(true)

  const maxRaise = useMemo(() => Math.max(...companies.map((c) => c.raiseUsd), 1), [companies])

  const sorted = useMemo(() => {
    const rows = [...companies].sort((a, b) => {
      const av = valueFor(a, sortKey)
      const bv = valueFor(b, sortKey)
      if (typeof av === 'string' && typeof bv === 'string') {
        return descending ? bv.localeCompare(av) : av.localeCompare(bv)
      }
      return descending ? Number(bv) - Number(av) : Number(av) - Number(bv)
    })
    return rows
  }, [companies, sortKey, descending])

  // FLIP animation: rows glide to their new position when the sort changes.
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const prevRects = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const refs = rowRefs.current
    refs.forEach((el, id) => {
      const prev = prevRects.current.get(id)
      const next = el.getBoundingClientRect()
      if (prev) {
        const delta = prev.top - next.top
        if (Math.abs(delta) > 1) {
          el.style.transition = 'none'
          el.style.transform = `translateY(${delta}px)`
          requestAnimationFrame(() => {
            el.style.transition = 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1)'
            el.style.transform = ''
          })
        }
      }
      prevRects.current.set(id, next)
    })
  }, [sorted])

  const handleSort = (key: SortKey, numeric: boolean) => {
    if (key === sortKey) {
      setDescending((value) => !value)
      return
    }
    setSortKey(key)
    setDescending(numeric)
  }

  return (
    <div className="industry-table-wrap">
      <div className="table-header">
        <div className="panel-heading">
          <Table2 size={16} />
          <h3>Industry spreadsheet</h3>
        </div>
        <p className="table-caption">
          Modeled in Neo4j · sorted by <strong>{COLUMNS.find((c) => c.key === sortKey)?.label}</strong>{' '}
          {descending ? 'high → low' : 'low → high'}. Click any header to re-sort.
        </p>
      </div>

      <div className="table-scroll">
        <table className="industry-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={`${column.align === 'right' ? 'align-right' : ''} ${
                    sortKey === column.key ? 'is-sorted' : ''
                  }`}
                >
                  <button type="button" onClick={() => handleSort(column.key, column.numeric)}>
                    <span>{column.label}</span>
                    {sortKey === column.key ? (
                      descending ? (
                        <ArrowDown size={13} />
                      ) : (
                        <ArrowUp size={13} />
                      )
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((company, index) => (
              <tr
                key={company.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(company.id, el)
                  else rowRefs.current.delete(company.id)
                }}
                className={selectedCompanyId === company.id ? 'is-selected' : ''}
                onClick={() => onSelectCompany?.(company.id)}
              >
                <td>
                  <div className="cell-company">
                    <span className="rank">{index + 1}</span>
                    <div>
                      <strong>{company.name}</strong>
                      <small>{company.hq}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="segment-pill">{company.segment}</span>
                </td>
                <td>
                  <span className={`stage-pill stage-${STAGE_RANK[company.stage]}`}>{company.stage}</span>
                </td>
                <td className="align-right">
                  <div className="cell-raise">
                    <span className="raise-value">{formatUsd(company.raiseUsd)}</span>
                    <span className="raise-bar" aria-hidden>
                      <span style={{ width: `${(company.raiseUsd / maxRaise) * 100}%` }} />
                    </span>
                  </div>
                </td>
                <td className="align-right muted">{company.foundedYear}</td>
                <td>
                  <div className="meter" title={`Moat ${company.moatScore}/100`}>
                    <span className="meter-fill moat" style={{ width: `${company.moatScore}%` }} />
                    <span className="meter-num">{company.moatScore}</span>
                  </div>
                </td>
                <td>
                  <div className="meter" title={`Momentum ${company.momentum}/100`}>
                    <span className="meter-fill momentum" style={{ width: `${company.momentum}%` }} />
                    <span className="meter-num">{company.momentum}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
