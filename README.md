# Aluminum supply globe and customers map

A static web page with two tabs. **Supply** shows US imports and exports of
aluminum mill products on a globe. You can view each partner country by month
from January 2015, by tonnes, dollar value, or implied price per tonne. The
side panel ranks partners and shows supply concentration, each country's trend
over time with tariff events marked, the effective duty rate, and the import
share of US supply (2012–2016). **Customers** maps US manufacturers in
aluminum-using industries by county and totals them around your sites; see
[Customers tab](#customers-tab).

## Data

- **Source:** US Census Bureau International Trade API
  (`api.census.gov/data/timeseries/intltrade`), 10-digit HS codes, monthly, by
  country. Imports are *imports for consumption*, so value and calculated duty
  share a basis. Exports are total exports.
- **Lag:** Census publishes a month's trade about five to six weeks after the
  month ends, so the latest month shown is usually two months back.
- **Quantities** are metric tonnes (kilograms ÷ 1000). Every code currently
  reports in kilograms. A row in any other unit is left out of tonnes and
  reported by the pipeline. Missing quantity is shown as “no data”, never as
  zero.
- Totals and regional groupings that Census returns alongside countries (for
  example “TOTAL FOR ALL COUNTRIES” or “EUROPEAN UNION”) are dropped, so nothing
  is double counted.

### Product groups

| Group | HS heading | Notes |
|---|---|---|
| Plate | 7606, over 6.3 mm thick | |
| Sheet & strip | 7606, 6.3 mm or less | Includes the two rectangular *clad* codes, which have no thickness split (about 4% of 7606 import tonnes in 2024) |
| Bar, rod & profiles | 7604 | |
| Unwrought | 7601 | |
| Tube & pipe | 7608 | |
| Foil | 7607 | |

The code-by-code mapping is in `pipeline/product-groups.json`. The reasoning
behind it is in `docs/census-api-notes.md`. A code the mapping does not cover
stops the pipeline, so a tariff-schedule revision cannot silently drop volume.

### Effective duty rate

Calculated duty (`CAL_DUT_MO`) divided by the value of imports for consumption
(`CON_VAL_MO`), summed over the selected period. It includes Section 232 and
other duties Census calculates. It is not shown for exports.

### Reconciliation

For plate and sheet (HS 7606) imports in 2024, the pipeline's sum of 10-digit
country rows matches Census's published HS 7606 total exactly: $3,398,830,200
in value, $264,593,052 in duty, and 919,336 t. Both comparison figures come
from the Census API itself. An independent check against USITC DataWeb has not
been done yet. See `docs/census-api-notes.md`.

### Tariff events

`public/data/tariff-events.json` is maintained by hand. Each entry links to its
Federal Register document and is dated by its publication date.

## Customers tab

A map of US counties shaded by employees (or establishments) in the industry
groups you tick, with a marker and dashed rings at 150, 300 and 500 miles for
each site. The side panel gives the national total, the top 10 counties, and
one card per site with employees and establishments within each ring and in
the site's territory. Clicking a county shows its figures by group. The
active tab is kept in the page URL (`?tab=customers`).

### Industry groups

Source: Census County Business Patterns (CBP), 2023, by 2017 NAICS code. Each
code sits in exactly one group; where a listed code contains another, the
inner one is subtracted from the outer one. The mapping is in
`pipeline/industries.json`.

| Group | NAICS codes |
|---|---|
| Aerospace, defense & space | 3364, 332992, 332993, 332994, 3366 |
| Automotive | 3361, 3362 less 336212 and 336214, 3363 |
| Trucks, trailers & rail | 336212, 336214, 3365 |
| Machinery & equipment | 333 less 333242 and 333415, 3391 |
| Semiconductors & electronics | 333242, 334413, 334220 |
| Electrical equipment | 335 |
| HVAC & refrigeration | 333415 |
| Machine shops & fabricators | 332710, 3328, 3323 |

- **Satellites** have no code of their own. Manufacturers sit inside
  aerospace under 336414 (space vehicles, part of 3364), and satellite
  communications equipment is in 334220 (Semiconductors & electronics).
- **Solar** has no code either. Photovoltaic cells are in 334413
  (Semiconductors & electronics), and solar racking and mounting structures are
  structural metal work, 332312, inside 3323 (Machine shops & fabricators).
  Both groups include non-solar firms.
- **Boats** are in Aerospace, defense & space through 3366 (ships and boats).

### What the figures mean

- **Year:** CBP 2023, the newest the API served when the data was built.
- **Few establishments:** Census leaves out industry figures for counties with
  very few establishments. Those cells are shown as none (zero), so small
  counties can be understated. Establishment counts are not withheld.
- **Noise:** Census adds noise to employment so single employers cannot be
  identified. Treat employment as approximate. Employment
  that Census marks as withheld is kept as withheld, never as zero or an
  estimate.
- **Connecticut:** CBP 2023 reports Connecticut by its 9 planning regions, but
  the county shapes (`us-atlas`) use the 8 older counties. Connecticut is
  therefore drawn and shaded as one state-level area, whose figures are the
  sum of the 9 regions.
- **Alaska:** The shapes have one area (02261) where CBP has two boroughs;
  its figures combine 02063 and 02066.

### Distances, rings and territory

Distances are straight-line (great-circle) from each site to each county's
interior point, not driving distance. A county is inside a ring when its
interior point is. Ring totals can count a county for several sites.
Territory assigns each county to its nearest site (ties go to the site added
first).

### Sites

Detroit, MI is preloaded. Add a site by typing a city name (suggestions come
from `public/data/places.json`, Census places) or with **Pick on map**, then
clicking the map (Shift+click also places a site) and naming it. Remove a site
with the × on its chip. Sites are saved in the page link and in the browser,
so a link reproduces the same set. Malformed entries in a link are ignored.

### Import share (Supply tab)

The card shows, for the selected product, the share of US supply that came
from imports:

> imports ÷ (US mill shipments + imports − exports), by value, calendar year

Imports and exports are the same Census trade figures as the globe, summed over
the same HS codes. US mill shipments are the value of product shipments from
the Census Annual Survey of Manufactures. That series ends in 2016, so the card
covers **2012–2016 only**. It is a baseline, not current. Notes:

- Plate: the domestic series is 0.25 in. and over (6.35 mm), the import split is
  over 6.3 mm.
- Foil: domestic figures are plain foil; imports under 7607 also include backed
  foil, which pushes the import share up.
- A year with any missing term shows no number.
- Domestic data lives in `public/data/domestic.json` and does not change.

## Running it

Requires Node 20 or later.

```bash
npm ci
npm run dev        # local server
npm test           # unit tests
npm run e2e        # browser tests (Playwright, against synthetic fixtures)
npm run build      # static site in dist/
```

### Refreshing the data

Both pipelines need a free Census API key
(<https://api.census.gov/data/key_signup.html>). The key only works after you
click the activation link Census emails you.

```bash
CENSUS_API_KEY=... npm run pipeline                 # full fetch from 2015-01 (~7 minutes)
CENSUS_API_KEY=... npm run pipeline -- --start 2020-01
npm run pipeline -- --offline                       # rebuild from pipeline/raw, no fetch
```

The pipeline fetches into `pipeline/raw/`, which is git-ignored. It then
validates the result against the data already in `public/data/` and replaces
those files only if it finds no problems. It fails on an unmapped code, a
country missing from `pipeline/country-reference.json`, an empty result, a
latest month earlier than before, or a monthly total that moved by more than
1.5× against the previous data. On failure it prints each problem and leaves
`public/data/` untouched.

The customers data has its own pipeline:

```bash
CENSUS_API_KEY=... npm run pipeline:demand
```

It reads the groups in `pipeline/industries.json`, fetches CBP county data
for every code, the Census places list, and the domestic shipments, and writes
`demand.json`, `places.json` and `domestic.json` in `public/data/`. It makes
many requests, one per NAICS code and more, so expect a long run; the yearly
workflow allows up to two hours. Like the trade pipeline, it validates first
(every code returns data, 3,100–3,300 counties, every county has a shape, every
product has 2012–2016 values) and replaces nothing on failure.

## GitHub setup (one time)

1. **Settings → Pages:** set the source to **GitHub Actions**.
2. **Settings → Secrets and variables → Actions:** add `CENSUS_API_KEY`. It is
   required, because Census rejects requests without a key.
3. The deploy workflow runs on pushes to `main`. If the repository's default
   branch has another name, change `branches:` in `.github/workflows/deploy.yml`.

`refresh.yml` runs on the 10th of each month, or on demand. It commits
`public/data/` only if the data changed, and a failed pipeline commits nothing.
`refresh-demand.yml` runs the customers pipeline once a year, on 15 May, or on
demand (Actions tab, **Run workflow**), and commits `public/data/` only if
something changed. `deploy.yml` tests, builds, and publishes the site after each push to `main`
and after each successful refresh.
