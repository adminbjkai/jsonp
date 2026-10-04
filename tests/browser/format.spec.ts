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
  await expect(page.getByLabel('JSON values').getByRole('listitem').first()).toBeVisible();
  await page.getByLabel('Search paths and values').fill('$.crew[*].name');
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(2);
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

test('Ctrl+F opens the tree search from any output view', async ({ page }) => {
  await page.goto('/#format');
  await ready(page);
  await page.getByRole('tab', { name: 'Table' }).click();
  await actions(page).getByRole('button', { name: 'Validate' }).focus();
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Search paths and values')).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Tree' })).toHaveAttribute('aria-selected', 'true');
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
