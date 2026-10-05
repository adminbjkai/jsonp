import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// These scenarios exercise the multi-pane workspace mode.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!location.hash.startsWith('#json=')) localStorage.setItem('jsonp.mode', '"workspace"');
  });
});

const source = (page: Page) => page.getByLabel('JSON source');
const rows = (page: Page) => page.getByLabel('JSON values').getByRole('listitem');
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
async function ready(page: Page) {
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
}
async function tool(page: Page, menu: string, item: string) {
  await page.getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('broken JSON shows its location, repairs losslessly, and undoes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const broken = "// settings\n{\n  name: 'Orbital',\n  big: 9007199254740993,\n  ok: True,\n}";
  await source(page).fill(broken);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Line 1, column 1');
  await expect(alert).toContainText('comments');
  await expect(page.getByLabel('Repair will')).toContainText('Removed 1 comment');
  await page.getByRole('button', { name: 'Go to error' }).click();
  await expect(source(page)).toBeFocused();
  expect(await source(page).evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(0);
  await page.getByRole('button', { name: 'Repair JSON' }).click();
  await ready(page);
  await expect(source(page)).toHaveValue(
    '{\n  "name": "Orbital",\n  "big": 9007199254740993,\n  "ok": true\n}',
  );
  await page.getByLabel('Undo last replacement', { exact: true }).click();
  await expect(source(page)).toHaveValue(broken);
  await expect(page.getByText('Invalid JSON', { exact: true })).toBeVisible();
  await page.getByLabel('Redo', { exact: true }).click();
  await expect(source(page)).toHaveValue(/"big": 9007199254740993/);
  expect(errors).toEqual([]);
});

test('command palette finds and runs actions; menus transform losslessly', async ({ page }) => {
  await page.goto('/');
  await source(page).fill('{"b":null,"a":{"z":1.50,"y":""},"c":[]}');
  await ready(page);
  await page.keyboard.press('Control+k');
  const search = page.getByLabel('Search actions');
  await expect(search).toBeFocused();
  await search.fill('sort keys');
  await expect(page.getByRole('listbox', { name: 'Actions' }).getByRole('option')).toHaveCount(1);
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
  await expect(source(page)).toHaveValue(
    '{\n  "a": {\n    "y": "",\n    "z": 1.50\n  },\n  "b": null,\n  "c": []\n}',
  );
  await tool(page, 'Tools', 'Remove null values');
  await expect(source(page)).not.toHaveValue(/null/);
  await tool(page, 'Tools', 'Remove empty values');
  await expect(source(page)).toHaveValue('{\n  "a": {\n    "z": 1.50\n  }\n}');
  await tool(page, 'Tools', 'Minify');
  await expect(source(page)).toHaveValue('{"a":{"z":1.50}}');
  await tool(page, 'Tools', 'Escape as a JSON string');
  await expect(source(page)).toHaveValue('"{\\"a\\":{\\"z\\":1.50}}"');
  await ready(page);
  await tool(page, 'Tools', 'Unescape JSON string');
  await expect(source(page)).toHaveValue('{\n  "a": {\n    "z": 1.50\n  }\n}');
  await ready(page);
  await page.getByRole('button', { name: 'a Object(1)', exact: true }).click();
  await tool(page, 'Tools', 'Keep only the selected value');
  await expect(source(page)).toHaveValue('{\n  "z": 1.50\n}');
  // Disabled actions stay listed but cannot run.
  await source(page).fill('{bad');
  await page.keyboard.press('Control+k');
  await search.fill('minify');
  await expect(page.getByRole('option', { name: /Minify/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await search.press('Enter');
  await expect(source(page)).toHaveValue('{bad');
});

test('JSONPath queries run from the explorer search and copy results', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await ready(page);
  const find = page.getByLabel('Search paths and values');
  await find.fill('$.crew[*].name');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText('2 query results')).toBeVisible();
  await page.getByLabel('Copy query results as JSON').click();
  expect(JSON.parse(await clipboard(page))).toEqual(['Alex', 'Sam']);
  await find.fill("$.crew[?(@.role == 'Designer')].name");
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().getByRole('button').first().click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.crew[1].name');
  await find.fill('$.crew[');
  await expect(page.locator('.query-error')).toBeVisible();
  await find.fill('Designer');
  await expect(rows(page)).toHaveCount(1);
  // Ctrl+F focuses the explorer search; the help examples run queries.
  // Inside Source, Ctrl+F stays the browser's find; elsewhere it focuses the explorer search.
  await source(page).click();
  await page.keyboard.press('Control+f');
  await expect(find).not.toBeFocused();
  await page.getByLabel('Formatted JSON', { exact: true }).click();
  await page.keyboard.press('Control+f');
  await expect(find).toBeFocused();
  await page.getByLabel('Help and shortcuts').click();
  await page.getByRole('button', { name: /\$\.\.name/ }).click();
  await expect(find).toHaveValue('$..name');
  await expect(rows(page)).toHaveCount(2);
});

test('convert previews and downloads TypeScript, YAML, and CSV from a table', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const preview = page.getByLabel('Converted output');
  await expect(preview).toContainText('export interface Root');
  await expect(preview).toContainText('crew: CrewItem[];');
  await page.getByRole('radio', { name: 'YAML' }).click();
  await expect(preview).toContainText('project: Orbital');
  const yaml = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .yaml' }).click();
  expect(await readFile((await (await yaml).path())!, 'utf8')).toContain('- name: Alex');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(3);
  await table.getByRole('columnheader', { name: 'name', exact: true }).click();
  await table.getByRole('columnheader', { name: 'name', exact: true }).click();
  await expect(table.getByRole('cell').first()).toHaveText('Sam');
  await page.getByLabel('Filter rows').fill('alex');
  await expect(table.getByRole('row')).toHaveCount(2);
  await table.getByRole('cell', { name: 'Engineer' }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.crew[0].role');
  await page.getByLabel('Convert this array to CSV').click();
  await expect(page.getByRole('radio', { name: 'CSV' })).toHaveAttribute('aria-checked', 'true');
  await expect(preview).toHaveText('name,role\r\nAlex,Engineer\r\nSam,Designer\r\n');
});

test('share links, remembered drafts, CSV import, and the welcome guide', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByLabel('Getting started', { exact: true })).toBeVisible();
  await page.getByLabel('Dismiss getting started').click();
  await source(page).fill('{"shared":9007199254740993}');
  await ready(page);
  // Capture the copied link directly; the system clipboard is shared between parallel tests.
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    };
  });
  await tool(page, 'Export', 'Copy share link');
  await expect(page.getByRole('status').filter({ hasText: 'Share link copied' })).toBeVisible();
  const link = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(link).toMatch(/#json=/);
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.getByLabel('JSON source')).toHaveValue('{\n  "shared": 9007199254740993\n}');
  expect(other.url()).not.toContain('#json=');
  await expect(other.getByLabel('Getting started', { exact: true })).toBeHidden();
  // Drafts persist only after opting in.
  await source(page).fill('{"draft":1}');
  await page.reload();
  await expect(source(page)).not.toHaveValue('{"draft":1}');
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search actions').fill('keep my draft');
  await page.keyboard.press('Enter');
  await source(page).fill('{"draft":2}');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(source(page)).toHaveValue('{"draft":2}');
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search actions').fill('stop keeping');
  await page.keyboard.press('Enter');
  await page.reload();
  await expect(source(page)).not.toHaveValue('{"draft":2}');
  // CSV files become JSON with exact numbers.
  await page.locator('#open-file-input').setInputFiles({
    name: 'people.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,id,active\nAda,9007199254740993,true\n"Lee, Jr",007,\n'),
  });
  await expect(source(page)).toHaveValue(
    '[\n  {\n    "name": "Ada",\n    "id": 9007199254740993,\n    "active": true\n  },\n  {\n    "name": "Lee, Jr",\n    "id": "007",\n    "active": null\n  }\n]',
  );
});

test('new dialogs and the table meet accessibility checks', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
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
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await check();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await check();
  await page.keyboard.press('Escape');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByLabel('Use light theme', { exact: true }).click();
    for (const open of [
      () => page.keyboard.press('Control+k'),
      () => page.getByRole('button', { name: 'Convert', exact: true }).click(),
      () => tool(page, 'Tools', 'Validate against a JSON Schema…'),
      () => page.getByLabel('Help and shortcuts').click(),
      () => page.getByRole('button', { name: '16 values' }).click(),
    ]) {
      await open();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(350); // let the opening animation finish before measuring contrast
      await check();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    }
  }
  await source(page).fill('[1,');
  await expect(page.getByRole('alert')).toBeVisible();
  await check();
});
