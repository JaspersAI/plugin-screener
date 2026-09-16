import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cellText, COLS, type Company, FIELD_META, filterChips, type Filters, fromDisplay, needsStart, type Output, qualitativeLabel, readJob, readStart, type State, summarize, toDisplay } from './screener.ts'

// The plugin's pure half: what a cell says, what a chip says, and the
// one line the model reads. Everything here runs without React, the SDK, or a connection.

function company(over: Partial<Company>): Company {
  return {
    cik: 1,
    ticker: 'AAA',
    name: 'Alder Systems',
    exchange: 'NASDAQ',
    sic: '7372',
    sic_description: 'Prepackaged software',
    sector: 'Technology',
    fiscal_year: 2024,
    latest_10k_filing_date: '2025-02-14',
    indices: ['SP500'],
    ...over,
  }
}


function state(over: Partial<State>): State {
  return { filters: {}, sort: { key: 'revenue', dir: 'desc' }, page: 0, ...over }
}

function output(over: Partial<Output>): Output {
  return { tickers: [], count: 0, total: 0, filters: {}, sort: { key: 'revenue', dir: 'desc' }, ...over }
}

test('cellText formats each kind, and a missing value is a dash', () => {
  assert.equal(cellText(company({ market_cap: 2.5e9 }), { key: 'market_cap', kind: 'money' }), '$2.50B')
  assert.equal(cellText(company({ market_cap: 12_300_000 }), { key: 'market_cap', kind: 'money' }), '$12.3M')
  assert.equal(cellText(company({ market_cap: null }), { key: 'market_cap', kind: 'money' }), '—')
  assert.equal(cellText(company({ gross_margin: 0.153 }), { key: 'gross_margin', kind: 'pct' }), '15.3%')
  assert.equal(cellText(company({ roe: -0.08 }), { key: 'roe', kind: 'pctSigned' }), '-8.0%')
  assert.equal(cellText(company({ roe: null }), { key: 'roe', kind: 'pctSigned' }), '—')
  assert.equal(cellText(company({ trailing_pe: 12.345 }), { key: 'trailing_pe', kind: 'ratio' }), '12.35')
  assert.equal(cellText(company({ shares_outstanding: 1.23e9 }), { key: 'shares_outstanding', kind: 'shares' }), '1.23B')
  assert.equal(cellText(company({ shares_outstanding: 4.5e6 }), { key: 'shares_outstanding', kind: 'shares' }), '4.5M')
  assert.equal(cellText(company({ shares_outstanding: null }), { key: 'shares_outstanding', kind: 'shares' }), '—')
  assert.equal(cellText(company({ latest_10k_filing_date: '2025-02-14' }), { key: 'latest_10k_filing_date', kind: 'date' }), '2025-02-14')
  assert.equal(cellText(company({ latest_10k_filing_date: null }), { key: 'latest_10k_filing_date', kind: 'date' }), '—')
  assert.equal(cellText(company({ indices: ['SP500', 'NDX'] }), { key: 'indices', kind: 'text' }), 'SP500 NDX')
  assert.equal(cellText(company({ indices: [] }), { key: 'indices', kind: 'text' }), '—')
  assert.equal(cellText(company({ fiscal_year: 2024 }), { key: 'fiscal_year', kind: 'text' }), '2024')
})

test('the columns are the frontend screener\'s, and every range field has a label', () => {
  assert.equal(COLS.length, 29)
  assert.equal(COLS[0]?.label, 'Mkt Cap')
  for (const col of COLS) assert.ok(col.key.length > 0, `${col.label} has a key`)
  assert.equal(FIELD_META['revenue']?.label, 'Revenue')
  assert.equal(FIELD_META['market_cap']?.kind, 'money')
})

test('display units are what the user types, and they round trip', () => {
  assert.equal(toDisplay(0.2, 'pct'), 20)
  assert.equal(fromDisplay(20, 'pct'), 0.2)
  assert.equal(toDisplay(2e9, 'money'), 2000)
  assert.equal(fromDisplay(2000, 'money'), 2e9)
  assert.equal(toDisplay(12.5, 'ratio'), 12.5)
  assert.equal(fromDisplay(12.5, 'ratio'), 12.5)
  for (const raw of [0.153, -0.08, 1.5]) assert.equal(fromDisplay(toDisplay(raw, 'pct'), 'pct'), raw)
  for (const raw of [1e7, 2.5e9, -4e6]) assert.equal(fromDisplay(toDisplay(raw, 'money'), 'money'), raw)
})


test('one chip per active dimension, in display units', () => {
  const filters: Filters = {
    search: 'software',
    sector: 'Technology',
    ranges: { revenue: { min: 1e7 }, market_cap: { max: 2e9 } },
  }
  const chips = filterChips(filters)
  assert.deepEqual(chips.map((c) => c.id), ['search', 'sector', 'range:revenue', 'range:market_cap'])
  assert.deepEqual(chips.map((c) => c.label), ['"software"', 'Technology', 'Revenue ≥ $10M', 'Mkt cap ≤ $2000M'])
})

test('a chip drops its own dimension and nothing else', () => {
  const filters: Filters = {
    search: 'software',
    sector: 'Technology',
    profitable: true,
    ranges: { revenue: { min: 1e7 }, market_cap: { max: 2e9 } },
  }
  const chips = filterChips(filters)
  const withoutSector = chips.find((c) => c.id === 'sector')!.remove(filters)
  assert.deepEqual(withoutSector, {
    search: 'software',
    profitable: true,
    ranges: { revenue: { min: 1e7 }, market_cap: { max: 2e9 } },
  })
  const withoutRevenue = chips.find((c) => c.id === 'range:revenue')!.remove(filters)
  assert.deepEqual(withoutRevenue.ranges, { market_cap: { max: 2e9 } })
  assert.equal(withoutRevenue.sector, 'Technology')
  // The last range takes `ranges` with it, so an empty object never reads as a filter.
  const bare = filterChips({ ranges: { revenue: { min: 1e7 } } })[0]!.remove({ ranges: { revenue: { min: 1e7 } } })
  assert.deepEqual(bare, {})
  // The chips describe the filters they were built from; removing reads them again.
  assert.deepEqual(filters.ranges, { revenue: { min: 1e7 }, market_cap: { max: 2e9 } })
})

test('the summary says what is shown, of how many, and how it is filtered', () => {
  assert.equal(
    summarize(
      state({ filters: { sector: 'Technology', ranges: { market_cap: { max: 2e9 } } } }),
      output({ count: 37, total: 412 }),
    ),
    'Screener: 37 shown of 412, Technology, cap ≤ 2B, sort revenue desc',
  )
  assert.equal(
    summarize(
      state({ filters: { profitable: true, ranges: { revenue_growth_yoy: { min: 0.2 } } }, sort: { key: 'market_cap', dir: 'asc' } }),
      output({ count: 5, total: 5 }),
    ),
    'Screener: 5 shown of 5, 2 more filters, sort market_cap asc',
  )
})


test('a started qualitative job is read from the start reply', () => {
  assert.deepEqual(readStart(JSON.stringify({ job_id: 'j1', total: 42, status: 'running' })), { jobId: 'j1', total: 42 })
  assert.throws(() => readStart(JSON.stringify({ error: 'job limit reached' })), /job limit reached/)
  assert.throws(() => readStart('not json'), /no job id/)
})

test('a job snapshot is read while running, when done, and when it failed', () => {
  const running = readJob(JSON.stringify({ status: 'running', total: 42, progress: { done: 10, matches: 3 } }))
  assert.deepEqual([running.status, running.total, running.done, running.matches], ['running', 42, 10, 3])
  const done = readJob(
    JSON.stringify({
      status: 'done',
      total: 42,
      progress: { done: 42 },
      result: {
        matched_tickers: ['AAA', 'BBB'],
        unclear: ['CCC'],
        no_data: [],
        matches: [{ ticker: 'AAA', quote: 'we sell to the federal government' }, { ticker: 'BBB', quote: null }],
      },
    }),
  )
  assert.deepEqual([done.status, done.matchedTickers, done.unclear, done.noData], ['done', ['AAA', 'BBB'], ['CCC'], []])
  assert.deepEqual(done.quotes, { AAA: 'we sell to the federal government' })
  const failed = readJob(JSON.stringify({ status: 'error', error: 'cancelled' }))
  assert.deepEqual([failed.status, failed.error], ['error', 'cancelled'])
})

test('the question chip says where the job is', () => {
  const q = { question: 'Sells to governments?' }
  assert.equal(qualitativeLabel(q), 'Q: Sells to governments? · starting…')
  assert.equal(qualitativeLabel({ ...q, status: 'running', done: 5, total: 40 }), 'Q: Sells to governments? · reading 5 of 40')
  assert.equal(
    qualitativeLabel({ ...q, status: 'done', matched: 7, unclear: 2, noData: 1 }),
    'Q: Sells to governments? · 7 matched, 2 unclear, 1 no data',
  )
})

test('a question starts its job unless the view already did: a job id, or a failed start with its reason', () => {
  assert.equal(needsStart({ question: 'Profitable companies?' }), true)
  // What a model fills in beside the question does not count as started.
  assert.equal(needsStart({ question: 'Profitable companies?', focusTerms: [], form: '10-K', refine: false, jobId: '', status: 'done', total: 0, done: 0, matched: 0, unclear: 0, noData: 0, error: '' }), true)
  assert.equal(needsStart({ question: 'Profitable companies?', jobId: 'job_1', status: 'running' }), false)
  assert.equal(needsStart({ question: 'Profitable companies?', jobId: 'job_1', status: 'done' }), false)
  assert.equal(needsStart({ question: 'Profitable companies?', status: 'error', error: 'jaspers/sec is connecting' }), false)
  assert.equal(needsStart(undefined), false)
  assert.equal(needsStart({ question: '' }), false)
})
