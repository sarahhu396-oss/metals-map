# Aluminum Demand Map — Design (Stage 2)

Date: 2026-11-10
Status: awaiting review
Builds on: `docs/superpowers/specs/2026-11-09-supply-globe-design.md` (stage 1)

## Purpose

Stage 1 shows where US aluminum mill products come from. Stage 2 shows who
buys them, and puts imports in the context of US mill supply. The context is
the same: a service center (today in Detroit, with further sites planned, for
example Los Angeles) that buys plate, bar and sheet and sells to US
manufacturers. The tool remains for the author's own use, with traceable
sources.

### Questions stage 2 must answer

1. Where are US manufacturers in aluminum-using industries, by county?
2. How much of that sits within 150, 300 and 500 miles of each of the user's
   sites, and in each site's territory?
3. How much of US supply of each product came from imports rather than US
   mills (by value, 2012–2016)?

### Out of scope for stage 2

- Comparing candidate sites side by side, a "gap finder", driving-time zones
- Locations or capacities of US mills
- Materials-consumed data (Economic Census), which is too patchy by industry
- County-level trends over time; anything below county level
- Accounts, backend, database (unchanged from stage 1)

## Data

### Customer industries

Each NAICS code belongs to exactly one display group. Where a listed code
contains another listed code, the contained code is subtracted from it (see
"Grouping"), so nothing is counted twice.

| Group | NAICS codes |
|---|---|
| Aerospace, defense & space | 3364 (incl. 336414 space vehicles, satellites), 332992, 332993, 332994 (ordnance), 3366 (ships and boats) |
| Automotive | 3361, 3362 less 336212 and 336214, 3363 |
| Trucks, trailers & rail | 336212, 336214, 3365 |
| Machinery & equipment | 333 less 333242 and 333415; 3391 (medical devices) |
| Semiconductors & electronics | 333242, 334413 (incl. PV cells), 334220 (incl. satellite communications) |
| Electrical equipment | 335 |
| HVAC & refrigeration | 333415 |
| Machine shops & fabricators | 332710, 3328, 3323 (incl. 332312, where solar racking is classified) |

Solar has no NAICS code of its own; the UI names the groups as above and the
README explains where solar sits.

### County Business Patterns (CBP)

- Source: Census API `/data/<year>/cbp`, variables `ESTAB`, `EMP` and the
  employment noise/suppression flag, `for=county:*`, one request per code.
- Year: the newest year the API serves (tried from the current year back).
- Census withholds `EMP` for some county–industry cells. Establishments are
  always present. A withheld value is stored as `null` with a flag, never as
  zero and never estimated.

### Grouping

For each county and group: sum the group's codes; subtract each contained
code listed elsewhere. If any term in that sum or subtraction is withheld,
the group's employment for that county is withheld (`null`, flagged), and
establishments are computed the same way (establishments are never
withheld, so they always resolve).

### County geometry

From 2022, CBP reports Connecticut by 9 planning regions instead of 8
counties. The prebuilt `us-atlas` shapes use the old counties, so the
pipeline builds county shapes from the Census 2023 cartographic boundary file
(1:20m), simplified to TopoJSON, with an interior point per county for
distance calculations. Fallback if that file cannot be fetched: `us-atlas`
shapes, with Connecticut shown as one state-level area and labelled so.

### Places (city search)

Census Gazetteer places file (incorporated places and CDPs): name, state,
latitude, longitude. Written to `public/data/places.json` and loaded only when
the add-site box opens.

### Domestic shipments

- Source: Census API `timeseries/asm/product`, `PRODVAL` (value of product
  shipments, $1,000s), US level, 2012–2016. The series is not published after
  2016, and 2017/2022 Economic Census product shipments are not in the API.
- Product mapping to stage 1 groups:

| Stage 1 group | Domestic product codes | Note |
|---|---|---|
| Plate | 3313151 aluminum plate, 0.25 in. or more | 0.25 in. = 6.35 mm vs the 6.3 mm import split |
| Sheet | 3313153 sheet and strip | |
| Foil | 3313155 plain foil | Backed foil (in 7607 imports) is not in the domestic figure |
| Bar, rod & profiles | 3313181 extruded rod, bar and shapes; 3313187 rolled rod and bar | |
| Tube | 3313183 extruded tube; 3313157 welded tube | |
| Unwrought | 3313133 primary ingot; 3313142 secondary ingot | |

- Import share = imports ÷ (domestic shipments + imports − exports), all in
  dollars, calendar years. Imports and exports come from stage 1 flows.
- Fetched once into `public/data/domestic.json`; it is historical and does
  not change.

## Interface

### Navigation

Two tabs: **Supply** (stage 1 globe, unchanged) and **Customers**. The active
tab is kept in the page URL.

### Customers tab

- **Controls:** industry groups (any combination, default all) and measure
  (employees, default; or establishments).
- **Map:** SVG, Albers USA projection (`d3-geo` `geoAlbersUsa`, Alaska and
  Hawaii inset). Counties shaded light gray to near-black by the measure for
  the selected groups, quantile classes with a legend. Counties whose
  employment is withheld are hatched; hover text gives the establishment
  count and says employment is withheld. Thin state borders.
- **Sites:** marker plus dashed rings at 150, 300 and 500 miles (great-circle
  distance). Detroit, MI is preloaded. Add a site by typing a place name
  (autocomplete from the places file) or by clicking the map and naming it.
  Each site can be removed. Sites are stored in the URL and in browser
  storage; malformed entries are ignored.
- **Panel:**
  - Overview: national total for the selection, top 10 counties.
  - One card per site: employees and establishments within 150, 300, 500 mi
    and in its territory, each by group. A county is within a ring when its
    interior point is. Ring totals may count a county for several sites;
    territory assigns each county to its nearest site (ties: the site added
    first).
  - County detail on click: by group, withheld values marked.

### Supply tab addition

An import-share card in the panel for the selected product: "US supply,
2016: imports X%", and a small 2012–2016 chart. The card states the basis
(dollars, calendar year) and that domestic data ends in 2016. The card does
not depend on the direction control. When the product is "all", the card
shows a short table with each product's 2016 import share instead of one
number. A product without a domestic match shows the reason instead of a
number.

### Visual style

Matches the stage 1 dot-matrix globe: white ground, grays and black, red
reserved for imports. Site markers and rings are black.

## Pipeline and files

| File | Contents |
|---|---|
| `pipeline/industries.json` | groups → NAICS codes and subtractions |
| `pipeline/demand/*.ts` | CBP fetch, grouping, geometry build, places, domestic |
| `public/data/demand.json` | year, per county: establishments and employees per group, withheld flags |
| `public/data/counties.json` | TopoJSON counties and states, plus interior points |
| `public/data/places.json` | place name, state, lat, lon |
| `public/data/domestic.json` | product code → year → value |

Run with `npm run pipeline:demand`. Validation, any failure leaving
`public/data` untouched:

- every listed NAICS code returns data;
- county count between 3,100 and 3,300;
- every CBP county has a shape;
- every mapped domestic product has values for 2012–2016.

A separate GitHub Actions workflow runs it yearly (May) and on demand; the
monthly trade refresh is unchanged.

## Errors

- The Customers tab loads its files on first open. A failed file is named in
  that tab; the Supply tab keeps working.
- The import-share card hides with a note if `domestic.json` fails to load.

## Testing

- Unit:
  - grouping with subtraction and withheld values;
  - great-circle distance and ring membership at boundaries;
  - territory assignment and ties;
  - import-share formula with missing years and zero denominators;
  - reading sites from the URL and storage, including malformed input;
  - CBP, gazetteer and ASM parsing and validation against saved real
    responses.
- Browser (synthetic fixtures): switch tabs; add and remove a site; site
  totals change; county detail opens; import-share card shows.
- Screenshot check with real data before pushing.

## Risks

- Census cartographic boundary or gazetteer downloads may be blocked from the
  build environment; fallbacks are stated above (county shapes) or, for
  places, adding sites by map click only until the file can be fetched.
- Domestic data ends in 2016, so the import share is a baseline, not current.
- CBP withholding is heavier for small counties; establishment counts remain
  available everywhere.
