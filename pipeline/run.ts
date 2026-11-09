/**
 * Monthly data refresh: fetch → parse → transform → validate → atomically replace public/data.
 *
 *   npm run pipeline                  # fetch from 2015-01 (needs CENSUS_API_KEY)
 *   npm run pipeline -- --start 2020-01
 *   npm run pipeline -- --offline     # rebuild from pipeline/raw without fetching
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Country, Direction, Flow, Meta } from '../shared/types';
import { parseResponse, type RawRow } from './census';
import { fetchRange } from './fetch';
import { transform, type GroupMap } from './transform';
import { validate, type Problem } from './validate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'pipeline/raw');
const OUT = join(ROOT, 'public/data');
const HEADINGS = ['7601', '7604', '7606', '7607', '7608'];
const SOURCE = 'US Census Bureau, International Trade API (imports for consumption; total exports), HS 7601/7604/7606/7607/7608';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

function readRaw(start: string): RawRow[] {
  const rows: RawRow[] = [];
  for (const file of readdirSync(RAW).sort()) {
    const m = /^(imports|exports)-(\d{4})-(\d{4})\.json$/.exec(file);
    if (!m || !HEADINGS.includes(m[2])) continue;
    rows.push(...parseResponse(m[1] as Direction, readFileSync(join(RAW, file), 'utf8')));
  }
  return rows.filter((r) => r.month >= start);
}

async function main(): Promise<number> {
  const start = arg('--start') ?? '2015-01';
  if (!/^\d{4}-\d{2}$/.test(start)) throw new Error(`--start must be YYYY-MM, got ${start}`);
  const offline = process.argv.includes('--offline');

  if (!offline) {
    const apiKey = process.env.CENSUS_API_KEY;
    if (!apiKey) throw new Error('CENSUS_API_KEY is not set (the Census API rejects keyless requests)');
    rmSync(RAW, { recursive: true, force: true });
    const r = await fetchRange({ start, headings: HEADINGS, outDir: RAW, apiKey });
    console.log(`fetched ${r.months.length} months, ${start}..${r.latestMonth}`);
  }

  const rows = readRaw(start);
  const groups = readJson<GroupMap>(join(ROOT, 'pipeline/product-groups.json'));
  const { flows, unmapped, nonKg } = transform(rows, groups);
  const reference = readJson<Country[]>(join(ROOT, 'pipeline/country-reference.json'));
  const present = new Set(flows.map((f) => f.cty));
  const countries = reference.filter((c) => present.has(c.code));
  const latestMonth = flows.map((f) => f.month).sort().at(-1) ?? '';

  const prevPath = join(OUT, 'flows.json');
  const prev = existsSync(prevPath) ? readJson<Flow[]>(prevPath) : null;
  const problems: Problem[] = validate({ flows, unmapped, countries: reference }, prev);
  if (existsSync(join(OUT, 'meta.json'))) {
    const prevMeta = readJson<Meta>(join(OUT, 'meta.json'));
    if (latestMonth < prevMeta.latestMonth) {
      problems.push({ kind: 'revision', detail: `latest month went back from ${prevMeta.latestMonth} to ${latestMonth}` });
    }
  }

  for (const n of nonKg) console.warn(`note: ${n.commodity} reports unit ${n.unit}; excluded from tonnes`);
  if (problems.length) {
    for (const p of problems) console.error(`problem [${p.kind}] ${p.detail}`);
    console.error(`${problems.length} problem(s); public/data left unchanged`);
    return 1;
  }

  const meta: Meta = { latestMonth, fetchedAt: new Date().toISOString(), source: SOURCE };
  const files: Record<string, unknown> = { 'flows.json': flows, 'countries.json': countries, 'meta.json': meta };
  const tmp = join(ROOT, 'public/.data-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    // flows: one object per line keeps git diffs readable; others pretty-printed.
    const text = name === 'flows.json'
      ? `[\n${flows.map((f) => JSON.stringify(f)).join(',\n')}\n]\n`
      : `${JSON.stringify(data, null, 1)}\n`;
    writeFileSync(join(tmp, name), text);
  }
  for (const name of Object.keys(files)) renameSync(join(tmp, name), join(OUT, name));
  rmSync(tmp, { recursive: true, force: true });

  const mb = statSync(prevPath).size / 1e6;
  console.log(`wrote ${flows.length} flows, ${countries.length} countries, latest ${latestMonth}; flows.json ${mb.toFixed(2)} MB`);
  return 0;
}

main().then((code) => process.exit(code), (err) => {
  console.error((err as Error).message);
  process.exit(1);
});
