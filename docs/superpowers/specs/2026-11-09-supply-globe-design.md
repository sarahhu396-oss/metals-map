# Aluminum Supply Globe — Design (Stage 1)

Date: 2026-11-09
Status: awaiting review

## Purpose

A personal analysis tool for understanding where the aluminum mill products
that a US metals service center buys come from, and how that supply is
shifting. The motivating context is Nox Metals: a Detroit service center that
buys aluminum plate, bar, and rounds from mills, cuts them to spec, and sells
to US manufacturers (aerospace, defense, automotive, medical, and others).

The tool is for the author's own curiosity. Accuracy and traceable sources
matter more than visual spectacle. There are no accounts, no backend, and no
upkeep beyond a monthly data refresh.

### Staging

The overall project has two stages, each with its own spec and plan:

1. **Supply globe (this spec):** US imports and exports of aluminum mill
   products by partner country.
2. **Demand map (later):** US manufacturing by industry and region, linked to
   the globe. Domestic mill output also belongs to stage 2.

### Questions stage 1 must answer

1. Where does US plate and bar come from, by country, volume, and share?
2. How is that shifting over time, including around tariff changes?
3. How concentrated is supply in a few origins, per product group?
4. What does it cost by origin: implied price per tonne and the effective
   duty rate paid?
5. Where do US exports of the same products go?

### Out of scope for stage 1

- The demand map and any end-use industry breakdown
- Domestic mill production
- Steel and other metals
- Flows that do not touch the US
- Mill-level or company-level data
- Bauxite, alumina, and scrap

## What the user sees

### Globe

- Opens centered on the US.
- One arc per partner country with non-zero flow in the selected period:
  partner → US for imports, US → partner for exports.
- Arc thickness encodes the selected measure. Color encodes direction
  (imports versus exports).
- Hovering an arc or country shows its name and value. Clicking a country
  selects it.

### Controls

| Control   | Options                                                              | Default        |
|-----------|----------------------------------------------------------------------|----------------|
| Product   | Plate/sheet, bar/rod/profiles, unwrought, tube, foil, all            | Plate/sheet    |
| Direction | Imports, exports, both                                               | Imports        |
| Measure   | Tonnes, dollar value, price per tonne                                | Tonnes         |
| Period    | Month slider with play/pause                                         | Latest month   |
| Window    | Single month, trailing 12 months                                     | Trailing 12    |

"All" sums the product groups. Price per tonne is value ÷ quantity and is not
shown for "both" directions or where quantity is missing.

If the 10-digit codes allow plate to be separated from sheet by thickness,
plate/sheet becomes two product groups (see Open items).

### Side panel

**Overview mode (no country selected):**

- Ranked partner countries with value and share of total
- Concentration: combined share of the top three partners
- Total over time as a line chart, with markers for tariff events
- The data's latest month and source attribution

**Country mode (a country selected):**

- That country's history for the selected measure
- Price per tonne history
- Product mix across groups
- Year-over-year change for the selected window
- Effective duty rate (duty ÷ customs value), imports only

## Data

### Source

US Census Bureau International Trade API, monthly, imports and exports, by
partner country, at the 10-digit code level (HTS for imports, Schedule B for
exports). Range: January 2015 to the latest published month.

Fields used:

- Imports: partner country code and name, commodity code and description,
  quantity and unit, customs value, calculated duty
- Exports: partner country code and name, commodity code and description,
  quantity and unit, value

Quantities arrive in kilograms and are converted to metric tonnes. Rows whose
unit is not kilograms are excluded from tonnage and reported by the
validation step.

### Product groups

A hand-maintained mapping file, `pipeline/product-groups.json`, assigns each
10-digit code under these headings to a product group:

| Group             | HS heading |
|-------------------|------------|
| Plate/sheet       | 7606       |
| Bar/rod/profiles  | 7604       |
| Unwrought         | 7601       |
| Tube              | 7608       |
| Foil              | 7607       |

Codes under these headings that the mapping does not cover fail validation,
so a code revision cannot silently drop volume.

### Tariff events

A hand-written file, `public/data/tariff-events.json`: date, short label, and
a source URL for each event. Used only as timeline markers.

### Effective duty rate

Calculated duty ÷ customs value, per country, product group, and period. This
measures what was actually paid and needs no tariff schedule.

### Output files

Committed to `public/data/`:

- `flows.json`: one record per month, direction, product group, and partner
  country, with tonnes, value, and (imports) duty. Missing quantity is
  `null`, never `0`.
- `countries.json`: Census country code, name, ISO code, and a
  latitude/longitude for the arc endpoint.
- `meta.json`: latest month, fetch timestamp, and source attribution.
- `tariff-events.json`: as above.

If `flows.json` exceeds about 5 MB, it is split into one file per product
group and loaded on demand.

## Architecture

A static site: Vite, TypeScript, MapLibre GL (globe projection), and deck.gl
(arc layer). Hosted on GitHub Pages. No server and no database.

```
pipeline/            fetch, transform, validate (Node + TypeScript)
  fetch.ts           Census API → raw responses on disk
  transform.ts       raw → flows.json, countries.json, meta.json
  validate.ts        checks before output replaces existing data
  product-groups.json
public/data/         committed pipeline output
src/data/            load JSON; pure functions over flows
src/map/             globe and arc layer
src/ui/              controls, side panel, charts
src/state.ts         the current selection
```

### Units and their boundaries

- **`pipeline/fetch`** takes a date range and headings and writes raw API
  responses. It knows the API and nothing about product groups.
- **`pipeline/transform`** takes raw responses and the mapping file and
  returns the output records. It is a pure function with no network access.
- **`pipeline/validate`** takes new output and the previous output and
  returns a list of problems.
- **`src/data`** exposes pure functions that take flows and a selection and
  return what the views need: arcs, rankings, shares, concentration, time
  series, price, duty rate. No rendering code.
- **`src/map`** takes a list of arcs and draws them. It emits hover and
  click events and computes nothing.
- **`src/ui`** renders controls and the panel from state and `src/data`
  results, and writes changes back to state.
- **`src/state`** holds the selection (product, direction, measure, period,
  window, selected country) and notifies subscribers.

### Data flow

1. The app loads `meta.json`, `countries.json`, `tariff-events.json`, and
   `flows.json`.
2. A control changes the selection in state.
3. State notifies the map and the panel.
4. Each calls `src/data` with the flows and the selection and renders the
   result.

### Refresh and deployment

- A scheduled GitHub Action runs the pipeline monthly and commits changed
  data files. It can also be run by hand.
- A second Action builds and deploys to GitHub Pages on every push to the
  default branch.
- The Census API key is optional. If supplied, it is stored as a GitHub
  Actions secret and read from the environment; it is never committed.

## Failure handling

**Pipeline.** The pipeline writes to a temporary location and replaces
`public/data/` only if validation passes. It exits non-zero, leaving existing
data untouched, when:

- the API returns an error or malformed response
- a month inside the requested range comes back with no rows
- a code under a tracked heading is missing from the mapping
- a product group's monthly total changes by more than a set factor from the
  previous run's figure for the same month (revisions are normally small)

**App.**

- If a data file fails to load, the app shows an error message naming the
  file, not an empty globe.
- Missing quantity displays as "no data" and is excluded from tonnage, share,
  and price calculations. It is never treated as zero.
- A selection with no flows shows an explicit empty state.

## Testing

- **Transform:** unit tests against saved samples of real API responses,
  covering unit conversion, product grouping, missing quantities, and
  unmapped codes.
- **Validation:** unit tests for each failure condition.
- **Data functions:** unit tests for ranking, share, concentration, trailing
  windows, price per tonne, duty rate, and year-over-year change, including
  missing-data cases.
- **Browser:** one Playwright test that the globe renders, and that changing
  the product control changes the arcs and the panel.
- **Accuracy:** before the numbers are treated as correct, one product group
  and one full year are reconciled by hand against totals published by
  Census or USITC DataWeb. The result is recorded in the README.

## Open items to resolve during the build

These need the Census API, which the current development session cannot
reach until `api.census.gov` is allowed.

1. **Plate versus sheet.** Confirm which 10-digit codes under 7606 carry
   thickness breaks and whether plate can be isolated cleanly. If yes, split
   the group; if not, keep plate/sheet combined and say so in the UI.
2. **Field names and history.** Confirm the exact API variables for
   quantity, value, and duty, and that monthly 10-digit data is available
   back to 2015. If not, start from the earliest month that is.
3. **Bundle size.** Measure `flows.json` and split per product group if
   needed.
