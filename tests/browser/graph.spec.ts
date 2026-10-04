import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openGraph(page: Page) {
  await page.goto('/#workspace');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-card').first()).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.locator('.graph-card').filter({
    has: page.locator('.graph-card-title strong', { hasText: new RegExp(`^${title}$`) }),
  });

test('graph collapses and expands branches and keeps selection behaviour', async ({ page }) => {
  const errors = trackErrors(page);
  await openGraph(page);
  await expect(page.locator('.graph-card')).toHaveCount(5);

  await page.getByRole('button', { name: 'Collapse graph branch /crew', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(3);
  await expect(page.locator('.graph-caption')).toContainText('2 collapsed');
  await page.getByRole('button', { name: 'Expand graph branch /crew', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(5);

  await page.getByRole('button', { name: 'Hide graph card /settings', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Show graph card /settings', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(5);

  await page.getByRole('button', { name: 'Collapse all branches', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand all branches', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(5);

  await page.locator('.graph-card-title').filter({ hasText: 'settings' }).click();
  await expect(page.locator('.path-inspector')).toContainText('$.settings');
  await expect(card(page, 'settings')).toHaveClass(/selected/);

  await page.getByRole('button', { name: 'Show only this branch', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show full graph', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(5);

  const graph = page.getByRole('group', { name: 'Graph', exact: true });
  await graph.focus();
  await page.keyboard.press('Shift+Digit2');
  await page.keyboard.press('Shift+Digit1');
  expect(errors).toEqual([]);
});

test('graph direction toggles and persists', async ({ page }) => {
  await openGraph(page);
  const vertical = page.getByRole('button', { name: 'Vertical layout', exact: true });
  await expect(vertical).toHaveAttribute('aria-pressed', 'false');
  const root = card(page, 'document');
  const crew = card(page, 'crew');
  let [a, b] = [await root.boundingBox(), await crew.boundingBox()];
  await expect
    .poll(async () => {
      [a, b] = [await root.boundingBox(), await crew.boundingBox()];
      return b!.x - (a!.x + a!.width);
    })
    .toBeGreaterThan(0);

  await vertical.click();
  await expect(vertical).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.react-flow__handle-bottom').first()).toBeAttached();
  await expect
    .poll(async () => {
      [a, b] = [await root.boundingBox(), await crew.boundingBox()];
      return b!.y - (a!.y + a!.height);
    })
    .toBeGreaterThan(0);

  await page.reload();
  const graphButton = page.getByRole('button', { name: 'Graph', exact: true });
  await expect(graphButton).toBeVisible();
  if ((await graphButton.getAttribute('aria-pressed')) !== 'true') await graphButton.click();
  await expect(page.getByRole('button', { name: 'Vertical layout', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Minimap', exact: true }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.locator('.react-flow__background')).toHaveCount(0);
});

test('graph exports PNG and SVG images of the whole graph', async ({ page }) => {
  const errors = trackErrors(page);
  await openGraph(page);
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const [png] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download PNG' }).click(),
  ]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile((await png.path())!);
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  // The image covers all cards, not only the visible viewport.
  expect(width).toBeGreaterThan(600);
  expect(height).toBeGreaterThan(200);

  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const [svg] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download SVG' }).click(),
  ]);
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  const text = await readFile((await svg.path())!, 'utf8');
  expect(text).toContain('<svg');
  expect(text).toContain('crew');
  expect(errors).toEqual([]);
});

test('large documents start collapsed and respect the card cap', async ({ page }) => {
  const errors = trackErrors(page);
  const doc = JSON.stringify(
    Array.from({ length: 1000 }, (_, i) => ({ id: i, meta: { tag: `t${i}` } })),
  );
  await page.goto('/#workspace');
  await page.getByLabel('JSON source').fill(doc);
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByText('Large document: deeper branches start collapsed')).toBeVisible();
  const count = await page.locator('.graph-card').count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(300);

  await page.getByRole('button', { name: 'Show graph card /5', exact: true }).click();
  await expect(card(page, '5')).toBeVisible();

  await page.getByRole('button', { name: 'Expand all branches', exact: true }).click();
  await expect(page.getByText('Too many cards to draw at once')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse deeper levels', exact: true }).click();
  await expect(page.getByText('Too many cards to draw at once')).toBeHidden();
  await expect(page.locator('.graph-card')).toHaveCount(1);

  await page.getByRole('button', { name: 'Dismiss note', exact: true }).click();
  await expect(page.getByText('Large document: deeper branches start collapsed')).toBeHidden();
  expect(errors).toEqual([]);
});

test('graph follows the light theme', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => localStorage.setItem('jsonp.theme', '"light"'));
  await openGraph(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const colours = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const cardStyle = getComputedStyle(document.querySelector('.graph-card')!);
    const area = getComputedStyle(document.querySelector('.graph-area')!);
    const probe = document.createElement('div');
    document.body.append(probe);
    probe.style.background = root.getPropertyValue('--panel');
    const panel = getComputedStyle(probe).backgroundColor;
    probe.style.background = root.getPropertyValue('--bg');
    const bg = getComputedStyle(probe).backgroundColor;
    probe.style.color = root.getPropertyValue('--text');
    const text = getComputedStyle(probe).color;
    probe.remove();
    return {
      card: cardStyle.backgroundColor,
      panel,
      area: area.backgroundColor,
      bg,
      text,
      cardText: cardStyle.color,
    };
  });
  expect(colours.card).toBe(colours.panel);
  expect(colours.area).toBe(colours.bg);
  expect(colours.cardText).toBe(colours.text);
  expect(colours.card).toBe('rgb(250, 251, 246)');
  expect(errors).toEqual([]);
});

test('graph refuses duplicate keys gracefully', async ({ page }) => {
  await page.goto('/#workspace');
  await page.getByLabel('JSON source').fill('{"a":{"x":1},"a":{"y":2}}');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.getByText('Duplicate keys need a closer look')).toBeVisible();
});

test('explorer search highlights matching cards and dims the rest', async ({ page }) => {
  await openGraph(page);
  await page.getByLabel('Search paths and values').fill('Alex');
  await expect(page.locator('.graph-caption')).toContainText('1 match');
  await expect(page.locator('.graph-card.match')).toHaveCount(1);
  await expect(page.locator('.graph-row.match')).toHaveCount(1);
  await expect(page.locator('.graph-card.dim')).toHaveCount(4);
  await page.getByLabel('Search paths and values').fill('');
  await expect(page.locator('.graph-card.dim')).toHaveCount(0);
});
