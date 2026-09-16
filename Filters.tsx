import { useState, type ReactElement } from 'react'
import {
  FLAGS,
  INDEX_LABELS,
  RANGE_FIELDS,
  SECTORS,
  UNIT_LABEL,
  filterChips,
  fromDisplay,
  toDisplay,
  type Filters,
  type Range,
} from './screener'

// What is filtered, and how it is changed by hand: one chip per active dimension with a cross, and
// a dialog over the view for the rest. The dialog edits a draft and writes the whole filters object
// once, on Apply, because the orchestrator writes it the same way — one value, one re-run.

interface BarProps {
  /** The question chip: its words, and what clearing it does. */
  qualitative?: { label: string; onClear: () => void }
  filters: Filters
  onChange: (next: Filters) => void
  onOpen: () => void
}

export function FilterBar({ filters, onChange, onOpen, qualitative }: BarProps): ReactElement {
  const chips = filterChips(filters)
  return (
    <>
      <button type="button" className="sc-btn" onClick={onOpen}>
        Filters
      </button>
      {chips.map((chip) => (
        <span key={chip.id} className="sc-chip">
          {chip.label}
          <button
            type="button"
            className="sc-chip-x"
            aria-label={`Remove ${chip.label}`}
            onClick={() => onChange(chip.remove(filters))}
          >
            ×
          </button>
        </span>
      ))}
      {qualitative && (
        <span className="sc-chip sc-q" title={qualitative.label}>
          <span className="sc-q-text">{qualitative.label}</span>
          <button type="button" className="sc-chip-x" aria-label="Clear the question" onClick={qualitative.onClear}>
            ×
          </button>
        </span>
      )}
    </>
  )
}

interface DialogProps {
  filters: Filters
  /** The exchanges in the rows on screen, and how many of each, so the list is never speculative. */
  exchanges: [string, number][]
  onApply: (next: Filters) => void
  onClose: () => void
}

type RangeDraft = Record<string, { min: string; max: string }>

export function FilterDialog({ filters, exchanges, onApply, onClose }: DialogProps): ReactElement {
  // The dialog is mounted when it opens, so the draft is seeded once, here, rather than in an effect.
  const [search, setSearch] = useState(filters.search ?? '')
  const [sector, setSector] = useState(filters.sector ?? '')
  const [exchangeSel, setExchangeSel] = useState<string[]>(filters.exchanges ?? [])
  const [indexSel, setIndexSel] = useState<string[]>(filters.indices ?? [])
  const [flags, setFlags] = useState<string[]>(FLAGS.filter((f) => filters[f.key] === true).map((f) => f.key))
  const [ranges, setRanges] = useState<RangeDraft>(() => seedRanges(filters))

  function apply(): void {
    const next: Filters = {}
    if (search.trim()) next.search = search.trim()
    if (sector) next.sector = sector
    if (exchangeSel.length > 0) next.exchanges = exchangeSel
    if (indexSel.length > 0) next.indices = indexSel
    for (const flag of FLAGS) if (flags.includes(flag.key)) next[flag.key] = true
    // A ticker pin comes from a screen the orchestrator ran; the dialog does not edit it, so it rides along.
    if (filters.tickers?.length) next.tickers = filters.tickers
    const out: Record<string, Range> = {}
    for (const field of RANGE_FIELDS) {
      const draft = ranges[field.field]
      if (!draft) continue
      const range: Range = {}
      const min = Number.parseFloat(draft.min)
      const max = Number.parseFloat(draft.max)
      if (draft.min !== '' && Number.isFinite(min)) range.min = fromDisplay(min, field.kind)
      if (draft.max !== '' && Number.isFinite(max)) range.max = fromDisplay(max, field.kind)
      if (range.min !== undefined || range.max !== undefined) out[field.field] = range
    }
    if (Object.keys(out).length > 0) next.ranges = out
    onApply(next)
  }

  return (
    <div className="sc-dialog" onMouseDown={onClose}>
      <div className="sc-dialog-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sc-dialog-head">
          <span>Screener filters</span>
          <button type="button" className="sc-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sc-dialog-body">
          <div className="sc-section sc-two">
            <div>
              <label className="sc-label" htmlFor="sc-search">
                Search (ticker / name / industry)
              </label>
              <input
                id="sc-search"
                className="sc-input"
                style={{ width: '100%' }}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='e.g. "software" or NVDA'
              />
            </div>
            <div>
              <label className="sc-label" htmlFor="sc-sector">
                Sector
              </label>
              <select
                id="sc-sector"
                className="sc-input"
                style={{ width: '100%' }}
                value={sector}
                onChange={(event) => setSector(event.target.value)}
              >
                <option value="">All sectors</option>
                {SECTORS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sc-section">
            <span className="sc-label">Index membership (any of)</span>
            <div className="sc-checks">
              {Object.entries(INDEX_LABELS).map(([code, label]) => (
                <Check
                  key={code}
                  label={label}
                  checked={indexSel.includes(code)}
                  onChange={(on) => setIndexSel(toggle(indexSel, code, on))}
                />
              ))}
            </div>
          </div>

          <div className="sc-section sc-two">
            <div>
              <span className="sc-label">Exchange</span>
              <div className="sc-checks" style={{ flexDirection: 'column' }}>
                {exchanges.length === 0 && <span className="sc-status">None in these rows</span>}
                {exchanges.map(([name, count]) => (
                  <Check
                    key={name}
                    label={`${name} (${count})`}
                    checked={exchangeSel.includes(name)}
                    onChange={(on) => setExchangeSel(toggle(exchangeSel, name, on))}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="sc-label">Toggles</span>
              <div className="sc-checks" style={{ flexDirection: 'column' }}>
                {FLAGS.map((flag) => (
                  <Check
                    key={String(flag.key)}
                    label={flag.label}
                    checked={flags.includes(flag.key)}
                    onChange={(on) => setFlags(toggle(flags, flag.key, on))}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="sc-section">
            <span className="sc-label">Ranges</span>
            <div className="sc-ranges">
              {RANGE_FIELDS.map((field) => (
                <div key={field.field} className="sc-range">
                  <span className="sc-range-label" title={field.label}>
                    {field.label} <span className="sc-unit">({UNIT_LABEL[field.kind]})</span>
                  </span>
                  {(['min', 'max'] as const).map((side) => (
                    <input
                      key={side}
                      className="sc-input"
                      type="number"
                      placeholder={side}
                      aria-label={`${field.label} ${side}`}
                      value={ranges[field.field]?.[side] ?? ''}
                      onChange={(event) =>
                        setRanges((previous) => ({
                          ...previous,
                          [field.field]: { ...(previous[field.field] ?? { min: '', max: '' }), [side]: event.target.value },
                        }))
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sc-dialog-foot">
          <button type="button" className="sc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sc-btn" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}): ReactElement {
  return (
    <label className="sc-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** Every range field gets a row, filled in from the filters in the unit the user types. */
function seedRanges(filters: Filters): RangeDraft {
  const draft: RangeDraft = {}
  for (const field of RANGE_FIELDS) {
    const range = filters.ranges?.[field.field]
    draft[field.field] = {
      min: range?.min === undefined ? '' : String(toDisplay(range.min, field.kind)),
      max: range?.max === undefined ? '' : String(toDisplay(range.max, field.kind)),
    }
  }
  return draft
}

function toggle(list: string[], value: string, on: boolean): string[] {
  return on ? [...list, value] : list.filter((item) => item !== value)
}
