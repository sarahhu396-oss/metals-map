import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Direction } from '../shared/types';
import { buildUrl, parseResponse } from './census';

const DIRS: Direction[] = ['imports', 'exports'];

export interface FetchOptions {
  /** 'YYYY-MM' */
  start: string;
  headings: string[];
  outDir: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Base delay between retries; doubles each time. */
  retryDelayMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Requests in flight at once. */
  concurrency?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchTextOptions {
  fetchImpl?: typeof fetch;
  /** Base delay between retries; doubles each time. */
  retryDelayMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** GET a Census API URL with retries. 204 resolves to ''; a redirect (bad key) is fatal. */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  let last: Error = new Error('unreachable');
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1));
    try {
      const res = await f(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
      if (res.status === 204) return '';
      if (res.status >= 300 && res.status < 400) {
        // Census redirects bad or missing keys to an HTML page; retrying will not help.
        throw Object.assign(new Error(`Census API redirected (HTTP ${res.status}) — check CENSUS_API_KEY`), { fatal: true });
      }
      if (!res.ok) throw new Error(`Census API HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      last = err as Error;
    }
  }
  throw new Error(`${last.message} (after 3 retries): ${url.replace(/key=[^&]+/, 'key=***')}`);
}

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    }),
  );
  return out;
}

function monthsBetween(from: string, to: string): string[] {
  let [y, m] = from.split('-').map(Number);
  const out: string[] = [];
  for (;;) {
    const s = `${y}-${String(m).padStart(2, '0')}`;
    if (s > to) return out;
    out.push(s);
    if (++m > 12) { m = 1; y++; }
  }
}

/**
 * Fetch every heading in both directions from `start` onward, one calendar year per request,
 * writing each raw body to `outDir/<dir>-<heading>-<year>.json`. Stops at the first year with
 * no data at all. The range ends at the last month with data; a month with no data for any
 * heading before that is an error.
 */
export async function fetchRange(opts: FetchOptions): Promise<{ months: string[]; latestMonth: string }> {
  const f = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const concurrency = opts.concurrency ?? 4;
  mkdirSync(opts.outDir, { recursive: true });

  const seen = new Set<string>();
  for (let year = Number(opts.start.slice(0, 4)); ; year++) {
    const from = year === Number(opts.start.slice(0, 4)) ? opts.start : `${year}-01`;
    const to = `${year}-12`;
    const jobs = opts.headings.flatMap((heading) =>
      DIRS.map((dir) => async () => {
        const body = await fetchText(buildUrl(dir, heading, from, to, opts.apiKey), { fetchImpl: f, retryDelayMs, timeoutMs });
        writeFileSync(join(opts.outDir, `${dir}-${heading}-${year}.json`), body);
        return parseResponse(dir, body).map((r) => r.month);
      }),
    );
    const months = (await pool(jobs, concurrency)).flat();
    if (months.length === 0) break;
    months.forEach((m) => seen.add(m));
  }

  if (seen.size === 0) throw new Error(`Census API returned no data from ${opts.start} onward`);
  const latestMonth = [...seen].sort().at(-1)!;
  const all = monthsBetween(opts.start, latestMonth);
  const missing = all.filter((m) => !seen.has(m));
  if (missing.length) throw new Error(`Census API returned no data for ${missing.join(', ')}, before latest month ${latestMonth}`);
  return { months: all, latestMonth };
}
