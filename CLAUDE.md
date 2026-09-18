# CLAUDE.md

The `screener` plugin for Jaspers Terminal, written against `@jaspers-ai/sdk`. The app loads it from a folder in `~/Jaspers/plugins/screener` (a clone of this repo, or an installed release) and rebuilds it on save. How plugins work, the SDK, and the app's side are in the terminal repo's CLAUDE.md.

## Commands

Node 24.

- `npm install`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Node's test runner over the `*.test.ts` files, which strips the types itself
- `npm run package` — `build/screener-<version>.zip`, what a release attaches; the Release workflow runs it on a `v*` tag

Style: square, no rounded corners. Colours are the app's theme variables with the light value as fallback (`var(--jaspers-border, #e5e5e5)`, `var(--jaspers-muted-foreground, #737373)`), so a view follows the app's light and dark; a colour of the plugin's own gets its dark value under `@media (prefers-color-scheme: dark)`.

## The plugin

Qualitative criteria are forwarded, not filtered: the orchestrator sets `state.qualitative.question` (plus `focusTerms`, `form`, `refine`), and the view runs `screener/qualitative` over its quantitative filters, polls `screener/qualitative-status` (one long-poll in flight at a time, text results are never cached), shows progress in a chip (`needsStart` decides whether a question still needs its job: only a job id or a failed start with its reason counts, since a model setting the question fills in `status` and `jobId` too), and when the job is done pins `filters.tickers` to the matches and publishes the counts in `output.qualitative`; quotes stay in the view as tooltips. The instructions tell the model to narrow to about 300 companies first and never to poll itself.

### The screener plugin

This repo holds its own connection, `screener/jaspers`: the Jaspers screener MCP (`https://analyst-api.jsprai.com/mcp/open`, streamable HTTP, plain JSON, stateless), `auth: bearer` with the plugin's own secret, `token` ("Jaspers API key"), and `tools` naming the screener's eight (`screen_companies`, `screener_field_stats`, `search_filing_text`, `list_filing_sections`, `fetch_filing_sections`, `list_insider_activity`, `screen_qualitative`, `screen_qualitative_status`) plus `get_guide` and `show_citations`. Until the key is pasted (Settings > Plugins under screener, or the field the app opens) the connection is `needs-secret`. On it, four sources (`screen` is `screen_companies`, `stats` is `screener_field_stats`, `qualitative` is `screen_qualitative` and `qualitative-status` its job's progress) and one view, the Jaspers frontend screener's definition restyled square.

- `screener.ts` is the pure half, tested in `screener.test.ts`: the filter, state, and output shapes, the 29 columns and the 43 fields a range can be set on with their labels and units, `cellText`, `toDisplay` and `fromDisplay` (fractions to %, USD to $M), `filterChips`, and `summarize`.
- `ScreenerView.tsx` runs `screener/screen` with `{ filters: { ...filters, sort }, limit: 200, offset: page * 200 }` and publishes `{ tickers, count, total, filters, sort }`. Changing `filters` or `sort` re-runs the source. The sort rides inside the filters because the server sorts every match and a page cannot.
- `Filters.tsx` is the chips and the dialog (search, sector, indices, the exchanges in the rows on screen, the four toggles, min and max per field in display units), `Table.tsx` the table and its sort headers, `styles.css` the CSS, `instructions.ts` the screener knowledge the orchestrator gets while the view is focused, ported from the backend's screener chat prompt.
- The orchestrator drives it by state: `place_view { view: 'screener/screener', state: { filters: { sector: 'Technology' } } }`, then `set panels/e1/state/filters/ranges/revenue_growth_yoy { min: 0.2 }`, and `get panels/e1/output` for what is on screen. Point the connection's `url` at another server with the same tools and nothing else in the screener changes.
