import { test, expect, type Page } from '@playwright/test';

const source = (page: Page) => page.getByLabel('JSON source');
const output = (page: Page) => page.getByLabel('Formatted JSON', { exact: true });
const actions = (page: Page) => page.getByRole('navigation', { name: 'Formatter actions' });
async function ready(page: Page) {
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
}

test('new visitors land in the simple formatter and can switch modes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await ready(page);
  await expect(page).toHaveURL(/#format$/);
  await expect(page.getByRole('link', { name: 'Format' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Getting started', { exact: true })).toBeVisible();
  await expect(actions(page).getByRole('button', { name: 'Beautify' })).toBeVisible();
  await page.getByRole('link', { name: 'Workspace' }).click();
  await expect(page).toHaveURL(/#workspace$/);
  await expect(page.getByRole('region', { name: 'Workspace actions' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.goto('/#format');
  await expect(actions(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('beautify, minify, tabs, validate, repair, and use output as input', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  await source(page).fill('{"a":[1,{"b":9007199254740993}]}');
  await ready(page);
  await expect(output(page)).toContainText('"b": 9007199254740993');
  await actions(page).getByRole('button', { name: 'Minify' }).click();
  await expect(output(page)).toContainText('{"a":[1,{"b":9007199254740993}]}');
  await actions(page).getByRole('button', { name: 'Beautify' }).click();
  await actions(page).getByLabel('Indentation').selectOption('tab');
  await expect(output(page).locator('.code-line').nth(1)).toHaveText(/^2\t"a": \[$/);
  await actions(page).getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Valid JSON · 5 values' })).toBeVisible();
  await page.getByLabel('Use the output as input').click();
  await expect(source(page)).toHaveValue(
    '{\n\t"a": [\n\t\t1,\n\t\t{\n\t\t\t"b": 9007199254740993\n\t\t}\n\t]\n}',
  );
  await source(page).fill("{a: 'x',}");
  await expect(page.getByText('Invalid JSON', { exact: true })).toBeVisible();
  await actions(page).getByRole('button', { name: 'Validate' }).click();
  await expect(source(page)).toBeFocused();
  await actions(page).getByRole('button', { name: 'Repair' }).click();
  await ready(page);
  await expect(source(page)).toHaveValue('{\n  "a": "x"\n}');
});

test('output switches between code, tree, table, and graph views', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  const tabs = page.getByRole('tablist', { name: 'Output view' });
  await tabs.getByRole('tab', { name: 'Tree' }).click();
  await expect(page.getByLabel('JSON values').getByRole('treeitem').first()).toBeVisible();
  await page.getByLabel('Search paths and values').fill('$.crew[*].name');
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(2);
  await tabs.getByRole('tab', { name: 'Table' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Graph' }).click();
  await expect(page.locator('.graph-card').first()).toBeVisible();
  await tabs.getByRole('tab', { name: 'Code' }).click();
  await expect(output(page)).toBeVisible();
  // The chosen view survives a reload within the session.
  await tabs.getByRole('tab', { name: 'Table' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
});

test('convert menu opens the requested format', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  await actions(page).getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('menuitem', { name: 'YAML', exact: true }).click();
  await expect(page.getByLabel('Converted output')).toContainText('project: Orbital');
  await page.keyboard.press('Escape');
  await actions(page).getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('menuitem', { name: 'Go', exact: true }).click();
  await expect(page.getByLabel('Converted output')).toContainText('type Root struct');
});

test('formatter is accessible and fits phones', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.goto('/#format');
  await ready(page);
  const check = async () => {
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      report.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  };
  await check();
  await page.getByLabel('Use light theme', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.waitForTimeout(400); // let color transitions settle before measuring contrast
  await check();
  await page.setViewportSize({ width: 390, height: 844 });
  await check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(actions(page).getByRole('button', { name: 'Beautify' })).toBeVisible();
});

test('YAML, XML, and Excel files import as JSON; pasted YAML converts', async ({ page }) => {
  const { writeXlsx } = await import('hucre/xlsx');
  await page.goto('/#format');
  await ready(page);
  await page.locator('#open-file-input').setInputFiles({
    name: 'config.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from('name: Orbital\nid: 9007199254740993\ntags:\n  - a\n  - b\n'),
  });
  await expect(source(page)).toHaveValue(
    '{\n  "name": "Orbital",\n  "id": 9007199254740993,\n  "tags": [\n    "a",\n    "b"\n  ]\n}',
  );
  await page.locator('#open-file-input').setInputFiles({
    name: 'feed.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<feed lang="en"><item>1</item><item>2</item></feed>'),
  });
  await expect(source(page)).toHaveValue(/"@lang": "en"/);
  await expect(source(page)).toHaveValue(/"item": \[\s+"1",\s+"2"\s+\]/);
  const workbook = await writeXlsx({
    sheets: [
      {
        name: 'People',
        rows: [
          ['name', 'age'],
          ['Ada', 36],
          ['Lin', 41],
        ],
      },
    ],
  });
  await page.locator('#open-file-input').setInputFiles({
    name: 'people.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(workbook),
  });
  await expect(source(page)).toHaveValue(/"name": "Ada",\s+"age": 36/);
  await source(page).fill('server:\n  host: example.org\n  port: 8080\n');
  await page.getByRole('button', { name: 'Convert YAML to JSON' }).click();
  await ready(page);
  await expect(source(page)).toHaveValue(/"port": 8080/);
});

test('schema validation generates, validates, and points at problems', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  await actions(page).getByRole('button', { name: 'Schema' }).click();
  const dialog = page.getByRole('dialog', { name: /JSON Schema/ });
  await dialog.getByRole('button', { name: 'Generate from document' }).click();
  await dialog.getByRole('button', { name: 'Validate' }).click();
  await expect(dialog.getByText('The document matches the schema')).toBeVisible();
  await dialog
    .getByLabel('JSON Schema')
    .fill('{"type":"object","properties":{"version":{"type":"string"}},"required":["owner"]}');
  await dialog.getByRole('button', { name: 'Validate' }).click();
  await expect(dialog.getByText('2 problems')).toBeVisible();
  await dialog.getByRole('button', { name: '$.version' }).click();
  await expect(dialog).toBeHidden();
});

test('Ctrl+Enter in compare mode compares instead of formatting the main document', async ({
  page,
}) => {
  await page.goto('/#format');
  await ready(page);
  await source(page).fill('{"keep":   "spacing"}');
  await ready(page);
  await page.getByRole('link', { name: 'Compare' }).click();
  const samples = page.getByRole('button', { name: 'Load sample' });
  await expect(samples).toHaveCount(2);
  await samples.nth(0).click();
  await samples.nth(1).click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('region', { name: 'Differences' })).toBeVisible();
  await page.getByRole('link', { name: 'Format' }).click();
  await expect(source(page)).toHaveValue('{"keep":   "spacing"}');
});

test('Ctrl+F focuses Find from any output view without changing it', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  await page.getByRole('tab', { name: 'Table' }).click();
  await actions(page).getByRole('button', { name: 'Validate' }).focus();
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Search paths and values')).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'true');
});

test('a share link pasted into an open tab loads, and a bad saved mode falls back', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => localStorage.setItem('jsonp.mode', '"nonsense"'));
  await page.goto('/');
  await ready(page);
  await expect(page).toHaveURL(/#format$/);
  await source(page).fill('{"shared":true}');
  await ready(page);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    };
  });
  await actions(page).getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Copy share link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Share link copied' })).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  await source(page).fill('{"other":1}');
  await ready(page);
  await page.evaluate((hash) => (location.hash = hash), new URL(link).hash);
  await expect(source(page)).toHaveValue('{\n  "shared": true\n}');
  await expect(page).toHaveURL(/#format$/);
});

test.describe('system theme', () => {
  test.use({ colorScheme: 'light' });
  test('a first visit follows the system theme until a choice is made', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Without a saved choice the page keeps following the system setting.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('Use light theme', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // A saved choice wins over the system, now and after a reload.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
  test('an unreadable saved theme falls back to the system theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('jsonp.theme', '{not json'));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test('expanding a pane keeps the actions and gives it the room', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#format');
  await ready(page);
  const width = async (name: string) =>
    (await page.getByLabel(name, { exact: true }).first().boundingBox())!.width;
  await page.getByLabel('Expand output', { exact: true }).click();
  expect(await width('Output')).toBeGreaterThan(900);
  await expect(actions(page).getByRole('button', { name: 'Beautify' })).toBeVisible();
  await expect(page.getByLabel('Input', { exact: true })).toBeHidden();
  await page.getByLabel('Restore layout', { exact: true }).click();
  expect(await width('Input')).toBeGreaterThan(400);
  await page.getByLabel('Expand input', { exact: true }).click();
  expect(await width('Input')).toBeGreaterThan(900);
  await expect(actions(page).getByRole('button', { name: 'Beautify' })).toBeVisible();
  await page.getByLabel('Restore layout', { exact: true }).click();
  expect(await width('Output')).toBeGreaterThan(400);
});

for (const [width, height] of [
  [1366, 768],
  [1000, 700],
  [1280, 560],
  [1024, 420],
]) {
  for (const welcomed of [false, true]) {
    test(`action menus fit a ${width}x${height} window${welcomed ? '' : ' with the first-visit banner'}`, async ({
      page,
    }) => {
      if (welcomed) await page.addInitScript(() => localStorage.setItem('jsonp.welcomed', 'true'));
      await page.setViewportSize({ width, height });
      await page.goto('/#format');
      await ready(page);
      for (const name of ['Export', 'Convert']) {
        await actions(page).getByRole('button', { name, exact: true }).click();
        const menu = page.getByRole('menu', { name });
        const box = (await menu.boundingBox())!;
        expect(box.y, `${name} top`).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(height);
        expect(box.x + box.width, `${name} right`).toBeLessThanOrEqual(width);
        // Every item must be reachable by pointer: the first as shown, the last after scrolling.
        const reachable = (item: ReturnType<typeof menu.getByRole>) =>
          item.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return !!hit?.closest('[role=menuitem]');
          });
        const items = menu.getByRole('menuitem');
        expect(await reachable(items.first()), `${name} first item`).toBe(true);
        await items.last().scrollIntoViewIfNeeded();
        expect(await reachable(items.last()), `${name} last item`).toBe(true);
        await page.keyboard.press('Escape');
      }
    });
  }
}

test('the output heading does not overlap at 1000px', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/#format');
  await ready(page);
  const heading = (await page
    .getByLabel('Output', { exact: true })
    .locator('.pane-heading')
    .boundingBox())!;
  expect(heading.height).toBeLessThan(56);
});

test('the split between input and output moves with the keyboard and resets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#format');
  await ready(page);
  const handle = page.getByRole('separator', { name: 'Resize input and output' });
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '53');
  const input = (await page.getByLabel('Input', { exact: true }).boundingBox())!.width;
  const output = (await page.getByLabel('Output', { exact: true }).boundingBox())!.width;
  expect(input).toBeGreaterThan(output);
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Resize input and output' })).toHaveAttribute(
    'aria-valuenow',
    '53',
  );
  await page.getByRole('separator', { name: 'Resize input and output' }).dblclick();
  await expect(page.getByRole('separator', { name: 'Resize input and output' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
});

test('every replacement offers Undo, and a newer message replaces the offer', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  const toast = page.getByRole('status').filter({ hasText: 'Source cleared' });
  await page.getByLabel('Clear source', { exact: true }).click();
  await expect(toast).toBeVisible();
  await expect(source(page)).toHaveValue('');
  await page.waitForTimeout(600); // an action ignores clicks for a moment, so a double-click cannot chain
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(source(page)).not.toHaveValue('');
  await expect(
    page.getByRole('status').filter({ hasText: 'Undone' }).getByRole('button', { name: 'Redo' }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole('status').getByRole('button', { name: 'Redo' }).click();
  await expect(source(page)).toHaveValue('');
  // Loading the sample is a replacement too.
  await page.getByRole('button', { name: 'Try the sample' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sample loaded' })).toBeVisible();
  // A newer replacement takes over the message, so an old Undo cannot revert the wrong change.
  await source(page).fill('{"b":1}');
  await actions(page).getByRole('button', { name: 'Minify' }).click();
  await ready(page);
  await page.keyboard.press('Control+Enter');
  const formatted = page.getByRole('status').filter({ hasText: 'Source formatted' });
  await expect(formatted).toBeVisible();
  await page.getByLabel('Clear source', { exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Source cleared' })).toBeVisible();
  await expect(formatted).toBeHidden();
});

test('pages have a heading and Compare has a main landmark', async ({ page }) => {
  for (const mode of ['format', 'workspace', 'compare']) {
    await page.goto(`/#${mode}`);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'JSON Prettify' })).toBeAttached();
    await expect(page.getByRole('main')).toHaveCount(1);
  }
});

const BRANCHES = '{"a":{"name":"x"},"b":{"name":"y"},"c":[{"name":"z"}],"note":"a name inside"}';
const pathChip = (page: Page) => page.locator('.selected-path-copy code');

test('Find steps through every match and always shows its exact path (Format)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#format');
  await ready(page);
  await source(page).fill(BRANCHES);
  await ready(page);
  const find = page.getByLabel('Search paths and values');
  // The same key under different branches: each step names the branch it is in.
  await find.fill('name');
  await expect(page.getByRole('status').filter({ hasText: '1 of 4 matches' })).toBeVisible();
  const highlighted = output(page).locator('.code-line.highlighted');
  const stops: [string, string][] = [
    ['$.a.name', '"name": "x"'],
    ['$.b.name', '"name": "y"'],
    ['$.c[0].name', '"name": "z"'],
  ];
  for (const [index, [path, line]] of stops.entries()) {
    if (index) await find.press('Enter');
    await expect(pathChip(page)).toHaveText(path);
    await expect(highlighted).toContainText(line);
    await expect(page.locator('.path-value')).toHaveText(line.slice(-2, -1));
  }
  // Wraps past the end and steps back with Shift+Enter, in value text too.
  await find.press('Enter');
  await expect(pathChip(page)).toHaveText('$.note');
  await find.press('Enter');
  await expect(pathChip(page)).toHaveText('$.a.name');
  await find.press('Shift+Enter');
  await expect(pathChip(page)).toHaveText('$.note');
  await page.getByLabel('Previous match').click();
  await expect(pathChip(page)).toHaveText('$.c[0].name');
  // Copy the path in other formats, or the value.
  await page.getByRole('button', { name: 'Copy as' }).click();
  await page.getByRole('menuitem', { name: 'JSON Pointer' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/c/0/name');
  await page.getByRole('button', { name: 'Copy as' }).click();
  await page.getByRole('menuitem', { name: 'Value', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"z"');
  await page.getByRole('button', { name: 'Copy as' }).click();
  await page.getByRole('menuitem', { name: 'Path and value' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('$.c[0].name = "z"');
  // A path fragment finds the values under it; Escape clears the search.
  await find.fill('c/0');
  // The selected value is one of the matches, so refining the search keeps it in place.
  await expect(page.getByRole('status').filter({ hasText: '2 of 2 matches' })).toBeVisible();
  await expect(pathChip(page)).toHaveText('$.c[0].name');
  await find.press('Shift+Enter');
  await expect(pathChip(page)).toHaveText('$.c[0]');
  await find.press('Escape');
  await expect(find).toHaveValue('');
});

test('JSONPath queries step through results the same way in the graph', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  await source(page).fill(BRANCHES);
  await ready(page);
  await page.getByRole('tab', { name: 'Graph' }).click();
  const find = page.getByLabel('Search paths and values');
  await find.fill('$..name');
  await expect(page.getByRole('status').filter({ hasText: '1 of 3 query results' })).toBeVisible();
  await expect(pathChip(page)).toHaveText('$.a.name');
  await find.press('Enter');
  await expect(pathChip(page)).toHaveText('$.b.name');
  await expect(page.locator('.graph-row.active')).toContainText('y');
  await find.press('Enter');
  await expect(pathChip(page)).toHaveText('$.c[0].name');
  // Clicking a value in the graph shows its path as well.
  await page.getByLabel('Fit graph').click();
  await page.waitForTimeout(700); // the view glides to fit before it settles
  await page.locator('.graph-row-select[title="name: x"]').click();
  await expect(pathChip(page)).toHaveText('$.a.name');
});
