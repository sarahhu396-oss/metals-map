import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The app is tested against a small synthetic dataset so results do not
// depend on whatever the live data currently contains.
const FIXTURES = path.resolve('tests/fixtures/dataset');

async function serveFixtures(page: Page, opts: { fail?: string } = {}): Promise<void> {
  await page.route('**/data/*.json', (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    if (file === opts.fail) return route.abort();
    return route.fulfill({
      body: readFileSync(path.join(FIXTURES, file)),
      contentType: 'application/json',
    });
  });
}

const arcCount = (page: Page) =>
  page.locator('#map').evaluate((el) => Number((el as HTMLElement).dataset.arcCount));

test('the globe loads with arcs and a ranked panel', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await expect(page.locator('#map[data-arc-count]')).toBeVisible();
  expect(await arcCount(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('rank-1')).toContainText('Canada');
  await expect(page.locator('#map canvas')).toBeVisible();
});

test('changing the product changes the panel', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  const before = await page.getByTestId('rank-1').textContent();
  await page.getByTestId('product').selectOption('unwrought');
  await expect(page.getByTestId('rank-1')).not.toHaveText(before!);
});

test('showing both directions adds export arcs', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await expect(page.locator('#map[data-arc-count]')).toBeVisible();
  const importsOnly = await arcCount(page);
  await page.getByTestId('direction').selectOption('both');
  await expect.poll(() => arcCount(page)).toBeGreaterThan(importsOnly);
});

test('selecting a country shows its detail and duty rate', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await page.getByTestId('rank-1').click();
  await expect(page.getByTestId('country-name')).toHaveText('Canada');
  await expect(page.getByTestId('duty-rate')).toContainText('%');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('rank-1')).toBeVisible();
});

test('price per tonne is unavailable for both directions', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await page.getByTestId('direction').selectOption('both');
  await page.getByTestId('measure').selectOption('price');
  await expect(page.getByTestId('direction')).toHaveValue('imports');
  await expect(page.getByTestId('rank-1')).toContainText('/t');
});

test('a single month before a year of history still works; trailing 12 clamps', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await page.getByTestId('window').selectOption('month');
  await page.getByTestId('month').fill('0');
  await expect(page.getByTestId('month-label')).toHaveText('Jan 2023');
  await expect(page.getByTestId('rank-1')).toBeVisible();
  await page.getByTestId('window').selectOption('t12');
  await expect(page.getByTestId('month-label')).toHaveText('12 months to Dec 2023');
  await expect(page.getByTestId('rank-1')).toBeVisible();
});

test('a data file that fails to load is named in the error', async ({ page }) => {
  await serveFixtures(page, { fail: 'flows-plate.json' });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('flows-plate.json');
});
