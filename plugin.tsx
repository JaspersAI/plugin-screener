import { definePlugin, defineSource, defineView } from '@jaspers-ai/sdk'
import { z } from 'zod'
import { INSTRUCTIONS } from './instructions'
import { ScreenerView } from './ScreenerView'
import { summarize, type Output, type State } from './screener'

// The first plugin: a stock screener on the jaspers plugin's connection, jaspers/screener. Two sources,
// one view. The schemas here are the contract with the orchestrator — what it may set, and what it
// may read back — so they are the frontend screener's filter dimensions exactly, in raw units.

const Range = z.object({ min: z.number().optional(), max: z.number().optional() })

const Filters = z.object({
  search: z.string().optional(),
  sector: z.string().optional(),
  exchanges: z.array(z.string()).optional(),
  indices: z.array(z.string()).optional(),
  profitable: z.boolean().optional(),
  positive_fcf: z.boolean().optional(),
  pays_dividend: z.boolean().optional(),
  include_stale: z.boolean().optional(),
  tickers: z.array(z.string()).max(1000).optional(),
  ranges: z.record(z.string(), Range).optional(),
})

const Sort = z.object({ key: z.string(), dir: z.enum(['asc', 'desc']) })

/**
 * A qualitative criterion forwarded in plain text. Setting `question` is all the orchestrator does:
 * the view starts the job over its current quantitative filters, polls it, and when it is done pins
 * the table to the matches. The rest of the fields are the view's own bookkeeping.
 */
const Qualitative = z.object({
  question: z.string().min(1),
  focusTerms: z.array(z.string()).optional(),
  form: z.enum(['10-K', '10-Q']).optional(),
  /** True to screen only the tickers pinned by a previous question, refining it, instead of the whole quantitative set. */
  refine: z.boolean().optional(),
  jobId: z.string().optional(),
  status: z.enum(['running', 'done', 'error']).optional(),
  total: z.number().optional(),
  done: z.number().optional(),
  matched: z.number().optional(),
  unclear: z.number().optional(),
  noData: z.number().optional(),
  error: z.string().optional(),
})

const StateSchema = z.object({
  filters: Filters.default({}),
  sort: Sort.default({ key: 'revenue', dir: 'desc' }),
  page: z.number().int().min(0).default(0),
  qualitative: Qualitative.optional(),
})

const OutputSchema = z.object({
  tickers: z.array(z.string()),
  count: z.number(),
  total: z.number(),
  filters: Filters,
  sort: Sort,
  qualitative: z
    .object({
      question: z.string(),
      status: z.string(),
      total: z.number(),
      done: z.number(),
      matched: z.number(),
      unclear: z.number(),
      noData: z.number(),
    })
    .optional(),
})

const screen = defineSource({
  mcp: 'jaspers/screener',
  tool: 'screen_companies',
  description:
    'Screen the ~7,100-company universe by fundamentals, market data, insider activity, and index membership. Filters in raw units.',
})

const stats = defineSource({
  mcp: 'jaspers/screener',
  tool: 'screener_field_stats',
  description: 'Distribution stats for up to 8 numeric screener fields. Use before screening to pick thresholds.',
})

const qualitative = defineSource({
  mcp: 'jaspers/screener',
  tool: 'screen_qualitative',
  description:
    'Start an exhaustive qualitative screen: a reader judges every company matching the filters against one yes/no question, with a quote each. Returns a job_id. When a screener element is on screen, set its state.qualitative.question instead; it runs and pins the matches itself.',
})

const qualitativeStatus = defineSource({
  mcp: 'jaspers/screener',
  tool: 'screen_qualitative_status',
  description: 'Progress and, when done, the matched tickers with quotes, the unclear and no-data lists, for a qualitative screen job.',
})

export default definePlugin({
  id: 'screener',
  sources: { screen, stats, qualitative, 'qualitative-status': qualitativeStatus },
  views: {
    screener: defineView(ScreenerView, {
      title: 'Screener',
      state: StateSchema,
      output: OutputSchema,
      instructions: INSTRUCTIONS,
      renders: [screen],
      summarize: (state: State, output: Output) => summarize(state, output),
    }),
  },
})
