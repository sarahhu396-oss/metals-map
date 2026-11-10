# Aluminum supply globe

A static web page showing US imports and exports of aluminum mill products on
a globe. You can view each partner country by month from January 2015, by
tonnes, dollar value, or implied price per tonne. The side panel ranks
partners and shows supply concentration, each country's trend over time with
tariff events marked, and the effective duty rate.

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

## Running it

Requires Node 20 or later.

```bash
npm ci
npm run dev        # local server
npm test           # unit tests
npm run e2e        # browser tests (Playwright, against a synthetic fixture)
npm run build      # static site in dist/
```

### Refreshing the data

The pipeline needs a free Census API key
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

## GitHub setup (one time)

1. **Settings → Pages:** set the source to **GitHub Actions**.
2. **Settings → Secrets and variables → Actions:** add `CENSUS_API_KEY`. It is
   required, because Census rejects requests without a key.
3. The deploy workflow runs on pushes to `main`. If the repository's default
   branch has another name, change `branches:` in `.github/workflows/deploy.yml`.

`refresh.yml` runs on the 10th of each month, or on demand. It commits
`public/data/` only if the data changed, and a failed pipeline commits nothing.
`deploy.yml` tests, builds, and publishes the site after each push to `main`
and after each successful refresh.
