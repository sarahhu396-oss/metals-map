# SDD ledger — plan: docs/superpowers/plans/2026-11-10-demand-map.md
Spec: docs/superpowers/specs/2026-11-10-demand-map-design.md (reachable). Branch: claude/sleepy-ptolemy-103uwo (user-named). Start HEAD: 80798af.
Pre-flight (shared interfaces):
| T1 -> T2 | Cell {estab, emp|null} produced by T1, parseCbp returns Cell & {name} | consistent |
| T1 -> T3 | GroupDef/groupCounty, DomesticProduct {codes, domestic, imports, exports, note} | consistent |
| T2 -> T3 | cbpUrl/parseCbp/geoinfoUrl/parsePoints/asmUrl/parseAsm/latestCbpYear/cleanPlace; fetchText extracted from stage-1 pipeline/fetch.ts | consistent; T2 must keep stage-1 tests green |
| T3 (stage1 buildUrl) | T3 adds optional country filter to stage-1 buildUrl in pipeline/census.ts | shared file with stage 1; optional param keeps stage-1 calls unchanged |
| T1/T3 -> T5 | DomesticData shape; importShare(dom, product, year) | consistent |
| T4 -> T5, T8 | loadDomestic/loadDemand/loadPlaces memoised | consistent |
| T1 -> T6, T7 | CountyDemand, Site, Place tuple | consistent |
| T6 -> T8 | miles, RINGS_MI, classes, total, within, territories, topCounties, countyValue | consistent |
| T7 -> T8 | DEFAULT_SITES, encode/decode/load/saveSites, searchPlaces | consistent |
| T1..T8 -> T9 | synthetic fixtures in shared/demand.ts shapes | consistent |
Pre-flight (per task self-consistency):
| T1 | the "no double counting" test is worded loosely | Ruling: test asserts (a) no NAICS code appears in two groups' add lists, (b) every subtract code is in its own group's add list by prefix and in exactly one other group's add list — spec's "each code in exactly one group" — cost if wrong: none |
| T2 | ok | |
| T3 | spec validation "every CBP county has a shape" became "every CBP county has a geoinfo point" (shapes come from us-atlas, see plan rulings) | Ruling: validate points; CT shapes handled by ctMerged in T8 — cost if wrong: an unmatched new county shape would be unshaded (visible, not silent) |
| T4 | ok | |
| T5 | ok | |
| T6 | ok | |
| T7 | ok | |
| T8 | largest task (3 UI modules + map) | kept as one task: one review surface for the tab's UI; standard model |
| T9 | ok | |
Task 1: minor (deferred): no test catches an omitted subtraction (an add code whose prefix is added in another group without being subtracted there)
Task 1: minor (deferred): clamp of negative estab after subtraction gives no signal (brief-mandated clamp)
Task 1: complete (commits 80798af..7bc7820, review clean)
Task 2: ⚠️ key masking not visible in diff — controller verified in pipeline/fetch.ts (see grep) and covered by new fetchText test
Task 2: minor (deferred): latestCbpYear 5-year floor hard-coded (census.ts:55,57)
Task 2: minor (deferred): CT CBP fixture saved but unused by tests (intended for later CT handling)
Task 2: minor (deferred): cleanPlace strips any all-lowercase trailing word (brief rule)
Task 2: complete (commits 7bc7820..e8ebc8e, review clean)
Task 3: Ruling: stage-1 buildUrl gains a 6th optional positional param `cty?: string` (adds CTY_CODE filter); existing calls unchanged — cost if wrong: none
Task 3: Ruling: for 2012–2014 trade totals, HS10 codes absent from product-groups.json (pre-2015 codes) fall back to heading mapping (7601 unwrought, 7604 bar_rod_profiles, 7607 foil, 7608 tube); an unmapped 7606 code with nonzero value makes that year's plate AND sheet imports/exports null (can't split by thickness) — cost if wrong: a few early-year shares shown as unavailable
Task 3: Ruling: NAICS 332993 (ammunition) has national data but no county rows (204) — accept a code whose county query is empty when its US-level query has data; it counts 0 in every county and the pipeline logs it — cost if wrong: aerospace/defense slightly understated where ammunition plants exist
Task 3: Ruling: CBP 2023 omits suppressed county–industry cells instead of flagging D/N, so omitted = 0 per the plan constraint; withheld hatching code stays (handles D/N if Census returns them) but will not trigger on 2023 data; README and the Customers panel must say "Census omits industry cells for counties with very few establishments; these show as none" (carry to Tasks 8/9) — cost if wrong: small counties understated with no visual cue
Task 3: minor (deferred): duplicate place names within one state (e.g. two Aaronsburg, PA) remain in places.json
Task 3: minor (deferred): pool() duplicated from pipeline/fetch.ts in pipeline/demand/run.ts
Task 3: minor (deferred): three renames not atomic as a set; temp dir .demand-tmp sits under public/
Task 3: minor (deferred): US-level fallback query runs serially outside the pool
Task 3: minor (deferred): validateDemand skips a product missing from the map entirely
Task 3: fix round 1/5 (2 addressed, 0 open; commits ab8909e..e370e30)
Task 3: minor (deferred): sumTrade partial-empty-heading year untested; fallback tests don't assert other groups stay 0
Task 3: complete (commits e8ebc8e..e370e30, review clean)
Task 4: ⚠️ globe created while #map hidden (?tab=customers on load) — unverified; Ruling: confirm via an e2e test in the fix round — cost if wrong: blank globe after switching tabs
Task 4: Ruling: mobile blank 55vh map track under Customers (reviewer Minor 3) is user-visible on phones; folded into fix round 1 — cost if wrong: none
Task 4: minor (deferred): loading text lacks role=status/aria-live
Task 4: minor (deferred): retry after a failed load is only by re-clicking the tab, with no hint
Task 4: minor (deferred): showTab/loading/error/retry flow has no jsdom unit test (e2e covers in Task 9)
Task 4: fix round 1/5 (4 addressed, 0 open; commits 0fdd8ea..eca0343)
Task 4: minor (deferred): Supply tabpanel covers #map only, not controls/panel
Task 4: complete (commits e370e30..eca0343, review clean)
Task 5: minor (deferred): synthetic domestic fixture has identical values per product, so e2e can't catch wrong-product reads; error/all-table/no-match branches untested
Task 5: minor (deferred): "all" table iterates Object.keys(dom.products) rather than PRODUCT_GROUPS (missing products get no row; JSON order)
Task 5: minor (deferred): import-share SVG exposes no per-year values to screen readers
Task 5: minor (deferred): panel.ts .then(ok, err) leaves a throw inside ok unhandled
Task 5: minor (deferred): all-null chart "no data" label near the year label
Task 5: complete (commits eca0343..6a8db30, review clean)
Task 6: minor (deferred): classes tests check counts/order but not break values or exclusion of zeros
Task 6: minor (deferred): byGroup branch for unselected groups untested
Task 6: minor (deferred): topCounties with negative n slices from the end
Task 6: complete (commits 6a8db30..e5d5a70, review clean)
Task 7: minor (deferred): partial "sain" doesn't match "Saint" (no "Saint" names in data; list blanks at "sai"/"sain")
Task 7: minor (deferred): apostrophes split tokens ("baileys" misses "Bailey's Crossroads")
Task 7: minor (deferred): loadSites returns shared DEFAULT_SITES by reference (carried to Task 8: never mutate loaded site arrays)
Task 7: minor (deferred): combining-mark regex written with invisible raw characters
Task 7: minor (deferred): searchPlaces normalizes all 32k places per keystroke, no debounce (carried to Task 8)
Task 7: minor (deferred): decodeSites has no entry cap; test gaps (extra '@', state-exact, "sain")
Task 7: complete (commits e5d5a70..09919ed, review clean)
Task 8: Ruling: spec gives map click two jobs (county detail; drop a site); plain click = county detail, a "Pick on map" button (or Shift+click) = drop a site — both spec features kept, no ambiguous click — cost if wrong: one extra click to drop a site
Task 8: Ruling: added src/demand/customers.ts (customer state + URL/storage wiring) not in the plan's file list — keeps controls/panel/usmap single-purpose — cost if wrong: none
Task 8: Ruling: reviewer's Minor "site cards show only the selected measure" re-graded Important — spec says each site card shows employees AND establishments — cost if wrong: none
Task 8: minor (deferred): rings for coastal/border sites clipped at the SVG viewBox (only ocean/other countries cut)
Task 8: minor (deferred): legend repeats "X+" labels when classes de-duplicates breaks
Task 8: minor (deferred): top-10 rows for merged-area regions (CT regions, AK 02063/02066) select a FIPS with no shape: no outline, detail shows only that region
Task 8: minor (deferred): county paths not keyboard-focusable; search box lacks aria-expanded/controls/activedescendant; SVG lacks <title>
Task 8: minor (deferred): h() duplicated in controls/panel; measure labels duplicated in usmap; view modules cross-import formatters
Task 8: minor (deferred): main.ts statically imports usmap/d3-geo into the Supply bundle (only atlas JSON lazy)
Task 8: minor (deferred): no tests for controls/panel interactions
Task 8: fix round 1/5 (5 addressed, 0 open; commits 49ea02b..51b10b5)
Task 8: minor (deferred): fix-round tests written after the fixes (no RED run); re-reviewer judged each would fail pre-fix
Task 8: complete (commits 09919ed..51b10b5, review clean)
Task 9: ⚠️ README claims checked by controller: "malformed link entries ignored" true (decodeSites); no tie claim present; README.md:193 "every county has a shape" is FALSE (validation checks geoinfo points, per Task 3 ruling) — confirmed gap, enters fix loop
Task 9: minor (deferred): Detroit e2e asserts only > 0 at 300 mi; Supply-card e2e mostly duplicates the existing test; county click via dispatchEvent
Task 9: minor (deferred): README "shown as none (zero)" sits close to "withheld is never zero" — could state omitted row = 0, withheld flag = unknown; uneven wrapping at README 99-101, 203-205
Task 9: fix round 1/5 (1 addressed, 0 open; commits 7d1819a..a3bf67a)
Task 9: minor (deferred): README validation list omits run.ts's "every NAICS code returns data (or has US-level data)" pre-write check and the suppressed-code-as-zero rule (332993)
Task 9: complete (commits 51b10b5..a3bf67a, review clean)
Final review: Ready to merge "with fixes" (most capable model).
Final: Ruling: Task 3 ruling's stated cost was wrong — omitted CBP cells hide large single-plant counties (Union OH auto 0, Sagadahoc ME 0); treatment (omitted = 0) stands, disclosure must change: reword note/README to "lower bounds" and show coverage vs Census US totals per group — cost if wrong: none
Final: Ruling: re-graded to Important and folded into the fix wave: deploy.yml workflow_run missing 'Refresh demand data' (README claims deploy after each refresh); sites written to URL only after first change (README claims link reproduces set) — cost if wrong: none
Final: Ruling: cheap minors folded into the single fix wave: "at least N" wording (Review Focus 1), fatal key error not swallowed in year probe, Alaska 02261 detail title, onAddSite de-duplication — cost if wrong: none
Final: minor (deferred): Puerto Rico municipios counted in totals but not drawn by geoAlbersUsa (a PR site has a card but no marker)
Final: minor (deferred): 2016 bar/rod/profile exports spike (Census code 5520, May–Sep) inflates the 2016 headline share; card has no footnote
Final: minor (deferred): projected rings cross the Alaska inset
Final: fix wave (commits a3bf67a..9b554ab) — scoped re-review: 8 addressed, 0 open, no new breakage; controller verified npm test 216/216, tsc clean, e2e 17/17
Final: minor (deferred): places.json rewritten one-place-per-line (large one-time diff)
