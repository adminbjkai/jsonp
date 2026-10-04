import { test, expect } from '@playwright/test';
import { readXlsx, parseCellRef, rangeRef } from 'hucre/xlsx';
import type { Workbook } from 'hucre/xlsx';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

// These scenarios exercise the multi-pane workspace mode.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!location.hash.startsWith('#json=')) localStorage.setItem('jsonp.mode', '"workspace"');
  });
});

const readWorkbook = async (path: string | null) => readXlsx(await readFile(path!));
const names = (workbook: Workbook) => workbook.sheets.map((sheet) => sheet.name);
const sheet = (workbook: Workbook, name: string) =>
  workbook.sheets.find((item) => item.name === name)!;
const cellAt = (workbook: Workbook, name: string, ref: string) => {
  const { row, col } = parseCellRef(ref);
  return sheet(workbook, name).rows[row]?.[col];
};
const usedRange = (workbook: Workbook, name: string) => {
  const { rows } = sheet(workbook, name);
  return rangeRef(0, 0, rows.length - 1, rows[0].length - 1);
};
const allRows = (workbook: Workbook) => JSON.stringify(workbook.sheets.map((item) => item.rows));

async function openExcel(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excel IRD workbook…' }).click();
}

test('formats accurately, selects escaped paths, searches, exports, and handles errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page
    .getByLabel('JSON source')
    .fill('{"a/b":{"0":9007199254740993},"kind":"Object","nil":null}');
  await expect(page.getByText('5 values', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '0 9007199254740993', exact: true }).click();
  await expect(page.locator('.path-inspector')).toContainText('/a~1b/0');
  await expect(page.locator('.path-inspector')).toContainText('$["a/b"]["0"]');
  const range = await page
    .getByLabel('JSON source')
    .evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(range).toBe('9007199254740993');
  await page.getByLabel('Search paths and values').fill('nil');
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Search paths and values').fill('');
  await page.getByLabel('Collapse all', { exact: true }).click();
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Expand all', { exact: true }).click();
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(5);
  const jsonDownload = page.waitForEvent('download');
  await page.getByLabel('Download JSON', { exact: true }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe('formatted.json');
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await json.path())!, 'utf8')).toContain('9007199254740993');
  await page.getByLabel('Export mapping to Excel', { exact: true }).click();
  await page.getByRole('radio', { name: /^Mapping with samples/ }).check();
  const excelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click();
  const excel = await excelDownload;
  const workbook = await readWorkbook(await excel.path());
  expect(names(workbook)).toEqual(['Data_Mapping_IRD']);
  expect(cellAt(workbook, 'Data_Mapping_IRD', 'D4')).toBe('9007199254740993');
  await page.getByLabel('JSON source').fill('{oops');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Download JSON', { exact: true })).toBeDisabled();
  await page.getByLabel('JSON source').fill('true');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('graph loads on demand; layout controls and shortcuts work', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(5);
  await page.getByLabel('Focus Graph', { exact: true }).click();
  await expect(page.locator('[data-pane=graph]')).toBeVisible();
  await expect(page.locator('[data-pane=input]')).toBeHidden();
  await page.getByLabel('Restore workspace', { exact: true }).click();
  const sourceHeader = page.locator('[data-pane=input] .pane-title');
  const outputHeader = page.locator('[data-pane=output] .pane-title');
  await outputHeader.dragTo(sourceHeader);
  await expect(page.locator('[data-pane]').first()).toHaveAttribute('data-pane', 'output');
  const sourcePane = page.locator('[data-pane=input]');
  const beforeWidth = (await sourcePane.boundingBox())!.width;
  const divider = await page.getByLabel('Resize Source', { exact: true }).boundingBox();
  await page.mouse.move(divider!.x + 3, divider!.y + 20);
  await page.mouse.down();
  await page.mouse.move(divider!.x + 43, divider!.y + 20);
  await page.mouse.up();
  expect((await sourcePane.boundingBox())!.width).toBeGreaterThan(beforeWidth);
  await page.getByLabel('Reset layout', { exact: true }).click();
  await expect(page.locator('[data-pane]').first()).toHaveAttribute('data-pane', 'input');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.locator('.graph-card-title').filter({ hasText: 'settings' }).click();
  await expect(page.locator('.path-inspector')).toContainText('$.settings');
  await page.getByLabel('Close graph', { exact: true }).click();
  await page.getByLabel('Collapse Explorer', { exact: true }).click();
  await page.getByRole('button', { name: 'Expand Explorer' }).click();
  await page.getByLabel('Help and shortcuts', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Indentation').selectOption('0');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await expect(page.getByLabel('JSON source')).not.toHaveValue(/\n/);
  await page.getByLabel('Undo last replacement', { exact: true }).click();
  await expect(page.getByLabel('JSON source')).toHaveValue(/\n/);
  expect(requests.filter((url) => /googleapis|fonts.gstatic|generativelanguage/.test(url))).toEqual(
    [],
  );
});

test('mobile panes and theme remain usable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await expect(page.getByLabel('JSON source')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Explorer' }).click();
  await expect(page.getByLabel('Search paths and values')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Formatted' }).click();
  await expect(page.getByLabel('Formatted JSON', { exact: true })).toBeVisible();
  await page.getByLabel('Use light theme', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('large documents stay virtualized and outdated results cannot overwrite edits', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('JSON source')
    .fill(JSON.stringify(Array.from({ length: 5000 }, (_, id) => ({ id, text: `record ${id}` }))));
  await expect(page.getByText('15,001 values', { exact: true })).toBeVisible();
  expect(await page.getByLabel('JSON values').getByRole('listitem').count()).toBeLessThan(100);
  expect(await page.locator('.code-line').count()).toBeLessThan(100);
  await page.getByLabel('Search paths and values').fill('record 4999');
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('JSON source').fill('{"latest":true}');
  await expect(page.getByText('2 values', { exact: true })).toBeVisible();
  await page.getByLabel('Search paths and values').fill('');
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(2);
});

test('file import, keyboard formatting, source reset, and root copy work', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('#open-file-input').setInputFiles({
    name: 'example.json',
    mimeType: 'application/json',
    buffer: Buffer.from('\uFEFF{"01":42,"":"yes"}'),
  });
  await expect(page.getByText('3 values', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'document Object(2)', exact: true }).click();
  await page.getByLabel('Copy Pointer', { exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('');
  await page.getByLabel('JSON source').press('Control+Enter');
  await expect(page.getByLabel('JSON source')).toHaveValue('{\n  "01": 42,\n  "": "yes"\n}');
  await page.getByLabel('Clear source', { exact: true }).click();
  await expect(page.getByText('Empty document', { exact: true })).toBeVisible();
  await page.getByLabel('Undo last replacement', { exact: true }).click();
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
});

test('desktop and mobile themes meet accessibility checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByLabel('Use light theme', { exact: true }).click();
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      report.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await openExcel(page);
    const modal = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      modal.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: 'Close export', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByLabel('Focus Graph', { exact: true }).click();
  await expect(page.locator('.graph-card')).toHaveCount(5);
  const graph = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    graph.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.getByLabel('Close graph', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    mobile.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test('clean and blank IRD workbooks omit sample data and keep the sample export separate', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByLabel('JSON source')
    .fill(
      '{"crew":[{"name":"SAMPLE_SECRET_ONE","score":123},{"name":"SAMPLE_SECRET_TWO","score":456}]}',
    );
  await expect(page.getByText('8 values', { exact: true })).toBeVisible();
  await openExcel(page);
  await expect(page.getByRole('radio', { name: /^IRD mapping template/ })).toBeChecked();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^IRD_Mapping_Template_/);
  const workbook = await readWorkbook(await file.path());
  expect(names(workbook)).toEqual(['Overview', 'Field Mapping', 'Instructions']);
  expect(allRows(workbook)).not.toContain('SAMPLE_SECRET');
  const [header, ...body] = sheet(workbook, 'Field Mapping').rows;
  const rows = body.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i]])));
  expect(rows.map((row) => row['Source JSONPath'])).toEqual([
    '$.crew',
    '$.crew[*].name',
    '$.crew[*].score',
  ]);
  expect(rows[0]['Target Field / Path']).toBe('');
  expect(sheet(workbook, 'Field Mapping').autoFilter).toEqual({ range: 'A1:L4' });
  expect(cellAt(workbook, 'Field Mapping', 'A1')).toBe('Mapping ID');
  await page.getByLabel('Clear source', { exact: true }).click();
  await expect(page.getByText('Empty document', { exact: true })).toBeVisible();
  await openExcel(page);
  await expect(page.getByRole('radio', { name: /^IRD mapping template/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /^Blank IRD template/ })).toBeChecked();
  const blankDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click();
  const blankFile = await blankDownload;
  expect(blankFile.suggestedFilename()).toMatch(/^IRD_Blank_Template_/);
  const blank = await readWorkbook(await blankFile.path());
  expect(usedRange(blank, 'Field Mapping')).toBe('A1:L31');
  expect(cellAt(blank, 'Field Mapping', 'C2')).toBe('');
});

test('inline paths, breadcrumbs, filtered navigation, and source reveal work', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await expect(page.locator('.inline-path').filter({ hasText: '$.settings.theme' })).toBeVisible();
  await page.getByRole('button', { name: 'theme #b5d68b', exact: true }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.settings.theme');
  await page.getByLabel('Copy current JSONPath', { exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('$.settings.theme');
  await page
    .getByRole('navigation', { name: 'Selected value ancestors' })
    .getByRole('button', { name: 'settings', exact: true })
    .click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.settings');
  await page.getByLabel('Search paths and values').fill('$.crew[0].name');
  await expect(page.getByLabel('JSON values').getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '/crew/0/name Alex', exact: true }).click();
  await page.getByRole('button', { name: 'Copy value', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"Alex"');
  await page.getByLabel('Path display format').selectOption('pointer');
  await expect(page.locator('.inline-path')).toHaveText('/crew/0/name');
  await page.getByLabel('Clear path search', { exact: true }).click();
  await page.getByLabel('Next value', { exact: true }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.crew[0].role');
  await page.getByLabel('Path navigation', { exact: true }).press('ArrowUp');
  await expect(page.locator('.selected-path-copy')).toContainText('$.crew[0].name');
  await page.getByLabel('Path navigation', { exact: true }).press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/crew/0/name');
  await page.getByLabel('Path navigation', { exact: true }).press('Control+Shift+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('\"Alex\"');
  await page.getByRole('button', { name: 'Go to source', exact: true }).click();
  await expect(page.getByLabel('JSON source')).toBeFocused();
  const range = await page
    .getByLabel('JSON source')
    .evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(range).toBe('"Alex"');
  await page.getByLabel('Path navigation', { exact: true }).press('End');
  await expect(page.locator('.selected-path-copy')).toContainText('$.nextLaunch');
  await page.getByLabel('Path navigation', { exact: true }).press('Home');
  await expect(page.locator('.selected-path-copy code')).toHaveText('$');
});

test('mobile source jump opens the editor from the explorer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Workspace panes' })
    .getByRole('button', { name: 'Explorer' })
    .click();
  await page.getByLabel('Search paths and values').fill('refreshInterval');
  await page.getByRole('button', { name: '/settings/refreshInterval 30', exact: true }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.settings.refreshInterval');
  await page.getByRole('button', { name: 'Go to source', exact: true }).click();
  await expect(page.getByLabel('JSON source')).toBeVisible();
  await expect(page.getByLabel('JSON source')).toBeFocused();
});

test('known target and completed mapping downloads share a schema and ignore the editor', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('JSON source').fill('{"private":"EDITOR_SECRET_EXCLUDED"}');
  await openExcel(page);
  await page.getByRole('radio', { name: /^Known-target worked example/ }).check();
  const targetDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download target XLSX', exact: true }).click();
  const target = await targetDownload;
  expect(target.suggestedFilename()).toMatch(/^Orbital_Target_Example_/);
  const workbook = await readWorkbook(await target.path());
  expect(names(workbook)).toEqual([
    'Overview',
    'Target Fields',
    'Projects',
    'Crew',
    'Source JSON',
    'Instructions',
  ]);
  expect(cellAt(workbook, 'Projects', 'C2')).toBe('READY');
  expect(cellAt(workbook, 'Projects', 'G2')).toBe(2);
  expect(cellAt(workbook, 'Projects', 'H2')).toBe('');
  expect(cellAt(workbook, 'Crew', 'C2')).toBe('ENGINEER');
  const mappingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download completed IRD', exact: true }).click();
  const mapping = await mappingDownload;
  expect(mapping.suggestedFilename()).toMatch(/^Orbital_Completed_IRD_/);
  const completed = await readWorkbook(await mapping.path());
  expect(usedRange(completed, 'Field Mapping')).toBe('A1:L12');
  expect(cellAt(completed, 'Field Mapping', 'E12')).toBe('Crew.role_code');
  expect(sheet(completed, 'Target Fields')).toEqual(sheet(workbook, 'Target Fields'));
  expect(allRows(completed)).not.toContain('EDITOR_SECRET_EXCLUDED');
  expect(allRows(workbook)).not.toContain('EDITOR_SECRET_EXCLUDED');
  await page.getByLabel('JSON source').fill('invalid');
  await openExcel(page);
  await page.getByRole('radio', { name: /^Known-target worked example/ }).check();
  await expect(
    page.getByRole('button', { name: 'Download target XLSX', exact: true }),
  ).toBeEnabled();
  const emptyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download completed IRD', exact: true }).click();
  const empty = await readWorkbook(await (await emptyDownload).path());
  expect(sheet(empty, 'Field Mapping')).toEqual(sheet(completed, 'Field Mapping'));
});
