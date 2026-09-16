// The screener's pure half: what a row is, which columns the table has, how a raw value reads, and
// what the panel's state means. Ported from the Jaspers frontend's screener page (lib/screener-api.ts,
// app/screener/page.tsx, components/screener-filter-modal.tsx, lib/sic-sectors.ts) so the terminal's
// view shows the same 29 columns, the same filter dimensions, and the same units. No React and no
// SDK here: it is imported by the view and read by the tests, which run under Node on their own.

/**
 * One company, as the screener source returns it: the declared fields the view names, and whatever
 * else the server sends, since a range can be set on any numeric field.
 */
export interface Company {
  cik: number
  ticker: string | null
  name: string
  exchange: string | null
  sic: string | null
  sic_description: string | null
  sector?: string | null
  fiscal_year: number | null
  latest_10k_filing_date: string | null
  indices: string[] | null
  [field: string]: unknown
}

export interface Range {
  min?: number
  max?: number
}

/** The filter contract, the backend's: raw units, every dimension narrowing except `tickers`. */
export interface Filters {
  search?: string
  sector?: string
  exchanges?: string[]
  indices?: string[]
  profitable?: boolean
  positive_fcf?: boolean
  pays_dividend?: boolean
  include_stale?: boolean
  tickers?: string[]
  ranges?: Record<string, Range>
}

export interface Sort {
  key: string
  dir: 'asc' | 'desc'
}

/** What the panel holds, and so what the orchestrator sets. */
export interface State {
  filters: Filters
  sort: Sort
  page: number
  qualitative?: Qualitative
}

/** What the view publishes: the rows on screen, and the screen they came out of. */
export interface Output {
  tickers: string[]
  count: number
  total: number
  filters: Filters
  sort: Sort
  qualitative?: { question: string; status: string; total: number; done: number; matched: number; unclear: number; noData: number }
}

/** The plain-text criterion the orchestrator forwards, plus what the view learned about its job. */
export interface Qualitative {
  question: string
  focusTerms?: string[]
  form?: '10-K' | '10-Q'
  refine?: boolean
  jobId?: string
  status?: 'running' | 'done' | 'error'
  total?: number
  done?: number
  matched?: number
  unclear?: number
  noData?: number
  error?: string
}

/**
 * Whether a question still needs its job started. The view writes the bookkeeping, but a model setting
 * the question often fills in the rest too (`status: "done"`, `jobId: ""`, `total: 0`), so only what
 * the view itself leaves counts as started: a job id, or a failed start with its reason.
 */
export function needsStart(q: Qualitative | undefined): boolean {
  return Boolean(q?.question) && !q?.jobId && !(q?.status === 'error' && q.error)
}

/** What a started job answers with. */
export function readStart(text: string): { jobId: string; total: number } {
  const value = parseJson(text)
  if (typeof value.error === 'string') throw new Error(value.error)
  if (typeof value.job_id !== 'string') throw new Error('the screen did not start: no job id came back')
  return { jobId: value.job_id, total: Number(value.total ?? 0) }
}

export interface JobSnapshot {
  status: 'running' | 'done' | 'error'
  total: number
  done: number
  matches: number
  matchedTickers: string[]
  unclear: string[]
  noData: string[]
  /** Verbatim quote per ticker, wherever the result keeps them. */
  quotes: Record<string, string>
  error?: string
}

/** A job snapshot, read leniently: the counts while it runs, the lists and quotes once it is done. */
export function readJob(text: string): JobSnapshot {
  const value = parseJson(text)
  if (typeof value.error === 'string' && value.status !== 'done') {
    return { status: 'error', total: 0, done: 0, matches: 0, matchedTickers: [], unclear: [], noData: [], quotes: {}, error: value.error }
  }
  const progress = isRecord(value.progress) ? value.progress : {}
  const result = isRecord(value.result) ? value.result : {}
  const status = value.status === 'done' ? 'done' : value.status === 'error' ? 'error' : 'running'
  const matchedTickers = strings(result.matched_tickers)
  const total = Number(value.total ?? progress.total ?? 0)
  return {
    status,
    total,
    done: Number(progress.done ?? (status === 'done' ? total : 0)),
    matches: Number(progress.matches ?? matchedTickers.length),
    matchedTickers,
    unclear: strings(result.unclear),
    noData: strings(result.no_data),
    quotes: collectQuotes(result),
    error: typeof value.error === 'string' ? value.error : undefined,
  }
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every { ticker, quote } pair anywhere in the result, one level down: the result's shape may grow. */
function collectQuotes(result: Record<string, unknown>): Record<string, string> {
  const quotes: Record<string, string> = {}
  for (const value of Object.values(result)) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (isRecord(entry) && typeof entry.ticker === 'string' && typeof entry.quote === 'string' && entry.quote) {
        quotes[entry.ticker] = entry.quote
      }
    }
  }
  return quotes
}

/** The chip's words for a question, at each stage of its job. */
export function qualitativeLabel(q: Qualitative): string {
  const head = `Q: ${q.question}`
  if (q.status === 'done') return `${head} · ${q.matched ?? 0} matched, ${q.unclear ?? 0} unclear, ${q.noData ?? 0} no data`
  if (q.status === 'error') return `${head} · failed: ${q.error ?? 'unknown error'}`
  if (q.status === 'running') return `${head} · reading ${q.done ?? 0} of ${q.total ?? '?'}`
  return `${head} · starting…`
}

/** The eleven buckets the screener sorts SIC codes into. */
export const SECTORS: readonly string[] = [
  'Technology',
  'Healthcare & Pharma',
  'Finance & Insurance',
  'Real Estate & REITs',
  'Energy & Mining',
  'Manufacturing',
  'Consumer & Retail',
  'Transport & Utilities',
  'Services',
  'SPACs / Blank Checks',
  'Other',
]

export const INDEX_LABELS: Record<string, string> = {
  SP500: 'S&P 500',
  SP400: 'S&P 400',
  SP600: 'S&P 600',
  R1000: 'Russell 1000',
  R2000: 'Russell 2000',
  NDX: 'Nasdaq-100',
  DOW: 'Dow 30',
}

/** The four filters that are on or absent, never false. A subset of the keys of `Filters`. */
export type FlagKey = 'profitable' | 'positive_fcf' | 'pays_dividend' | 'include_stale'

export const FLAGS: { key: FlagKey; label: string }[] = [
  { key: 'profitable', label: 'Profitable (net income > 0)' },
  { key: 'positive_fcf', label: 'Positive free cash flow' },
  { key: 'pays_dividend', label: 'Pays a dividend' },
  { key: 'include_stale', label: 'Include stale / delisted filers' },
]

/** How a column reads. `pctSigned` is a percentage that is coloured by its sign. */
export type FieldKind = 'money' | 'pct' | 'pctSigned' | 'ratio' | 'shares' | 'text' | 'date'

/** The kinds a range can be set on: the ones with a number behind them. */
export type RangeKind = 'money' | 'pct' | 'ratio' | 'shares'

/** What the dialog writes beside a field, so the user knows what the number they type means. */
export const UNIT_LABEL: Record<RangeKind, string> = {
  money: '$M',
  pct: '%',
  ratio: 'x',
  shares: 'shares',
}

export interface Col {
  key: string
  label: string
  kind: FieldKind
}

/** The table, in the frontend's order, after the company column the view draws itself. */
export const COLS: Col[] = [
  { key: 'market_cap', label: 'Mkt Cap', kind: 'money' },
  { key: 'trailing_pe', label: 'P/E', kind: 'ratio' },
  { key: 'revenue', label: 'Revenue', kind: 'money' },
  { key: 'price_to_sales', label: 'P/S', kind: 'ratio' },
  { key: 'revenue_growth_yoy', label: 'Rev Δ YoY', kind: 'pctSigned' },
  { key: 'revenue_cagr_3y', label: 'Rev 3Y CAGR', kind: 'pctSigned' },
  { key: 'gross_margin', label: 'Gross M', kind: 'pct' },
  { key: 'operating_margin', label: 'Op M', kind: 'pct' },
  { key: 'net_margin', label: 'Net M', kind: 'pct' },
  { key: 'net_income', label: 'Net Income', kind: 'money' },
  { key: 'eps_diluted', label: 'EPS', kind: 'ratio' },
  { key: 'roe', label: 'ROE', kind: 'pctSigned' },
  { key: 'roa', label: 'ROA', kind: 'pctSigned' },
  { key: 'free_cash_flow', label: 'FCF', kind: 'money' },
  { key: 'fcf_margin', label: 'FCF M', kind: 'pct' },
  { key: 'debt_to_equity', label: 'D/E', kind: 'ratio' },
  { key: 'current_ratio', label: 'Curr R', kind: 'ratio' },
  { key: 'total_assets', label: 'Assets', kind: 'money' },
  { key: 'cash_and_equivalents', label: 'Cash', kind: 'money' },
  { key: 'total_debt', label: 'Debt', kind: 'money' },
  { key: 'dividends_per_share', label: 'Div/Sh', kind: 'ratio' },
  { key: 'dividend_yield', label: 'Yield', kind: 'pct' },
  { key: 'shares_outstanding', label: 'Shares', kind: 'shares' },
  { key: 'insider_net_buy_value_6m', label: 'Ins Net Buy 6m', kind: 'money' },
  { key: 'insider_buys_6m', label: 'Ins Buyers 6m', kind: 'shares' },
  { key: 'insider_own_pct', label: 'Ins Own %', kind: 'pct' },
  { key: 'indices', label: 'Index', kind: 'text' },
  { key: 'fiscal_year', label: 'FY', kind: 'text' },
  { key: 'latest_10k_filing_date', label: 'Filed', kind: 'date' },
]

/** Every field a range can be set on, with the label the chips and the dialog use. */
export const FIELD_META: Record<string, { label: string; kind: RangeKind }> = {
  revenue: { label: 'Revenue', kind: 'money' },
  revenue_growth_yoy: { label: 'Rev growth YoY', kind: 'pct' },
  revenue_cagr_3y: { label: 'Rev 3Y CAGR', kind: 'pct' },
  gross_margin: { label: 'Gross margin', kind: 'pct' },
  operating_margin: { label: 'Op margin', kind: 'pct' },
  net_margin: { label: 'Net margin', kind: 'pct' },
  fcf_margin: { label: 'FCF margin', kind: 'pct' },
  net_income: { label: 'Net income', kind: 'money' },
  net_income_growth_yoy: { label: 'NI growth YoY', kind: 'pct' },
  eps_diluted: { label: 'EPS', kind: 'ratio' },
  roe: { label: 'ROE', kind: 'pct' },
  roa: { label: 'ROA', kind: 'pct' },
  debt_to_equity: { label: 'D/E', kind: 'ratio' },
  current_ratio: { label: 'Current ratio', kind: 'ratio' },
  interest_coverage: { label: 'Interest cover', kind: 'ratio' },
  total_assets: { label: 'Assets', kind: 'money' },
  cash_and_equivalents: { label: 'Cash', kind: 'money' },
  total_debt: { label: 'Debt', kind: 'money' },
  stockholders_equity: { label: 'Equity', kind: 'money' },
  operating_cash_flow: { label: 'OCF', kind: 'money' },
  free_cash_flow: { label: 'FCF', kind: 'money' },
  capex: { label: 'Capex', kind: 'money' },
  dividends_per_share: { label: 'Div/Sh', kind: 'ratio' },
  payout_ratio: { label: 'Payout', kind: 'pct' },
  buybacks: { label: 'Buybacks', kind: 'money' },
  rnd_expense: { label: 'R&D', kind: 'money' },
  shares_outstanding: { label: 'Shares', kind: 'shares' },
  public_float: { label: 'Float', kind: 'money' },
  price: { label: 'Price', kind: 'ratio' },
  market_cap: { label: 'Mkt cap', kind: 'money' },
  trailing_pe: { label: 'P/E', kind: 'ratio' },
  forward_pe: { label: 'Fwd P/E', kind: 'ratio' },
  dividend_yield: { label: 'Div yield', kind: 'pct' },
  price_to_sales: { label: 'P/S', kind: 'ratio' },
  price_to_book: { label: 'P/B', kind: 'ratio' },
  ev: { label: 'EV', kind: 'money' },
  ev_to_ebitda: { label: 'EV/EBITDA', kind: 'ratio' },
  insider_net_buy_value_6m: { label: 'Insider net buy 6m', kind: 'money' },
  insider_net_buy_value_12m: { label: 'Insider net buy 12m', kind: 'money' },
  insider_net_buy_shares_6m: { label: 'Insider net shares 6m', kind: 'shares' },
  insider_buys_6m: { label: 'Insiders buying 6m', kind: 'shares' },
  insider_sells_6m: { label: 'Insiders selling 6m', kind: 'shares' },
  insider_own_pct: { label: 'Insider own %', kind: 'pct' },
}

/** The dialog's rows, in the order the fields are declared above. */
export const RANGE_FIELDS: { field: string; label: string; kind: RangeKind }[] = Object.entries(FIELD_META).map(
  ([field, meta]) => ({ field, label: meta.label, kind: meta.kind }),
)

// Formatting. A table cell says the number the way a screener does (B, M, K); a chip and the filter
// dialog say it in the unit the user types it in ($M, %), so what is typed and what is shown agree.

function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${a.toFixed(2)}`
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function fmtRatio(v: number | null): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(2)
}

function fmtShares(v: number | null): string {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return v.toFixed(0)
}

/** What one cell says. A value the company never reported is a dash, not a zero. */
export function cellText(row: Company, col: { key: string; kind: FieldKind }): string {
  const value = row[col.key]
  switch (col.kind) {
    case 'money':
      return fmtMoney(asNumber(value))
    case 'pct':
    case 'pctSigned':
      return fmtPct(asNumber(value))
    case 'ratio':
      return fmtRatio(asNumber(value))
    case 'shares':
      return fmtShares(asNumber(value))
    case 'date':
      return typeof value === 'string' ? value : '—'
    default:
      if (Array.isArray(value)) return value.length > 0 ? value.join(' ') : '—'
      return value === null || value === undefined ? '—' : String(value)
  }
}

/** A raw value as the user types it: fractions become percents, dollars become millions. */
export function toDisplay(raw: number, kind: RangeKind): number {
  if (kind === 'pct') return +(raw * 100).toFixed(4)
  if (kind === 'money') return +(raw / 1e6).toFixed(4)
  return raw
}

/** And back, since the server only takes raw units. */
export function fromDisplay(v: number, kind: RangeKind): number {
  if (kind === 'pct') return v / 100
  if (kind === 'money') return v * 1e6
  return v
}

/** A threshold as a chip and the dialog say it: the number the user typed, with its unit. */
export function displayText(raw: number, kind: RangeKind): string {
  const value = trim(toDisplay(raw, kind))
  if (kind === 'money') return `$${value}M`
  if (kind === 'pct') return `${value}%`
  if (kind === 'ratio') return `${value}x`
  return value
}

/** One chip per active filter dimension, and the way to take that dimension back off. */
export interface Chip {
  id: string
  label: string
  remove: (filters: Filters) => Filters
}

export function filterChips(filters: Filters): Chip[] {
  const chips: Chip[] = []
  const drop =
    (key: keyof Filters) =>
    (previous: Filters): Filters => {
      const next = { ...previous }
      delete next[key]
      return next
    }
  if (filters.search) chips.push({ id: 'search', label: `"${filters.search}"`, remove: drop('search') })
  if (filters.sector) chips.push({ id: 'sector', label: filters.sector, remove: drop('sector') })
  if (filters.exchanges?.length) {
    chips.push({ id: 'exchanges', label: filters.exchanges.join(' / '), remove: drop('exchanges') })
  }
  if (filters.indices?.length) {
    const names = filters.indices.map((code) => INDEX_LABELS[code] ?? code).join(' / ')
    chips.push({ id: 'indices', label: `In ${names}`, remove: drop('indices') })
  }
  for (const flag of FLAGS) {
    if (filters[flag.key] === true) {
      chips.push({ id: String(flag.key), label: FLAG_CHIPS[String(flag.key)] ?? flag.label, remove: drop(flag.key) })
    }
  }
  if (filters.tickers?.length) {
    const list = filters.tickers
    chips.push({
      id: 'tickers',
      label: list.length <= 3 ? list.join(', ') : `${list.length} picked tickers`,
      remove: drop('tickers'),
    })
  }
  for (const [field, range] of Object.entries(filters.ranges ?? {})) {
    const meta = FIELD_META[field]
    if (!meta) continue
    const parts: string[] = []
    if (range.min !== undefined && range.min !== null) parts.push(`≥ ${displayText(range.min, meta.kind)}`)
    if (range.max !== undefined && range.max !== null) parts.push(`≤ ${displayText(range.max, meta.kind)}`)
    chips.push({
      id: `range:${field}`,
      label: `${meta.label} ${parts.join(', ')}`,
      remove: (previous) => {
        const ranges = { ...(previous.ranges ?? {}) }
        delete ranges[field]
        const next: Filters = { ...previous }
        // An empty `ranges` would read as a dimension that is set; there is no such thing.
        if (Object.keys(ranges).length === 0) delete next.ranges
        else next.ranges = ranges
        return next
      },
    })
  }
  return chips
}

/** A flag's chip is shorter than its line in the dialog, where it has room to explain itself. */
const FLAG_CHIPS: Record<string, string> = {
  profitable: 'Profitable',
  positive_fcf: 'Positive FCF',
  pays_dividend: 'Pays dividend',
  include_stale: 'Incl. stale filers',
}

/**
 * The one line the model's map carries: what is on screen, out of how many, and the shape of the
 * screen behind it. The two dimensions a request usually turns on get named; the rest are counted.
 */
export function summarize(state: State, output: Output): string {
  const filters = state.filters ?? {}
  const parts = [`Screener: ${output.count} shown of ${output.total}`]
  if (filters.sector) parts.push(filters.sector)
  const cap = filters.ranges?.['market_cap']?.max
  if (cap !== undefined) parts.push(`cap ≤ ${trim(cap / 1e9)}B`)
  const named = (filters.sector ? 1 : 0) + (cap !== undefined ? 1 : 0)
  const rest = filterChips(filters).length - named
  if (rest > 0) parts.push(`${rest} more filter${rest === 1 ? '' : 's'}`)
  const sort = state.sort ?? { key: 'revenue', dir: 'desc' }
  parts.push(`sort ${sort.key} ${sort.dir}`)
  const q = state.qualitative
  if (q) {
    parts.push(
      q.status === 'done'
        ? `qualitative "${q.question}": ${q.matched ?? 0} matched, ${q.unclear ?? 0} unclear`
        : q.status === 'error'
          ? `qualitative "${q.question}" failed`
          : `qualitative "${q.question}" running, ${q.done ?? 0} of ${q.total ?? '?'} read`,
    )
  }
  return parts.join(', ')
}

/** Two decimals at most, and none when there is nothing behind the point. */
function trim(value: number): string {
  return String(+value.toFixed(2))
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
