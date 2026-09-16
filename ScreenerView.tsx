import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useBridge, useData, usePanelState, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import { FilterBar, FilterDialog } from './Filters'
import { Table } from './Table'
import { needsStart, qualitativeLabel, readJob, readStart, type Company, type Filters, type Qualitative, type Sort, type State } from './screener'
import './styles.css'

// The view. Everything it shows comes out of the panel's state: the filters and the sort go into
// the screen source's arguments, so changing either re-runs it. What is on screen is published
// back, which is how the orchestrator reads the table without being told what is in it.

/** One server page. The table scrolls it; Prev and Next ask for the next one. */
const PAGE = 200
const NO_FILTERS: Filters = {}
const DEFAULT_SORT: Sort = { key: 'revenue', dir: 'desc' }

/**
 * The panel's state arrives a round trip after the frame mounts, and the screen is nothing without
 * it: a run with the default filters would ask for the whole universe and publish it as what the
 * user is looking at, for the moment before the real filters land. So the table is a component of
 * its own, mounted once the state is here and handed it as the initial value of every key, which
 * makes its first source run the right one.
 */
export function ScreenerView({ panel }: { panel: PanelRef }): ReactElement {
  const state = useData(`workspaces/${panel.workspaceId}/panels/${panel.id}/state`) as Partial<State> | undefined
  if (state === undefined) {
    return (
      <div className="sc-root">
        <div className="sc-bar">
          <span className="sc-status">Loading…</span>
        </div>
      </div>
    )
  }
  return <Screener panel={panel} initial={state} />
}

function Screener({ panel, initial }: { panel: PanelRef; initial: Partial<State> }): ReactElement {
  const [filters, setFilters] = usePanelState<Filters>(panel, 'filters', initial.filters ?? NO_FILTERS)
  const [sort, setSort] = usePanelState<Sort>(panel, 'sort', initial.sort ?? DEFAULT_SORT)
  const [page, setPage] = usePanelState<number>(panel, 'page', initial.page ?? 0)
  const [qualitative, setQualitative] = usePanelState<Qualitative | undefined>(panel, 'qualitative', initial.qualitative)
  const [dialogOpen, setDialogOpen] = useState(false)
  const bridge = useBridge()
  // The latest filters, for the moment a job finishes and pins the table.
  const latestFilters = useRef(filters)
  latestFilters.current = filters
  // Quotes stay here, not in state: a hundred quotes would be most of the output budget.
  const quotes = useRef<Record<string, string>>({})
  // The connections' statuses, so a question asked while the server is still connecting starts
  // once it is ready instead of failing.
  const connections = useData('connections') as Record<string, { status?: string }> | undefined
  const connectionsKey = JSON.stringify(Object.values(connections ?? {}).map((c) => c.status))

  // A question with no job yet starts one over the quantitative filters (or the pinned tickers, to
  // refine a previous answer). The orchestrator sets the question and nothing else.
  useEffect(() => {
    const q = qualitative
    if (!q || !needsStart(q)) return
    let live = true
    const { tickers, ...quant } = latestFilters.current
    const scope = q.refine && tickers?.length ? { ...quant, tickers } : quant
    void (async () => {
      try {
        const run = await bridge.runSource('screener/qualitative', {
          filters: scope,
          question: q.question,
          focus_terms: q.focusTerms,
          form: q.form,
        })
        if (!live) return
        const started = readStart(run.kind === 'text' ? run.text : '')
        setQualitative({ ...q, jobId: started.jobId, status: 'running', total: started.total, done: 0 })
      } catch (err) {
        if (!live) return
        const text = err instanceof Error ? err.message : String(err)
        // Not ready yet: the question stays as it is and this runs again when a connection changes.
        if (/connection_unavailable/.test(text) && /connecting/.test(text)) return
        setQualitative({ ...q, status: 'error', error: text })
      }
    })()
    return () => {
      live = false
    }
  }, [bridge, qualitative?.question, qualitative?.jobId, qualitative?.status, connectionsKey])

  // A running job is polled until it ends. Each status call waits on the server for up to 20 s, so
  // the loop is one request in flight at a time, never a burst.
  useEffect(() => {
    const q = qualitative
    if (!q?.jobId || q.status !== 'running') return
    let live = true
    void (async () => {
      while (live) {
        let job
        try {
          const run = await bridge.runSource('screener/qualitative-status', { job_id: q.jobId, wait_seconds: 20 })
          if (!live) return
          job = readJob(run.kind === 'text' ? run.text : '')
        } catch (err) {
          if (live) setQualitative({ ...q, status: 'error', error: err instanceof Error ? err.message : String(err) })
          return
        }
        if (job.status === 'running') {
          setQualitative({ ...q, status: 'running', done: job.done, total: job.total || q.total, matched: job.matches })
          continue
        }
        if (job.status === 'done') {
          quotes.current = job.quotes
          setQualitative({
            ...q,
            status: 'done',
            done: job.total || q.total,
            total: job.total || q.total,
            matched: job.matchedTickers.length,
            unclear: job.unclear.length,
            noData: job.noData.length,
          })
          setFilters({ ...latestFilters.current, tickers: job.matchedTickers })
          return
        }
        setQualitative({ ...q, status: 'error', error: job.error ?? 'the screen failed' })
        return
      }
    })()
    return () => {
      live = false
    }
  }, [bridge, qualitative?.jobId, qualitative?.status])

  /** Clearing the question also drops the pin it made. */
  function clearQualitative(): void {
    quotes.current = {}
    setQualitative(undefined)
    const { tickers: _tickers, ...rest } = latestFilters.current
    setFilters(rest)
  }

  // The sort rides inside the filters: the server sorts every match, and a page of one cannot.
  const { data, loading, error, meta } = useData('screener/screen', {
    filters: { ...filters, sort },
    limit: PAGE,
    offset: page * PAGE,
  })

  const rows = (data ?? []) as Company[]
  const total = Number(meta['count'] ?? data?.length ?? 0)
  const tickers = rows.map((row) => row.ticker).filter((ticker): ticker is string => !!ticker)
  usePublish(panel, {
    tickers,
    count: rows.length,
    total,
    filters,
    sort,
    qualitative: qualitative
      ? {
          question: qualitative.question,
          status: qualitative.status ?? 'starting',
          total: qualitative.total ?? 0,
          done: qualitative.done ?? 0,
          matched: qualitative.matched ?? 0,
          unclear: qualitative.unclear ?? 0,
          noData: qualitative.noData ?? 0,
        }
      : undefined,
  })

  const exchanges = useMemo(() => countExchanges((data ?? []) as Company[]), [data])
  const hasNext = (page + 1) * PAGE < total

  /** A new screen starts at its first page, whichever control asked for it. */
  function change(next: Filters): void {
    setFilters(next)
    if (page !== 0) setPage(0)
  }

  function toggleSort(key: string): void {
    setSort(sort.key === key && sort.dir === 'desc' ? { key, dir: 'asc' } : { key, dir: 'desc' })
    if (page !== 0) setPage(0)
  }

  return (
    <div className="sc-root">
      <div className="sc-bar">
        <FilterBar
          filters={filters}
          onChange={change}
          onOpen={() => setDialogOpen(true)}
          qualitative={qualitative ? { label: qualitativeLabel(qualitative), onClear: clearQualitative } : undefined}
        />
        <span className="sc-count">
          {rows.length} shown of {total}
        </span>
      </div>

      <Table rows={rows} sort={sort} onSort={toggleSort} loading={loading && data === undefined} quotes={quotes.current} />

      <div className="sc-bar sc-foot">
        <button type="button" className="sc-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Prev
        </button>
        <button type="button" className="sc-btn" disabled={!hasNext} onClick={() => setPage(page + 1)}>
          Next
        </button>
        <span className="sc-status">Page {page + 1}</span>
        {/* The source's own words, which is how "needs a key. Open Connections." reaches the user. */}
        <span className={error ? 'sc-error' : 'sc-status'} style={{ marginLeft: 'auto' }}>
          {error ?? (loading ? 'Loading…' : '')}
        </span>
      </div>

      {dialogOpen && (
        <FilterDialog
          filters={filters}
          exchanges={exchanges}
          onApply={(next) => {
            change(next)
            setDialogOpen(false)
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  )
}

/** The exchanges in the rows on screen, commonest first, for the dialog's checkboxes. */
function countExchanges(rows: Company[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (typeof row.exchange !== 'string' || !row.exchange) continue
    counts.set(row.exchange, (counts.get(row.exchange) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}
