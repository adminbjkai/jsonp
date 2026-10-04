import { test, expect, type Page } from '@playwright/test';

const URL = '/#compare';
const view = (page: Page) => page.locator('.compare-view');
const side = (page: Page, name: 'Original' | 'Modified') =>
  view(page).getByRole('region', { name, exact: true });
const button = (page: Page, name: string) => view(page).getByRole('button', { name, exact: true });
const position = (page: Page) => view(page).locator('.cmp-position');
async function loadSamples(page: Page) {
  await side(page, 'Original').getByRole('button', { name: 'Load sample' }).click();
  await side(page, 'Modified').getByRole('button', { name: 'Load sample' }).click();
  await expect(side(page, 'Original').getByText('Valid', { exact: true })).toBeVisible();
  await expect(side(page, 'Modified').getByText('Valid', { exact: true })).toBeVisible();
}
async function axe(page: Page) {
  // Move the pointer away and let hover/theme color transitions settle first.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return report.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target),
  }));
}

test('compares the sample pair with aligned rows, navigation, folding, and swap', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(URL);
  await loadSamples(page);
  await button(page, 'Compare').click();
  const diff = view(page).getByRole('region', { name: 'Differences' });
  await expect(diff).toBeVisible();
  const counts = view(page).locator('.cmp-counts');
  await expect(counts).toContainText('+8');
  await expect(counts).toContainText('−1');
  await expect(counts).toContainText('~4');
  await expect(view(page).locator('.cmp-structural')).toHaveText(
    '2 changed values · 2 added · 1 removed · 2 type changed',
  );
  // Rows carry accessible text; the inserted crew member is one added run.
  await expect(diff.getByText('line 2 removed: "budget": 120000,')).toBeAttached();
  await expect(diff.getByText('line 8 added: "name": "Riley",')).toBeAttached();
  await expect(
    diff.getByText(
      'line 20 changed: "nextLaunch": null, — now line 23: "nextLaunch": "2026-11-04",',
    ),
  ).toBeAttached();
  await expect(diff.locator('mark.cmp-char-add', { hasText: '2026-11-04' })).toBeVisible();

  // Previous / next difference, buttons and keys.
  await expect(position(page)).toHaveText('1 of 5');
  await view(page).getByRole('button', { name: 'Next difference' }).click();
  await expect(position(page)).toHaveText('2 of 5');
  await view(page).getByRole('button', { name: 'Previous difference' }).click();
  await expect(position(page)).toHaveText('1 of 5');
  await diff.focus();
  await page.keyboard.press('F7');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(position(page)).toHaveText('3 of 5');
  await page.keyboard.press('Shift+F7');
  await expect(position(page)).toHaveText('2 of 5');

  // Only changes folds the long unchanged run and expands it on click.
  await button(page, 'Only changes').click();
  await expect(button(page, 'Only changes')).toHaveAttribute('aria-pressed', 'true');
  const fold = diff.getByRole('button', { name: '5 unchanged lines' });
  await expect(fold).toBeVisible();
  await expect(diff.getByText(/"elevationMeters": 14/)).toHaveCount(0);
  await fold.click();
  await expect(fold).toHaveCount(0);
  await expect(diff.getByText('line 15 unchanged: "elevationMeters": 14,')).toBeAttached();

  // Structural changes list jumps to and flashes the row.
  const changes = view(page).getByRole('complementary', { name: /Changes/ });
  if (!(await changes.isVisible())) await button(page, 'Changes').click();
  await changes.getByRole('button', { name: /Removed \$\.budget/ }).click();
  await expect(diff.locator('.cmp-row.is-flash')).toContainText('"budget": 120000');

  // The report lists structural changes with JSONPath strings.
  await button(page, 'Copy report').click();
  const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(report.summary).toEqual({ added: 2, removed: 1, changed: 2, type: 2 });
  expect(report.changes[0]).toEqual({ kind: 'removed', path: '$.budget', before: '120000' });

  // Swapping sides reverses additions and removals.
  await button(page, 'Swap sides').click();
  await expect(counts).toContainText('+1');
  await expect(counts).toContainText('−8');
  await expect(view(page).locator('.cmp-structural')).toHaveText(
    '2 changed values · 1 added · 2 removed · 2 type changed',
  );
  await button(page, 'Edit').click();
  await expect(side(page, 'Original').getByLabel('Original JSON')).toHaveValue(/"launched"/);
  expect(errors).toEqual([]);
});

test('sort keys hides key-order-only differences; invalid sides explain and repair', async ({
  page,
}) => {
  await page.goto(URL);
  const original = page.getByLabel('Original JSON'),
    modified = page.getByLabel('Modified JSON');
  await original.fill('{"a": 1, "b": [1, 2]}');
  await modified.fill('{"b": [1, 2], "a": 1}');
  await modified.press('Control+Enter');
  await expect(view(page).getByText('No differences — the documents are equivalent')).toBeVisible();
  await expect(view(page).getByText(/Only the order of object keys differs/)).toBeVisible();
  await expect(button(page, 'Sort keys')).toHaveAttribute('aria-pressed', 'true');
  await button(page, 'Sort keys').click();
  await expect(view(page).getByRole('region', { name: 'Differences' })).toBeVisible();
  await expect(view(page).locator('.cmp-structural')).toContainText('equivalent');
  await button(page, 'Sort keys').click();
  await expect(view(page).getByText('No differences — the documents are equivalent')).toBeVisible();

  await button(page, 'Edit').click();
  await modified.fill("{name: 'Orbital',}");
  const problem = side(page, 'Modified').getByRole('alert');
  await expect(problem).toHaveText(/^Line 1, column 2: /);
  await expect(side(page, 'Modified').getByText('Invalid', { exact: true })).toBeVisible();
  await button(page, 'Compare').click();
  await expect(view(page).locator('.cmp-message')).toContainText('Fix the Modified side first');
  await expect(view(page).getByRole('region', { name: 'Differences' })).toHaveCount(0);
  await side(page, 'Modified').getByRole('button', { name: 'Repair' }).click();
  await expect(modified).toHaveValue('{\n  "name": "Orbital"\n}');
  await expect(side(page, 'Modified').getByText('Valid', { exact: true })).toBeVisible();
  // Without clipboard permission, Paste explains the keyboard alternative.
  await side(page, 'Original').getByRole('button', { name: 'Paste' }).click();
  await expect(page.getByText(/Clipboard access was blocked/)).toBeVisible();
  await original.fill('');
  await button(page, 'Compare').click();
  await expect(view(page).locator('.cmp-message')).toContainText('Add JSON to the Original side');
});

test('compare passes axe and fits a phone screen', async ({ page }) => {
  await page.goto(URL);
  await loadSamples(page);
  expect(await axe(page)).toEqual([]);
  await button(page, 'Compare').click();
  await expect(view(page).getByRole('region', { name: 'Differences' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await button(page, 'Only changes').click();
  expect(await axe(page)).toEqual([]);
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  expect(await axe(page)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await button(page, 'Edit').click();
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const [a, b] = await Promise.all([
    side(page, 'Original').boundingBox(),
    side(page, 'Modified').boundingBox(),
  ]);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  await button(page, 'Compare').click();
  const diff = view(page).getByRole('region', { name: 'Differences' });
  await expect(diff).toBeVisible();
  // Unified rows: a modified line shows as an old and a new line. Rows are virtualized, so
  // scroll to the end of the short phone viewport first.
  await diff.evaluate((el) => {
    const scroller = [el, ...el.querySelectorAll<HTMLElement>('*')].find(
      (node) => node.scrollHeight > node.clientHeight + 4,
    );
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(diff.getByText('line 20 changed: "nextLaunch": null,')).toBeAttached();
  await expect(diff.getByText('now line 23: "nextLaunch": "2026-11-04",')).toBeAttached();
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await axe(page)).toEqual([]);
});
