# Aluminum Demand Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Customers tab showing aluminum-using manufacturers by US county with user-defined sites and distance rings, plus an import-share card on the Supply tab.

**Architecture:** A second, yearly Node pipeline (`pipeline/demand/`) pulls County Business Patterns, Census geoinfo points and ASM product shipments into committed JSON under `public/data/`. The app gains a tab switcher; the Customers tab lazily loads its data and draws an SVG Albers USA map with `d3-geo`. Pure functions in `src/demand/` do grouping lookups, distances, rings, territories and classes; UI modules only render.

**Tech Stack:** existing (TypeScript, Vite, Vitest, Playwright, deck.gl for the globe) plus `d3-geo` and `us-atlas` (county and state TopoJSON, already-installed `topojson-client`).

**Spec:** `docs/superpowers/specs/2026-11-10-demand-map-design.md`

## Global Constraints

- Industry groups, NAICS codes and subtractions exactly as the spec's "Customer industries" table.
- Ring radii: 150, 300, 500 miles, great-circle. Earth radius 3958.8 mi.
- Default site: `Detroit, MI` at the Census geoinfo point for Detroit city, MI.
- Withheld employment is `null` with a flag, never 0, never estimated. A county–industry absent from CBP means 0 establishments and 0 employees.
- Domestic data: ASM `PRODVAL` ($1,000s → store dollars), US level, 2012–2016; product mapping exactly as the spec table.
- Import share = imports ÷ (domestic + imports − exports), dollars, calendar year; `null` when the denominator ≤ 0 or any term is missing.
- Yearly imports and exports for the share come from the trade API (HS10, all-countries total rows) summed with stage 1's `pipeline/product-groups.json`, so 2012–2014 work although stage 1 flows start in 2015. A year the trade API does not serve is `null`.
- Colors: white ground, grays/black for counties, sites and rings; red stays reserved for imports.
- Census key from `CENSUS_API_KEY`, required, never committed; same validate-then-replace rule as stage 1.
- No model or assistant identifiers in code, comments or commit messages.

## Rulings carried in from planning

- **County shapes:** `www2.census.gov` and TIGERweb are blocked from the build environment, so shapes come from `us-atlas@3` `counties-10m.json` (spec fallback). Connecticut: the 8 old county shapes are merged and shaded as one area (FIPS `09`) whose values are the sum of the 9 planning regions; hover says "Connecticut (state total; Census now reports planning regions)". Distances still use the 9 planning-region points.
- **Points and places:** from the Census API `/data/<year>/geoinfo` (`INTPTLAT`, `INTPTLON`) for `county:*` and `place:*`, same key, instead of the gazetteer file.
- **CBP 2023 employment:** noise-infused with flags G/H/J; only flags `D` (withheld) and `N` (not available) mean withheld. Query with `EMPSZES=001` (all establishment sizes).

## Review Focus

1. **A county with establishments but withheld employment, inside a site ring.** Expected: ring employment totals say "at least N, M counties withheld" rather than presenting a partial sum as complete. Test in Task 6.
2. **Two sites at the same point, or a county equidistant from two.** Expected: territory goes to the site added first; totals don't double count. Test in Task 6.
3. **Site list in the URL that is malformed, duplicated, or outside the US.** Expected: bad entries are dropped, duplicates (same name and point) collapse, valid non-US points are allowed but their rings may cover no counties. Test in Task 7.
4. **Place search with accents, case and partial words** ("san jose", "Mayagüez", "st louis"). Expected: matches ignore case and accents; "st" matches "Saint" and "St."; at most 8 suggestions. Test in Task 7.
5. **Selecting no industry groups.** Expected: empty-state message, map all light gray, totals 0, no NaN. Test in Task 6.

## File Structure

```
shared/demand.ts                 types shared by pipeline and app
pipeline/industries.json         groups → add / subtract NAICS codes, labels
pipeline/demand/census.ts        CBP, geoinfo and ASM URL builders and parsers
pipeline/demand/group.ts         per-county grouping with subtraction
pipeline/demand/places.ts        place name cleaning for search
pipeline/demand/validate.ts      demand validation
pipeline/demand/run.ts           orchestration; atomic replace
pipeline/demand/fixtures/        saved real API responses
public/data/demand.json, places.json, domestic.json
src/tabs.ts                      tab switcher, tab in URL
src/demand/load.ts               lazy loading of demand files
src/demand/query.ts              distances, rings, territories, classes, tops
src/demand/sites.ts              site list: URL/storage parse, search
src/demand/usmap.ts              SVG Albers map: counties, legend, sites, rings
src/demand/panel.ts              Customers panel
src/demand/controls.ts           group picker, measure toggle, add-site box
src/data/domestic.ts             import share
src/ui/importshare.ts            import-share card on the Supply panel
.github/workflows/refresh-demand.yml
```

---

### Task 1: Types, industry groups and grouping

**Files:**
- Create: `shared/demand.ts`, `pipeline/industries.json`, `pipeline/demand/group.ts`
- Test: `tests/pipeline/demand-group.test.ts`

**Interfaces — Produces:**

```ts
// shared/demand.ts
export type IndustryGroup = 'aero' | 'auto' | 'trucks' | 'machinery' | 'semis' | 'electrical' | 'hvac' | 'shops';
export const INDUSTRY_GROUPS: IndustryGroup[]; // order above = display order
export interface GroupDef { id: IndustryGroup; label: string; add: string[]; subtract: string[] }
export interface CountyDemand {
  fips: string;            // 5-digit state+county
  name: string;
  lat: number; lon: number;
  estab: Record<IndustryGroup, number>;
  emp: Record<IndustryGroup, number | null>; // null = withheld
}
export interface DemandData { year: number; groups: GroupDef[]; counties: CountyDemand[] }
export type Place = [name: string, state: string, lat: number, lon: number];
export interface DomesticProduct {
  codes: string[];                              // ASM product codes summed
  domestic: Record<string, number | null>;      // year → US mill shipments, dollars
  imports: Record<string, number | null>;       // year → imports for consumption, dollars
  exports: Record<string, number | null>;       // year → total exports, dollars
  note: string | null;
}
export interface DomesticData { years: number[]; products: Partial<Record<ProductGroup, DomesticProduct>> }
export interface Site { name: string; lat: number; lon: number }
// pipeline/demand/group.ts
export interface Cell { estab: number; emp: number | null }
export function groupCounty(cells: Map<string, Cell>, def: GroupDef): Cell;
```

- [ ] **Step 1:** Write `pipeline/industries.json` from the spec table. Labels: `Aerospace, defense & space`, `Automotive`, `Trucks, trailers & rail`, `Machinery & equipment`, `Semiconductors & electronics`, `Electrical equipment`, `HVAC & refrigeration`, `Machine shops & fabricators`. Subtractions: auto `3362` minus `336212`,`336214`; machinery `333` minus `333242`,`333415`.
- [ ] **Step 2: Write failing tests.**
  - `groupCounty` sums `add` codes: 3364 {estab 5, emp 100} + 3366 {2, 30} → {7, 130}.
  - Subtraction: 333 {10, 500} − 333242 {2, 50} − 333415 {1, 20} → {7, 430}.
  - A missing code counts as {0, 0}.
  - Any withheld term (emp null) in add or subtract → emp null; estab still resolves.
  - Every NAICS code in `industries.json` appears in exactly one group's `add`, or is subtracted from a group whose `add` contains a prefix of it and added in another group (no double counting): assert by walking the JSON.
  - Negative result after subtraction (noise) clamps to 0.
- [ ] **Step 3:** Run `npm test -- demand-group`. Expected: FAIL (module missing).
- [ ] **Step 4:** Implement `groupCounty`.
- [ ] **Step 5:** Run `npm test -- demand-group`. Expected: PASS.
- [ ] **Step 6:** Commit `feat: industry groups and per-county grouping`.

---

### Task 2: Census clients for CBP, geoinfo and ASM

**Files:**
- Create: `pipeline/demand/census.ts`, `pipeline/demand/places.ts`, `pipeline/demand/fixtures/*.json`
- Test: `tests/pipeline/demand-census.test.ts`

**Interfaces:**
- Consumes: `Cell` (Task 1), `getBody`-style retry: extract stage 1's `getBody` from `pipeline/fetch.ts` into an exported `fetchText(url, opts)` and reuse it (keep stage 1 tests green).
- Produces:

```ts
export function cbpUrl(year: number, naics: string, apiKey?: string): string; // county:*, EMPSZES=001, get NAME,ESTAB,EMP,EMP_N_F
export function parseCbp(body: string): Map<string /*fips*/, Cell & { name: string }>;
export function geoinfoUrl(year: number, level: 'county' | 'place', apiKey?: string): string;
export function parsePoints(body: string, level: 'county' | 'place'): { id: string; name: string; lat: number; lon: number }[];
export function asmUrl(year: number, apiKey?: string): string;   // US, all PSCODEs, get PSCODE,PRODVAL
export function parseAsm(body: string): Map<string /*PSCODE*/, number /*dollars*/>;
export function latestCbpYear(probe: (year: number) => Promise<boolean>, from: number): Promise<number>;
// places.ts
export function cleanPlace(name: string): { name: string; state: string }; // "Abbeville city, Alabama" → {name:"Abbeville", state:"AL"}
```

- [ ] **Step 1:** Save real responses as fixtures: CBP 2023 NAICS 3364 for Michigan; CBP 2023 NAICS 333 for Connecticut; geoinfo 2023 counties for state 09; geoinfo 2023 places for state 26; ASM 2016 filtered to PSCODEs starting `33131`. Strip the key from anything saved.
- [ ] **Step 2: Write failing tests.**
  - `parseCbp` on the Michigan fixture: Macomb `26099` → {estab 10, emp 844}.
  - Flags: a row with `EMP_N_F` `D` or `N` → emp `null`; `G`/`H`/`J` keep the number.
  - `parsePoints` county fixture: `09110` Capitol Planning Region lat 41.81697.
  - `cleanPlace`: "Abbeville city, Alabama" → Abbeville/AL; "Abanda CDP, Alabama" → Abanda/AL; "Nashville-Davidson metropolitan government (balance), Tennessee" → "Nashville-Davidson"/TN; "Mayagüez municipio, Puerto Rico" → Mayagüez/PR. Rule: drop a trailing parenthetical, then trailing words that are all lowercase or `CDP`.
  - `parseAsm` 2016 fixture: `3313151` → 1,693,573,000.
  - `latestCbpYear` with a probe true only for ≤ 2023, starting 2026 → 2023; probe never true → rejects.
  - Each URL contains the key only when given.
- [ ] **Step 3:** Run `npm test -- demand-census`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `npm test -- demand-census` and `npm test`. Expected: PASS, stage 1 tests unchanged.
- [ ] **Step 6:** Commit `feat: Census clients for business patterns, points and shipments`.

---

### Task 3: Demand validation, run script, first real data, workflow

**Files:**
- Create: `pipeline/demand/validate.ts`, `pipeline/demand/run.ts`, `public/data/demand.json`, `public/data/places.json`, `public/data/domestic.json`, `.github/workflows/refresh-demand.yml`
- Modify: `package.json` (script `pipeline:demand`: `tsx pipeline/demand/run.ts`)
- Test: `tests/pipeline/demand-validate.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: the three data files in the `shared/demand.ts` shapes; `validateDemand(d: DemandData, domestic: DomesticData, missingPoints: string[]): string[]`.

- [ ] **Step 1: Write failing tests.**
  - County count 3,099 → one problem; 3,222 → none; 3,301 → one.
  - A CBP county with no geoinfo point (`missingPoints: ['99999']`) → problem naming `99999`.
  - A group with zero establishments nationally → problem naming the group.
  - A mapped domestic product missing any of 2012–2016 → problem naming product and year.
  - A product with domestic values but `imports` null for 2016 → problem naming it (2016 must be complete; earlier years may be null).
- [ ] **Step 2:** Run `npm test -- demand-validate`. Expected: FAIL.
- [ ] **Step 3:** Implement `validateDemand`, then `run.ts`. For each year 2012–2016, heading and direction, fetch the trade API's all-countries row (`CTY_CODE=-`, `time=from YYYY-01 to YYYY-12`, stage 1 `buildUrl` with a country filter added as an optional parameter) and sum values by stage 1 product group into `imports`/`exports`. Then: find the latest CBP year; fetch every NAICS code in `industries.json` (add and subtract lists, deduplicated); fetch geoinfo counties and places for that year; group per county; fetch ASM 2012–2016 and build `domestic.json` from the spec mapping (sum codes per product; `note` text for foil: "Excludes backed foil, which is in the import figures"; for plate: "Domestic plate is 0.25 in. (6.35 mm) and over; imports split at 6.3 mm"); write `places.json` as `Place[]` sorted by name; validate; write to a temp dir and rename into `public/data/` only if there are no problems.
- [ ] **Step 4:** Run `npm test -- demand-validate`. Expected: PASS.
- [ ] **Step 5:** Run `npm run pipeline:demand`. Expected: exit 0; `demand.json` year 2023 with 3,100–3,300 counties; `places.json` about 32,000 entries; `domestic.json` 6 products × 5 years. Spot check: Macomb County MI aerospace estab ≥ 10.
- [ ] **Step 6:** Write `refresh-demand.yml`: `schedule` `23 10 15 5 *` plus `workflow_dispatch`; same steps as `refresh.yml` but `npm run pipeline:demand`, committing `public/data/demand.json places.json domestic.json` only if changed.
- [ ] **Step 7:** Commit `feat: demand pipeline and initial customer data`.

---

### Task 4: Tabs and lazy loading

**Files:**
- Create: `src/tabs.ts`, `src/demand/load.ts`
- Modify: `index.html` (tab bar above controls; a `#customers` container), `src/main.ts`, `src/style.css`
- Test: `tests/demand/load.test.ts`, `tests/tabs.test.ts`

**Interfaces — Produces:**

```ts
export type Tab = 'supply' | 'customers';
export function readTab(search: string): Tab;           // ?tab=customers, default supply
export function mountTabs(el: HTMLElement, onChange: (t: Tab) => void): void; // updates URL with history.replaceState
export interface DemandBundle { demand: DemandData; domestic: DomesticData }
export function loadDemand(base?: string): Promise<DemandBundle>;            // memoised; error names the file
export function loadPlaces(base?: string): Promise<Place[]>;                 // memoised, separate
export function loadDomestic(base?: string): Promise<DomesticData>;          // memoised; used by the Supply card
```

- [ ] **Step 1: Write failing tests.** `readTab('?tab=customers')` → customers; `''` and `'?tab=nope'` → supply. `loadDemand` with a stub fetch failing `demand.json` rejects naming `demand.json`; called twice issues one fetch per file.
- [ ] **Step 2:** Run `npm test -- load tabs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Switching to Customers the first time calls `loadDemand`; while loading show "Loading customer data…"; on failure show the error inside `#customers` only. The globe container is hidden, not destroyed, when Customers is active.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: supply/customers tabs with lazy data loading`.

---

### Task 5: Import share and the Supply card

**Files:**
- Create: `src/data/domestic.ts`, `src/ui/importshare.ts`
- Modify: `src/ui/panel.ts` (append the card)
- Test: `tests/data/domestic.test.ts`

**Interfaces:**
- Consumes: `DomesticData`, `loadDomestic`.
- Produces:

```ts
export function importShare(dom: DomesticData, product: ProductGroup, year: number): number | null;
export function importShareSeries(dom: DomesticData, product: ProductGroup): { year: number; share: number | null }[];
```

- [ ] **Step 1: Write failing tests.** Imports $30, exports $10, domestic $80 → 30/100 = 0.3. Denominator 0 or negative → null. Domestic, imports or exports missing for the year → null. Product without domestic entry → null. Series returns `dom.years` in order.
- [ ] **Step 2:** Run `npm test -- domestic`. Expected: FAIL.
- [ ] **Step 3:** Implement; the card shows "US supply, 2016: imports X%", a 5-bar chart (reuse `src/ui/chart.ts` if it fits, else a small SVG), the product's `note`, and the line "By value, calendar years. US mill data ends in 2016." For product `all`, a table of each product's 2016 share. Hidden with "Domestic data could not be loaded" if `loadDomestic` fails.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: import share of US supply`.

---

### Task 6: Demand queries

**Files:**
- Create: `src/demand/query.ts`
- Test: `tests/demand/query.test.ts`

**Interfaces — Produces:**

```ts
export type DemandMeasure = 'emp' | 'estab';
export const RINGS_MI = [150, 300, 500] as const;
export function miles(a: [lon: number, lat: number], b: [lon: number, lat: number]): number;
export interface Amount { value: number; withheldCounties: number }   // value excludes withheld cells
export function countyValue(c: CountyDemand, groups: IndustryGroup[], m: DemandMeasure): number | null; // null if any selected group's emp withheld
export function total(cs: CountyDemand[], groups: IndustryGroup[], m: DemandMeasure): Amount;
export function byGroup(cs: CountyDemand[], groups: IndustryGroup[], m: DemandMeasure): Record<IndustryGroup, Amount>;
export function within(cs: CountyDemand[], site: Site, radiusMi: number): CountyDemand[];
export function territories(cs: CountyDemand[], sites: Site[]): CountyDemand[][]; // index-aligned with sites
export function topCounties(cs: CountyDemand[], groups: IndustryGroup[], m: DemandMeasure, n: number): { county: CountyDemand; value: number | null }[];
export function classes(values: number[], k: number): number[];   // k-1 quantile breaks over values > 0
```

- [ ] **Step 1: Write failing tests.**
  - `miles(Detroit [-83.0458, 42.3314], Chicago [-87.6298, 41.8781])` ≈ 237 ± 2.
  - `within`: county at 149.9 mi in, 150.1 mi out.
  - `territories` with two identical sites: every county in index 0's list; index 1 empty. Equidistant county → first site.
  - Review Focus 1: a ring containing one withheld county → `total(...,'emp')` reports `withheldCounties: 1` and a value excluding it; establishments unaffected.
  - Review Focus 5: `groups: []` → total {0, 0}, `countyValue` 0, `classes([], 5)` → `[]`, no NaN anywhere.
  - `classes` of 1..100 with k=5 → 4 ascending breaks; all-equal values → one break, no duplicates.
  - `topCounties` sorts by value desc, nulls last, ties by FIPS.
- [ ] **Step 2:** Run `npm test -- demand/query`. Expected: FAIL.
- [ ] **Step 3:** Implement (haversine, R = 3958.8).
- [ ] **Step 4:** Run `npm test -- demand/query`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: demand distance, ring, territory and class queries`.

---

### Task 7: Sites and place search

**Files:**
- Create: `src/demand/sites.ts`
- Test: `tests/demand/sites.test.ts`

**Interfaces — Produces:**

```ts
export const DEFAULT_SITES: Site[];                       // [Detroit, MI]
export function encodeSites(sites: Site[]): string;       // "Detroit, MI@42.3314,-83.0458;Los Angeles, CA@34.05,-118.24" (URL-encoded by caller)
export function decodeSites(s: string | null): Site[] | null; // null when absent; drops malformed entries
export function loadSites(search: string, storage: Pick<Storage, 'getItem'> | null): Site[]; // URL, then storage key 'metals-map.sites', then DEFAULT_SITES
export function saveSites(sites: Site[], storage: Pick<Storage, 'setItem'> | null): void;    // storage errors swallowed
export function searchPlaces(places: Place[], query: string, limit?: number): Place[];         // default limit 8
```

- [ ] **Step 1: Write failing tests.**
  - Round trip encode/decode of two sites, including a comma and a non-ASCII name.
  - Review Focus 3: entries with lat outside ±90, lon outside ±180, non-numbers, or empty name are dropped; exact duplicates collapse; a valid point in Canada is kept.
  - `loadSites`: URL wins over storage; storage that throws → defaults; nothing anywhere → `DEFAULT_SITES`.
  - Review Focus 4: `searchPlaces` with "san jose" finds "San Jose, CA"; "mayaguez" finds "Mayagüez, PR"; "st louis" finds "St. Louis, MO"; "saint louis" finds it too; prefix matches rank before infix; result length ≤ 8; empty query → `[]`.
- [ ] **Step 2:** Run `npm test -- sites`. Expected: FAIL.
- [ ] **Step 3:** Implement. Normalize with NFD + strip combining marks + lowercase; treat `st`, `st.` and `saint` as the same token.
- [ ] **Step 4:** Run `npm test -- sites`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: site list storage and place search`.

---

### Task 8: US map, controls and Customers panel

**Files:**
- Create: `src/demand/usmap.ts`, `src/demand/controls.ts`, `src/demand/panel.ts`
- Modify: `src/main.ts` (mount on first Customers open), `src/style.css`, `package.json` (add `d3-geo`, `us-atlas`, `@types/d3-geo`)
- Test: `tests/demand/usmap.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 7.
- Produces:

```ts
export interface CustomerState { groups: IndustryGroup[]; measure: DemandMeasure; sites: Site[]; county: string | null }
export function createUsMap(el: HTMLElement, opts: { onCounty(fips: string | null): void; onMapClick(lonLat: [number, number]): void }):
  { render(d: DemandData, s: CustomerState): void };
export function ctMerged(d: DemandData): Map<string, number | null>; // per-shape values incl. '09' state total; used by render
```

- [ ] **Step 1: Write failing tests** (jsdom): render with a two-county fixture and one site → one `path.county` per shape, a `circle.site`, three `path.ring` with `data-mi` 150/300/500; a withheld county has class `withheld`; Connecticut shapes carry `data-fips="09"` and title text containing "state total"; `ctMerged` sums the 9 planning regions.
- [ ] **Step 2:** Run `npm test -- usmap`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - map: `geoAlbersUsa().fitSize`, counties from `us-atlas/counties-10m.json`, state borders mesh, 5 classes (`classes(…, 5)`) on a gray ramp `#f1f1ef #d4d4d0 #a3a39e #5c5c58 #1a1a19`, hatch pattern for withheld, legend;
  - rings: `geoCircle().center([lon, lat]).radius(mi / 69.0468)` (degrees);
  - map click: `projection.invert` → `onMapClick`; the controls then show a small "Name this site" input prefilled with the nearest place from `searchPlaces`-style nearest lookup (nearest `Place` by `miles`), Enter adds, Escape cancels; a click outside the US (invert returns null) does nothing;
  - controls: group checkboxes (default all), measure toggle (default `emp`), add-site box (focus → `loadPlaces`, suggestions from `searchPlaces`, Enter or click adds), site chips with remove;
  - panel: national total + top 10 counties; one card per site with 150/300/500/territory rows showing value and "M counties withheld" when > 0, expandable by group; county detail on click with a back link;
  - state persisted with `saveSites` and the URL.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: customers map, controls and panel`.

---

### Task 9: Browser tests, README, real-data check

**Files:**
- Create: `tests/fixtures/dataset/demand.json`, `places.json`, `domestic.json` (synthetic, labelled so in content)
- Modify: `e2e/globe.spec.ts` (or new `e2e/customers.spec.ts`), `README.md`

- [ ] **Step 1:** Write e2e tests against the fixtures: open Customers via tab; Detroit card shows non-zero 300 mi employees; add "Chicago" through the search box → second card appears and the URL contains it; remove it → card gone; click a county → detail with its name; Supply tab card shows "imports" and a percentage; `demand.json` failing to load names the file in the Customers tab while the globe still works.
- [ ] **Step 2:** Run `npm run e2e`. Expected: all new tests fail only where features are missing, then pass after any fixes; all stage 1 tests still pass.
- [ ] **Step 3:** README: Customers tab, industry groups and where satellites/solar sit, CBP noise and withholding, Connecticut handling, distance method, import-share formula and the 2016 limit, `npm run pipeline:demand`, the yearly workflow.
- [ ] **Step 4:** Run `npm test`, `npm run build`, `npm run e2e`; take real-data screenshots of Customers (Detroit + one added site) and the Supply card; check for console errors.
- [ ] **Step 5:** Commit `docs: customers map README and browser tests`; push.
