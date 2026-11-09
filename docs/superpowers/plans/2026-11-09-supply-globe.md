# Aluminum Supply Globe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web app showing US imports and exports of aluminum mill products on a globe, by partner country and month, refreshed monthly from the Census trade API.

**Architecture:** A Node pipeline (fetch → transform → validate) writes compact JSON into `public/data/`, which is committed. A Vite + TypeScript app loads that JSON; pure functions in `src/data` turn flows plus a selection into what the map and panel render. No server, no database.

**Tech Stack:** Node 20+, npm, TypeScript, Vite, Vitest, tsx, MapLibre GL JS 5+, deck.gl 9.1+ (`@deck.gl/mapbox` `MapboxOverlay`, `ArcLayer`), `world-atlas` + `topojson-client` for the basemap, `@playwright/test`, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-09-supply-globe-design.md`

## Global Constraints

- Data range: January 2015 to the latest published month (or the earliest month the API serves, if later).
- Tracked HS headings: 7606, 7604, 7601, 7608, 7607. Nothing else.
- Missing quantity is `null`, never `0`, in data files and in every calculation.
- Quantities are metric tonnes (kg ÷ 1000). Rows whose unit is not kilograms are excluded from tonnage and reported.
- No backend, no database, no accounts. No external tile server: the basemap is drawn from bundled `world-atlas` country shapes.
- The Census API key is optional, read from the `CENSUS_API_KEY` environment variable, never committed.
- Defaults: product plate/sheet, direction imports, measure tonnes, latest month, trailing 12 months.
- Vite `base` is `'./'` so the build works under a GitHub Pages project path.
- No model or assistant identifiers in code, comments, or commit messages.

## Review Focus

1. **Census aggregate rows.** The API returns totals and region groupings (for example "TOTAL FOR ALL COUNTRIES", "EUROPEAN UNION") alongside countries. Expected: they are dropped, so nothing is double counted. Test in Task 3.
2. **Latest month not yet published.** The API returns an empty response for a month Census has not released. Expected: the range ends at the last month with data; an empty month *before* that still fails. Test in Task 2.
3. **Value with zero or missing quantity.** Expected: price per tonne is `null`, never `Infinity` or `NaN`; year-over-year against a zero prior period is `null`. Test in Task 5.
4. **Trailing 12 months near the start of the data.** Expected: fewer than 12 months available yields `null` and an empty state, not a partial sum labelled as 12 months. Test in Task 5.
5. **A partner country with no coordinates.** A new or obscure Census country code appears in flows. Expected: the pipeline fails validation naming the code. Test in Task 4.

---

## File Structure

```
shared/types.ts              types used by pipeline and app
pipeline/census.ts           API URL building and response parsing
pipeline/fetch.ts            fetch a range of months to raw files
pipeline/product-groups.json 10-digit code → product group
pipeline/country-reference.json  Census code → name, ISO2, lat, lon
pipeline/transform.ts        raw rows → Flow[]
pipeline/validate.ts         problems in new output vs previous
pipeline/run.ts              orchestrates; atomic replace of public/data
pipeline/fixtures/           saved real API responses
public/data/                 flows.json, countries.json, meta.json, tariff-events.json
src/data/load.ts             fetch and parse the data files
src/data/query.ts            pure functions over flows
src/state.ts                 selection store
src/map/globe.ts             MapLibre globe + deck.gl arcs
src/ui/controls.ts           control bar
src/ui/panel.ts              overview and country panel
src/ui/chart.ts              SVG line chart
src/main.ts                  wiring
tests/                       unit tests mirror the paths above
e2e/globe.spec.ts            browser test
.github/workflows/refresh.yml, deploy.yml
```

---

### Task 1: Scaffold and shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `shared/types.ts`, `src/main.ts`
- Test: `tests/smoke.test.ts`

**Interfaces — Produces** (`shared/types.ts`):

```ts
export type Direction = 'imports' | 'exports';
export type ProductGroup = 'plate_sheet' | 'bar_rod_profiles' | 'unwrought' | 'tube' | 'foil';
export interface Flow {
  month: string;            // 'YYYY-MM'
  dir: Direction;
  group: ProductGroup;
  cty: string;              // Census 4-digit country code
  tonnes: number | null;
  value: number;            // USD
  duty: number | null;      // USD; null for exports
}
export interface Country { code: string; name: string; iso2: string; lat: number; lon: number }
export interface Meta { latestMonth: string; fetchedAt: string; source: string }
export interface TariffEvent { date: string; label: string; url: string }
export type Measure = 'tonnes' | 'value' | 'price';
export interface Selection {
  product: ProductGroup | 'all';
  direction: Direction | 'both';
  measure: Measure;
  month: string;
  window: 'month' | 't12';
  country: string | null;
}
```

- [ ] **Step 1:** Create the npm project with the Tech Stack dependencies. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`), `e2e` (`playwright test`), `pipeline` (`tsx pipeline/run.ts`). `.gitignore`: `node_modules`, `dist`, `pipeline/raw`, `test-results`.
- [ ] **Step 2:** Write `shared/types.ts` as above. `index.html` has `<div id="controls">`, `<div id="map">`, `<aside id="panel">`.
- [ ] **Step 3:** `tests/smoke.test.ts` imports the types and asserts `1 + 1 === 2`. Run `npm test` and `npm run build`. Expected: both pass.
- [ ] **Step 4:** Commit: `chore: scaffold project and shared types`.

---

### Task 2: Census API client and fetch

**Prerequisite:** `api.census.gov` reachable. If blocked, request network access for that host before starting.

**Files:**
- Create: `pipeline/census.ts`, `pipeline/fetch.ts`, `pipeline/fixtures/*.json`, `docs/census-api-notes.md`
- Test: `tests/pipeline/census.test.ts`

**Interfaces — Produces:**

```ts
export interface RawRow {
  month: string; dir: Direction; ctyCode: string; ctyName: string;
  commodity: string;        // 10-digit code
  description: string;
  qtyKg: number | null;     // null when unit is not kg or quantity absent
  unit: string;
  value: number;
  duty: number | null;
}
export function buildUrl(dir: Direction, heading: string, month: string, apiKey?: string): string;
export function parseResponse(dir: Direction, month: string, body: string | null): RawRow[]; // null/empty body → []
export async function fetchRange(opts: {
  start: string; headings: string[]; outDir: string; apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ months: string[]; latestMonth: string }>;
```

- [ ] **Step 1: Probe the API and record findings.** Query one month for heading 7606, imports and exports, at 10-digit level. Starting point to verify, not assume: endpoints `https://api.census.gov/data/timeseries/intltrade/{imports|exports}/hs`; imports variables `CTY_CODE, CTY_NAME, I_COMMODITY, I_COMMODITY_SDESC, CON_QY1_MO, UNIT_QY1, CON_VAL_MO, CAL_DUT_MO` with `COMM_LVL=HS10`; exports variables `CTY_CODE, CTY_NAME, E_COMMODITY, E_COMMODITY_SDESC, QTY_1_MO, UNIT_QY1, ALL_VAL_MO`. Use imports *for consumption* (`CON_*`) so value and duty share a basis. Write to `docs/census-api-notes.md`: the confirmed variable names, the earliest available month, how an unpublished month responds, how aggregate country rows are coded, and every 10-digit code under the five headings with its description. This resolves spec open items 1 and 2.
- [ ] **Step 2:** Save real responses as fixtures: `imports-7606-<month>.json`, `exports-7606-<month>.json`, and the response for an unpublished future month.
- [ ] **Step 3: Write failing tests.**
  - `buildUrl` includes the heading wildcard, month, `COMM_LVL=HS10`, and `key=` only when a key is given.
  - `parseResponse` on the imports fixture returns rows with 10-digit `commodity`, numeric `value`, and `qtyKg` equal to the fixture's quantity for a known row.
  - A row whose unit is not `KG` has `qtyKg === null`.
  - `parseResponse(…, null)` and the unpublished-month fixture return `[]`.
  - `fetchRange` with a stub `fetchImpl` returning data for 2015-01…2015-03 and empty for 2015-04: `latestMonth === '2015-03'`.
  - `fetchRange` with data for 2015-01, empty 2015-02, data for 2015-03: rejects with an error naming `2015-02`.
  - `fetchRange` when `fetchImpl` returns HTTP 500: rejects.
- [ ] **Step 4:** Run `npm test -- census`. Expected: FAIL (module missing).
- [ ] **Step 5:** Implement `census.ts` and `fetch.ts`. `fetchRange` walks months forward from `start`, one request per heading and direction, writes each raw body to `outDir/<dir>-<heading>-<month>.json`, retries a failed request three times with backoff, and stops at the first month where every heading is empty.
- [ ] **Step 6:** Run `npm test -- census`. Expected: PASS.
- [ ] **Step 7:** Commit: `feat: Census trade API client and range fetch`.

---

### Task 3: Product groups and transform

**Files:**
- Create: `pipeline/product-groups.json`, `pipeline/transform.ts`
- Test: `tests/pipeline/transform.test.ts`

**Interfaces:**
- Consumes: `RawRow` (Task 2), `Flow`, `ProductGroup` (Task 1).
- Produces:

```ts
export type GroupMap = Record<string, ProductGroup>;   // 10-digit code → group
export function isCountryRow(ctyCode: string): boolean;
export function transform(rows: RawRow[], groups: GroupMap):
  { flows: Flow[]; unmapped: string[]; nonKg: { commodity: string; unit: string }[] };
```

- [ ] **Step 1:** Write `product-groups.json` from the code list in `docs/census-api-notes.md`, covering every import and export code under the five headings. If the notes show 7606 codes with clean thickness breaks, decide plate versus sheet here: either keep `plate_sheet`, or split into `plate` and `sheet` — in which case update `ProductGroup`, the spec's product table, and the controls list in Task 7 in this same commit, and record the thickness boundary in the notes.
- [ ] **Step 2: Write failing tests.**
  - Two rows, same month/direction/country, different codes in one group, 1500 kg + 500 kg, values 10 + 5 → one `Flow` with `tonnes === 2`, `value === 15`.
  - A group where one row has `qtyKg: null` and another 1000 kg → `tonnes === 1`, and the code is listed in `nonKg`. A group where *all* rows have `qtyKg: null` → `tonnes === null`.
  - Export rows produce `duty === null`; import rows sum duty.
  - A code not in the map appears in `unmapped` and contributes to no flow.
  - Aggregate rows from the fixture (totals and region groupings, as documented in the notes) are dropped: `isCountryRow` is false for them, and the sum of `value` over output flows equals the fixture's country rows only.
  - Output is sorted by month, dir, group, cty (stable diffs).
- [ ] **Step 3:** Run `npm test -- transform`. Expected: FAIL.
- [ ] **Step 4:** Implement `transform.ts`.
- [ ] **Step 5:** Run `npm test -- transform`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: product group mapping and transform`.

---

### Task 4: Validation, pipeline run, and first real data

**Files:**
- Create: `pipeline/validate.ts`, `pipeline/run.ts`, `pipeline/country-reference.json`, `public/data/tariff-events.json`, `public/data/{flows,countries,meta}.json`
- Test: `tests/pipeline/validate.test.ts`

**Interfaces:**
- Consumes: `fetchRange`, `parseResponse` (Task 2); `transform` (Task 3).
- Produces:

```ts
export interface Problem { kind: 'unmapped_code' | 'missing_country' | 'revision' | 'empty'; detail: string }
export function validate(next: { flows: Flow[]; unmapped: string[]; countries: Country[] },
                         prev: Flow[] | null): Problem[];
```

- [ ] **Step 1:** Build `country-reference.json`: every Census country code seen in the notes' probe, with name, ISO2, and a representative latitude/longitude (country centroid; capital for countries whose centroid falls in the sea). Source the ISO mapping from the Census Schedule C country list.
- [ ] **Step 2:** Write `tariff-events.json`: the Section 232 aluminum actions from March 2018 onward (initial 10%, country exemptions and quota deals, the 2025 increases). Each entry needs a `date`, a label under 40 characters, and a `url` to the Federal Register or proclamation. Include only events whose date and source you have confirmed.
- [ ] **Step 3: Write failing tests.**
  - `unmapped: ['7606123099']` → one `unmapped_code` problem naming the code.
  - A flow with `cty: '9999'` absent from `countries` → `missing_country` naming `9999`.
  - `flows: []` → `empty`.
  - Previous total for (2024-05, imports, plate_sheet) is $10M; next is $16M → `revision`. Next is $14M → no problem. Thresholds: flag when `next/prev > 1.5` or `< 0.67`, only where `prev ≥ $1M`.
  - A month present in `next` but not `prev` is never a `revision`.
  - `prev: null` (first run) yields no `revision` problems.
- [ ] **Step 4:** Run `npm test -- validate`. Expected: FAIL.
- [ ] **Step 5:** Implement `validate.ts`, then `run.ts`: fetch to `pipeline/raw/`, parse, transform, build `countries.json` (only countries present in flows) and `meta.json`, validate against the existing `public/data/flows.json`, and only if there are no problems write to a temp directory and rename files into `public/data/`. On problems: print each and exit 1, leaving `public/data/` untouched. A `--start YYYY-MM` flag overrides the default `2015-01`.
- [ ] **Step 6:** Run `npm test -- validate`. Expected: PASS.
- [ ] **Step 7:** Run `npm run pipeline`. Expected: exit 0 and the three data files written. If `flows.json` exceeds 5 MB, change `run.ts` to write `flows-<group>.json` per group and note that for Task 5's loader (spec open item 3).
- [ ] **Step 8: Reconcile.** For plate/sheet imports over one full calendar year, compare total tonnes and value against USITC DataWeb or the Census published figure for HS 7606 imports for consumption. Expected: within 0.5%. Record the figures and source in `docs/census-api-notes.md`. If they differ more, stop and find out why before continuing.
- [ ] **Step 9:** Commit: `feat: pipeline validation, run script, and initial data`.

---

### Task 5: Data loading and query functions

**Files:**
- Create: `src/data/load.ts`, `src/data/query.ts`
- Test: `tests/data/query.test.ts`

**Interfaces:**
- Consumes: types (Task 1); data files (Task 4).
- Produces:

```ts
// load.ts
export interface Dataset { flows: Flow[]; countries: Map<string, Country>; meta: Meta; events: TariffEvent[]; months: string[] }
export async function loadDataset(base?: string): Promise<Dataset>;   // throws Error naming the file that failed

// query.ts — all pure
export const US: [number, number] = [-98.5, 39.8];                    // [lon, lat]
export interface Totals { tonnes: number | null; value: number; duty: number | null }
export function windowMonths(months: string[], month: string, window: 'month' | 't12'): string[] | null;
export function totalsByCountry(ds: Dataset, sel: Selection): Map<string, Record<Direction, Totals>>;
export function measureOf(t: Totals, measure: Measure): number | null;
export interface Ranked { cty: string; value: number | null; share: number | null }
export function rankings(ds: Dataset, sel: Selection): Ranked[];
export function concentration(ranked: Ranked[]): number | null;       // top-3 share, 0..1
export interface Arc { cty: string; dir: Direction; from: [number, number]; to: [number, number]; value: number }
export function arcs(ds: Dataset, sel: Selection): Arc[];
export function timeSeries(ds: Dataset, sel: Selection, cty?: string): { month: string; value: number | null }[];
export function productMix(ds: Dataset, sel: Selection, cty: string): { group: ProductGroup; value: number | null }[];
export function yoyChange(ds: Dataset, sel: Selection, cty?: string): number | null;
export function dutyRate(ds: Dataset, sel: Selection, cty?: string): number | null;
```

Rules the signatures do not determine:
- Price = value ÷ tonnes, computed only over flows whose `tonnes` is non-null and summed tonnes > 0; otherwise `null`. Price is `null` when `sel.direction === 'both'`.
- With direction `both`, `rankings` uses imports + exports per country; `arcs` returns one arc per country per direction.
- `share` and `concentration` are `null` when `measure === 'price'`.
- `rankings` sorts descending with `null` values last.
- `arcs` omits countries whose measure is `null` or `0`. Imports run country → `US`; exports `US` → country.
- `timeSeries` returns one point per month in `ds.months`, each computed with the selection's window ending at that month.
- `yoyChange` compares the window ending at `sel.month` with the window ending 12 months earlier: `(now − then) / then`.
- `dutyRate` = duty ÷ value over import flows only, regardless of `sel.direction`.

- [ ] **Step 1: Write failing tests** on a small hand-built `Dataset` (three countries, 26 months, two groups):
  - `windowMonths(months, m, 't12')` returns 12 months ending at `m`; returns `null` when `m` is within the first 11 months; `'month'` returns `[m]`.
  - `rankings` for tonnes: correct order and shares summing to 1; a country with `tonnes: null` is last with `share: null`.
  - `concentration` with four countries at 40/30/20/10 → `0.9`; with `measure: 'price'` → `null`.
  - Price: value 3000, tonnes 2 → `1500`; value 3000, tonnes `null` → `null`; value 3000, tonnes `0` → `null`; direction `both` → `null`.
  - `product: 'all'` sums both groups.
  - `arcs` for imports: `from` is the country's `[lon, lat]`, `to` is `US`; exports reversed; `both` yields two arcs for a country trading both ways; zero-value countries omitted.
  - `timeSeries` with `t12` has `null` for the first 11 months.
  - `yoyChange`: 120 now vs 100 then → `0.2`; then = 0 → `null`; prior window unavailable → `null`.
  - `dutyRate`: duty 250 on value 1000 → `0.25`; value 0 → `null`; unaffected by export flows.
  - `loadDataset` with a stubbed `fetch` returning 404 for `flows.json` rejects with a message containing `flows.json`.
- [ ] **Step 2:** Run `npm test -- query`. Expected: FAIL.
- [ ] **Step 3:** Implement `load.ts` and `query.ts`.
- [ ] **Step 4:** Run `npm test -- query`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: data loading and query functions`.

---

### Task 6: State and globe

**Files:**
- Create: `src/state.ts`, `src/map/globe.ts`; Modify: `src/main.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `Selection`, `Arc`, `Country` (Tasks 1, 5).
- Produces:

```ts
// state.ts
export function createStore(initial: Selection): {
  get(): Selection;
  set(patch: Partial<Selection>): void;        // notifies only if something changed
  subscribe(fn: (s: Selection) => void): () => void;
};
export function defaultSelection(latestMonth: string): Selection;
// globe.ts
export function createGlobe(el: HTMLElement, opts: {
  onHover(cty: string | null): void;
  onSelect(cty: string | null): void;
}): { setArcs(arcs: Arc[], format: (a: Arc) => string): void; setSelected(cty: string | null): void };
```

- [ ] **Step 1: Write failing tests** for the store: `defaultSelection('2025-08')` equals the Global Constraints defaults with `month: '2025-08'`, `country: null`; `set` merges and notifies once; a no-op `set` does not notify; unsubscribe stops notifications.
- [ ] **Step 2:** Run `npm test -- state`. Expected: FAIL. Implement `state.ts`. Run again. Expected: PASS.
- [ ] **Step 3:** Implement `globe.ts`. MapLibre map with `projection: { type: 'globe' }`, centered on `US`, zoom ≈ 1.6, and a style built inline from a `world-atlas` `countries-110m` GeoJSON source (fill + outline layers, no tiles, no glyphs). Arcs via `MapboxOverlay({ interleaved: true })` with an `ArcLayer`: width scaled by `sqrt(value / max)` to 1–12 px, imports and exports in two distinguishable colors, great-circle arcs, pickable. Hover shows a tooltip from `format`; clicking an arc selects its country; clicking empty globe selects `null`. After each `setArcs`, set `el.dataset.arcCount` to the number of arcs (the browser test reads this).
- [ ] **Step 4:** Wire a minimal `main.ts`: load the dataset, create the store and globe, subscribe so the globe gets `arcs(ds, sel)`. On load failure, replace the page body with the error message.
- [ ] **Step 5: Verify visually.** Run `npm run dev`, screenshot the page with headless Chromium. Expected: a globe facing North America with arcs converging on the US, thickest from the largest sources in `rankings`. If arcs do not render in interleaved globe mode with the installed versions, fall back to `interleaved: false` and re-verify.
- [ ] **Step 6:** Commit: `feat: selection store and globe with flow arcs`.

---

### Task 7: Controls, panel, and charts

**Files:**
- Create: `src/ui/controls.ts`, `src/ui/panel.ts`, `src/ui/chart.ts`, `src/ui/format.ts`, `src/style.css`; Modify: `src/main.ts`
- Test: `tests/ui/format.test.ts`, `tests/ui/chart.test.ts`

**Interfaces:**
- Consumes: store (Task 6); `Dataset` and query functions (Task 5).
- Produces:

```ts
export function formatMeasure(v: number | null, measure: Measure): string;   // null → 'no data'
export function formatShare(v: number | null): string;                       // 0.123 → '12.3%'; null → '—'
export function lineChart(points: { month: string; value: number | null }[],
                          opts: { width: number; height: number; events?: TariffEvent[]; current?: string }): SVGSVGElement;
export function mountControls(el: HTMLElement, store: Store, ds: Dataset): void;
export function mountPanel(el: HTMLElement, store: Store, ds: Dataset): void;
```

- [ ] **Step 1: Write failing tests.**
  - `formatMeasure(1234.5, 'tonnes') === '1,235 t'`; `(1_250_000, 'value') === '$1.25M'`; `(2875.4, 'price') === '$2,875/t'`; `(null, …) === 'no data'`.
  - `lineChart` breaks the line at `null` points (two separate path segments for values on either side of a gap), draws one marker element per event inside the month range and none outside it, and returns an SVG with no path when every value is `null`.
- [ ] **Step 2:** Run `npm test -- ui`. Expected: FAIL. Implement `format.ts` and `chart.ts`. Run again. Expected: PASS.
- [ ] **Step 3:** Implement `controls.ts` with the five controls from the spec's table. Each control has a stable `data-testid` (`product`, `direction`, `measure`, `month`, `window`, `play`). The month slider's minimum is the 12th month when the window is `t12`. Play advances one month every 600 ms and stops at the latest month. Selecting measure `price` while direction is `both` switches direction to `imports`.
- [ ] **Step 4:** Implement `panel.ts`.
  - Overview (`country === null`): ranked list (name, value, share; clicking a row selects the country), top-3 concentration, total-over-time `lineChart` with tariff events, and a footer with `meta.latestMonth` and `meta.source`.
  - Country: a back control, name, selected-measure history, price-per-tonne history, product mix, year-over-year change, and effective duty rate labelled "imports".
  - A selection with no flows shows "No trade recorded for this selection."
  - The panel root has `data-testid="panel"`; the top-ranked row has `data-testid="rank-1"`.
- [ ] **Step 5:** Finish `main.ts` wiring and `style.css`: map fills the viewport, controls along the top, panel on the right (below the map under 800 px wide). Light and dark via `prefers-color-scheme`.
- [ ] **Step 6: Verify.** `npm run build` passes. Screenshot overview and country modes. Expected: the top-ranked country matches the thickest arc; switching to price per tonne changes values to `$/t`.
- [ ] **Step 7:** Commit: `feat: controls, side panel, and charts`.

---

### Task 8: Browser test

**Files:**
- Create: `playwright.config.ts`, `e2e/globe.spec.ts`

- [ ] **Step 1:** `playwright.config.ts`: `webServer` runs `npm run build && npx vite preview --port 4173`; Chromium only; launch args `--use-gl=swiftshader --enable-unsafe-swiftshader`; `executablePath` taken from `process.env.PW_CHROMIUM_PATH` when set; `trace: 'off'`.
- [ ] **Step 2:** Write `e2e/globe.spec.ts`:
  - The page loads and `#map[data-arc-count]` is a number greater than 0.
  - Record the text of `rank-1` and the arc count; change `product` to unwrought; expect the `rank-1` value text or the arc count to differ.
  - Click `rank-1`; expect the panel to show that country's name and a duty rate.
  - With the route for `**/data/flows.json` aborted, the page shows an error containing `flows.json`.
- [ ] **Step 3:** Run `npm run e2e` (locally with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` if the installed Playwright version has no matching browser). Expected: PASS.
- [ ] **Step 4:** Commit: `test: browser test for globe, filters, and load failure`.

---

### Task 9: Automation and README

**Files:**
- Create: `.github/workflows/refresh.yml`, `.github/workflows/deploy.yml`, `README.md`

- [ ] **Step 1:** `refresh.yml`: `schedule` on the 10th of each month plus `workflow_dispatch`; `permissions: contents: write`; steps: checkout, Node 20, `npm ci`, `npm run pipeline` with `CENSUS_API_KEY: ${{ secrets.CENSUS_API_KEY }}`, then commit and push `public/data/` only if it changed. A non-zero pipeline exit fails the job with nothing committed.
- [ ] **Step 2:** `deploy.yml`: on push to the default branch and `workflow_dispatch`; runs `npm ci`, `npm test`, `npm run build`, then `actions/upload-pages-artifact` and `actions/deploy-pages` with `pages: write` and `id-token: write`.
- [ ] **Step 3:** `README.md`: what the tool shows; data source and its roughly two-month lag; the product group definitions (and the plate/sheet decision from Task 3); how effective duty rate is calculated; the reconciliation result from Task 4; how to run `dev`, `test`, `e2e`, and `pipeline`; the one-time GitHub setup (enable Pages with source "GitHub Actions", optionally add the `CENSUS_API_KEY` secret).
- [ ] **Step 4:** Run `npm test`, `npm run build`, `npm run e2e`. Expected: all pass.
- [ ] **Step 5:** Commit: `ci: monthly data refresh, Pages deploy, and README`. Push the branch.
