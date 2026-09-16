import type { ReactElement } from 'react'
import { cellText, COLS, type Col, type Company, type Sort } from './screener'

// The table: the company, then the frontend screener's 29 columns. A header sorts, and sorting is
// the server's job — the sort goes into the panel's state, the state into the source's arguments —
// so a click here is a change of state like any the orchestrator makes.

interface Props {
  /** A verbatim filing quote per ticker from a qualitative screen, shown on hover. */
  quotes?: Record<string, string>
  rows: Company[]
  sort: Sort
  onSort: (key: string) => void
  /** Nothing is drawn as empty while the first run is still out. */
  loading: boolean
}

export function Table({ rows, sort, onSort, loading, quotes }: Props): ReactElement {
  return (
    <div className="sc-table-wrap">
      <table className="sc-table">
        <thead>
          <tr>
            <th className="sc-company">Company</th>
            {COLS.map((col) => (
              <th key={col.key} className="sc-num">
                <button type="button" className="sc-sort" onClick={() => onSort(col.key)} title={`Sort by ${col.label}`}>
                  {col.label}
                  {sort.key === col.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.cik ?? row.ticker ?? index)}>
              <td className="sc-company">
                <span className={quotes?.[row.ticker ?? ''] ? 'sc-ticker sc-quoted' : 'sc-ticker'} title={quotes?.[row.ticker ?? '']}>
                  {row.ticker ?? '—'}
                </span>
                <span className="sc-name" title={row.sic_description ?? undefined}>
                  {row.name}
                </span>
              </td>
              {COLS.map((col) => (
                <td key={col.key} className={`sc-num ${signClass(row, col)}`}>
                  {cellText(row, col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !loading && <p className="sc-empty">No companies match.</p>}
    </div>
  )
}

/** Growth and returns read faster with a sign on them; nothing else is coloured. */
function signClass(row: Company, col: Col): string {
  if (col.kind !== 'pctSigned') return ''
  const value = row[col.key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return ''
  return value > 0 ? 'sc-up' : 'sc-down'
}
