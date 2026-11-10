import { INDUSTRY_GROUPS, type DemandData, type DomesticData } from '../../shared/demand';

export const MIN_COUNTIES = 3100;
export const MAX_COUNTIES = 3300;
const YEARS = [2012, 2013, 2014, 2015, 2016];

/** Problems that should stop the pipeline from replacing public/data; empty when the data is fit to publish. */
export function validateDemand(d: DemandData, domestic: DomesticData, missingPoints: string[]): string[] {
  const problems: string[] = [];
  const n = d.counties.length;
  if (n < MIN_COUNTIES || n > MAX_COUNTIES) {
    problems.push(`county count ${n} outside ${MIN_COUNTIES}-${MAX_COUNTIES}`);
  }
  for (const f of missingPoints) problems.push(`CBP county ${f} has no geoinfo point`);
  for (const g of INDUSTRY_GROUPS) {
    if (!d.counties.some((c) => c.estab[g] > 0)) problems.push(`group ${g} has no establishments nationally`);
  }
  for (const g of INDUSTRY_GROUPS) {
    const t = d.usTotals?.[g];
    if (!t || !(t.estab > 0)) problems.push(`group ${g} has no national total`);
  }
  for (const [product, p] of Object.entries(domestic.products)) {
    if (!p) continue;
    for (const y of YEARS) {
      if (p.domestic[String(y)] == null) problems.push(`domestic ${product} missing ${y}`);
    }
    if (p.imports['2016'] == null) problems.push(`domestic ${product} imports missing 2016`);
  }
  return problems;
}
