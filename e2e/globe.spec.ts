import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The app is tested against a small synthetic dataset so results do not
// depend on whatever the live data currently contains.
const FIXTURES = path.resolve('tests/fixtures/dataset');

async function serveFixtures(page: Page, opts: { fail?: string } = {}): Promise<void> {
  await page.route('**/data/*.json', (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    if (file === opts.fail || !existsSync(path.join(FIXTURES, file))) return route.abort();
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

test('arcs carry country labels, and each direction keeps at most 20 partners', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await expect(page.locator('.map-label:not([hidden])').first()).toBeVisible();
  await expect(page.locator('.map-label:not([hidden])', { hasText: 'Canada' })).toBeVisible();
  await page.getByTestId('direction').selectOption('both');
  await expect.poll(() => arcCount(page)).toBeGreaterThan(0);
  expect(await arcCount(page)).toBeLessThanOrEqual(40);
});

test('the panel accent matches the arc colours: red for imports, black for exports', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  const bar = () => page.locator('.rank-bar').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(bar).toBe('rgb(214, 40, 40)');
  await page.getByTestId('direction').selectOption('exports');
  await expect.poll(bar).toBe('rgb(17, 17, 17)');
});

test('returning to Supply after opening Customers directly leaves a working globe', async ({ page }) => {
  await serveFixtures(page);
  // Customers data is not served by the fixtures; that load fails, which is
  // irrelevant here, the test is about the globe.
  await page.goto('/?tab=customers');
  await expect(page.locator('#customers')).toBeVisible();
  await page.getByTestId('tab-supply').click();
  await expect(page.locator('#map[data-arc-count]')).toBeVisible();
  expect(await arcCount(page)).toBeGreaterThan(0);
  const box = await page.locator('#map canvas').boundingBox();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
});

test('the Supply panel shows the import-share card for the default product', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');
  await expect(page.getByTestId('import-share')).toBeVisible();
  // Synthetic fixture: 3e8 / (8e8 + 3e8 - 1e8) = 30.0%
  await expect(page.getByTestId('import-share-value')).toHaveText('30.0%');
});
