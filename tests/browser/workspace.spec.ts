import AxeBuilder from '@axe-core/playwright';
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

/** One of the four workbook choices in the column for JSON as the source or the target. */
const exportOption = (page: Page, role: 'source' | 'target', name: string) =>
  page
    .getByRole('group', { name: `JSON is the ${role}` })
    .getByRole('radio', { name: new RegExp(`^${name}`) });

test('formats accurately, selects escaped paths, searches, exports, and handles errors', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page
    .getByLabel('JSON source')
    .fill('{"a/b":{"0":9007199254740993},"kind":"Object","nil":null}');
  await expect(page.getByText('5 values', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '0 9007199254740993', exact: true }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$["a/b"]["0"]');
  await page.locator('.selection-bar').getByRole('button', { name: 'Copy as' }).click();
  await page.getByRole('menuitem', { name: 'JSON Pointer' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/a~1b/0');
  const range = await page
    .getByLabel('JSON source')
    .evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(range).toBe('9007199254740993');
  await page.getByLabel('Search paths and values').fill('nil');
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(1);
  await page.getByLabel('Search paths and values').fill('');
  await page.getByLabel('Collapse all', { exact: true }).click();
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(1);
  await page.getByLabel('Expand all', { exact: true }).click();
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(5);
  const jsonDownload = page.waitForEvent('download');
  await page.getByLabel('Download JSON', { exact: true }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe('formatted.json');
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await json.path())!, 'utf8')).toContain('9007199254740993');
  await page.getByLabel('Export mapping to Excel', { exact: true }).click();
  await exportOption(page, 'source', 'Mapping with samples').check();
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
  await expect(page.locator('.selected-path-copy')).toContainText('$.settings');
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
  expect(await page.getByLabel('JSON values').getByRole('treeitem').count()).toBeLessThan(100);
  expect(await page.locator('.code-line').count()).toBeLessThan(100);
  await page.getByLabel('Search paths and values').fill('record 4999');
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(1);
  await page.getByLabel('JSON source').fill('{"latest":true}');
  await expect(page.getByText('2 values', { exact: true })).toBeVisible();
  await page.getByLabel('Search paths and values').fill('');
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(2);
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
  await page.getByRole('treeitem', { name: 'document Object(2)', exact: true }).click();
  await page.locator('.selection-bar').getByRole('button', { name: 'Copy as' }).click();
  await page.getByRole('menuitem', { name: 'JSON Pointer' }).click();
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
  await expect(exportOption(page, 'source', 'IRD mapping template')).toBeChecked();
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
  await expect(exportOption(page, 'source', 'IRD mapping template')).toBeDisabled();
  await expect(exportOption(page, 'source', 'Blank IRD template')).toBeChecked();
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
  // Tree rows are one line; Show paths adds the path under each name.
  await expect(page.locator('.inline-path')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show paths', exact: true }).click();
  await expect(page.locator('.inline-path').filter({ hasText: '$.settings.theme' })).toBeVisible();
  await page.getByRole('treeitem', { name: 'theme #b5d68b', exact: true }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.settings.theme');
  await page.getByLabel('Copy current JSONPath', { exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('$.settings.theme');
  await page
    .getByRole('navigation', { name: 'Selected value ancestors' })
    .getByRole('button', { name: 'settings', exact: true })
    .click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.settings');
  await page.getByLabel('Search paths and values').fill('$.crew[0].name');
  await expect(page.getByLabel('JSON values').getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('treeitem', { name: '/crew/0/name Alex', exact: true }).click();
  await page.getByRole('button', { name: 'Copy value of /crew/0/name', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"Alex"');
  await page.getByLabel('Path display format').selectOption('pointer');
  await expect(page.locator('.inline-path')).toHaveText('/crew/0/name');
  await page.getByLabel('Clear path search', { exact: true }).click();
  const tree = page.getByRole('tree', { name: 'JSON values' });
  await tree.press('ArrowDown');
  await expect(page.locator('.selected-path-copy')).toContainText('$.crew[0].role');
  await tree.press('ArrowUp');
  await expect(page.locator('.selected-path-copy')).toContainText('$.crew[0].name');
  await tree.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/crew/0/name');
  await tree.press('Control+Shift+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('\"Alex\"');
  await page.getByRole('button', { name: 'Go to source', exact: true }).click();
  await expect(page.getByLabel('JSON source')).toBeFocused();
  const range = await page
    .getByLabel('JSON source')
    .evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(range).toBe('"Alex"');
  await tree.press('End');
  await expect(page.locator('.selected-path-copy')).toContainText('$.nextLaunch');
  await tree.press('Home');
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
  await page.getByRole('treeitem', { name: '/settings/refreshInterval 30', exact: true }).click();
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
  await exportOption(page, 'source', 'Known-target worked example').check();
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
  await exportOption(page, 'source', 'Known-target worked example').check();
  await expect(
    page.getByRole('button', { name: 'Download target XLSX', exact: true }),
  ).toBeEnabled();
  const emptyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download completed IRD', exact: true }).click();
  const empty = await readWorkbook(await (await emptyDownload).path());
  expect(sheet(empty, 'Field Mapping')).toEqual(sheet(completed, 'Field Mapping'));
});

test('JSON as the target has its own column with the same four workbooks', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('JSON source')
    .fill(
      '{"crew":[{"name":"SAMPLE_SECRET_ONE","score":123},{"name":"SAMPLE_SECRET_TWO","score":456}]}',
    );
  await expect(page.getByText('8 values', { exact: true })).toBeVisible();
  await openExcel(page);
  await expect(exportOption(page, 'source', 'IRD mapping template')).toBeChecked();
  for (const role of ['source', 'target'] as const)
    await expect(
      page.getByRole('group', { name: `JSON is the ${role}` }).getByRole('radio'),
    ).toHaveCount(4);

  // Choosing a target option unchecks the source one: it is a single choice across both columns.
  await exportOption(page, 'target', 'IRD mapping template').check();
  await expect(exportOption(page, 'source', 'IRD mapping template')).not.toBeChecked();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^IRD_Target_Template_/);
  const workbook = await readWorkbook(await file.path());
  expect(names(workbook)).toEqual(['Overview', 'Field Mapping', 'Instructions']);
  expect(allRows(workbook)).not.toContain('SAMPLE_SECRET');
  const [header, ...body] = sheet(workbook, 'Field Mapping').rows;
  expect(header).toEqual([
    'Mapping ID',
    'Source Field / Path',
    'Source Type',
    'Target Field',
    'Target JSONPath',
    'Target Type',
    'Required',
    'Cardinality',
    'Transformation / Business Rule',
    'Default Value',
    'Validation / Constraints',
    'Description',
  ]);
  expect(body.map((row) => row[4])).toEqual(['$.crew', '$.crew[*].name', '$.crew[*].score']);
  expect(body.every((row) => row[1] === '' && row[2] === '')).toBe(true);
  await page.getByRole('status').filter({ hasText: 'JSON as target' }).waitFor();
});

test('known-source example and the target blank template work without valid JSON', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('JSON source').fill('{"private":"EDITOR_SECRET_EXCLUDED"');
  await openExcel(page);
  await expect(exportOption(page, 'target', 'IRD mapping template')).toBeDisabled();
  await expect(exportOption(page, 'target', 'Mapping with samples')).toBeDisabled();
  await exportOption(page, 'target', 'Known-source worked example').check();
  await expect(page.getByText('2 source tables · 11 completed mappings')).toBeVisible();
  const sourceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source XLSX', exact: true }).click();
  const source = await sourceDownload;
  expect(source.suggestedFilename()).toMatch(/^Orbital_Source_Example_/);
  const tables = await readWorkbook(await source.path());
  expect(names(tables)).toEqual([
    'Overview',
    'Source Fields',
    'Projects',
    'Crew',
    'Target JSON',
    'Instructions',
  ]);
  const mappingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download completed IRD', exact: true }).click();
  const mapping = await mappingDownload;
  expect(mapping.suggestedFilename()).toMatch(/^Orbital_Completed_Target_IRD_/);
  const completed = await readWorkbook(await mapping.path());
  expect(usedRange(completed, 'Field Mapping')).toBe('A1:L12');
  expect(cellAt(completed, 'Field Mapping', 'B2')).toBe('Projects.project_name');
  expect(cellAt(completed, 'Field Mapping', 'E12')).toBe('$.crew[*].role');
  expect(allRows(completed)).not.toContain('EDITOR_SECRET_EXCLUDED');
  expect(allRows(tables)).not.toContain('EDITOR_SECRET_EXCLUDED');

  await openExcel(page);
  await exportOption(page, 'target', 'Blank IRD template').check();
  const blankDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download XLSX', exact: true }).click();
  const blankFile = await blankDownload;
  expect(blankFile.suggestedFilename()).toMatch(/^IRD_Target_Blank_Template_/);
  const blank = await readWorkbook(await blankFile.path());
  expect(usedRange(blank, 'Field Mapping')).toBe('A1:L31');
  expect(cellAt(blank, 'Field Mapping', 'E1')).toBe('Target JSONPath');
});

test('narrow panes keep every pane control reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/#workspace');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  for (const label of [
    'Focus Source',
    'Focus Formatted',
    'Focus Explorer',
    'Focus Graph',
    'Focus Table',
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByLabel('Indentation')).toBeVisible();
  await expect(page.getByLabel('Download JSON', { exact: true })).toBeVisible();
  // The heading wraps rather than clipping: no control sits outside its pane.
  const outside = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('.pane-actions button')].filter((button) => {
        const pane = button.closest('.pane')!.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        return box.right > pane.right + 1 || box.left < pane.left - 1;
      }).length,
  );
  expect(outside).toBe(0);
});

test('Workspace find shows the live path for each match and follows it in every pane', async ({
  page,
}) => {
  await page.goto('/#workspace');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page
    .getByLabel('JSON source')
    .fill('{"a":{"name":"x"},"b":{"name":"y"},"c":[{"name":"z"}]}');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  const find = page.getByLabel('Search paths and values');
  await find.fill('name');
  const chip = page.locator('.selected-path-copy code');
  await expect(chip).toHaveText('$.a.name');
  await find.press('Enter');
  await expect(chip).toHaveText('$.b.name');
  // The explorer, formatted code, and source all point at the same value.
  await expect(page.locator('.path-row.selected')).toContainText('/b/name');
  await expect(page.locator('.code-line.highlighted')).toContainText('"name": "y"');
  const picked = await page
    .getByLabel('JSON source')
    .evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(picked).toBe('"y"');
  await find.press('Enter');
  await expect(chip).toHaveText('$.c[0].name');
  await page.getByLabel('Previous match').click();
  await expect(chip).toHaveText('$.b.name');
});

test('the tree follows the ARIA tree keyboard model and shows what is inside collapsed branches', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#workspace');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  const tree = page.getByRole('tree', { name: 'JSON values' });
  const chip = page.locator('.selected-path-copy code');
  await tree.getByRole('treeitem', { name: 'project Orbital' }).click();
  await expect(chip).toHaveText('$.project');
  // Levels and expansion are exposed to assistive technology.
  await expect(tree.getByRole('treeitem', { name: /^settings / })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(tree.getByRole('treeitem', { name: 'theme #b5d68b' })).toHaveAttribute(
    'aria-level',
    '3',
  );
  // Down to a branch, Left collapses it and shows a preview of its keys, Right opens it again.
  await tree.press('ArrowDown');
  await tree.press('ArrowDown');
  await tree.press('ArrowDown');
  await expect(chip).toHaveText('$.settings');
  await tree.press('ArrowLeft');
  const settings = tree.getByRole('treeitem', { name: /^settings / });
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(settings).toContainText('3 keys');
  await expect(settings).toContainText('{ theme, notifications, refreshInterval }');
  await tree.press('ArrowRight');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  // Right on an open branch enters it; Left on a leaf goes back to its parent.
  await tree.press('ArrowRight');
  await expect(chip).toHaveText('$.settings.theme');
  await tree.press('ArrowLeft');
  await expect(chip).toHaveText('$.settings');
  // Enter toggles, type-ahead jumps by key name, End and Home go to the ends.
  await tree.press('Enter');
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await tree.press('Enter');
  await tree.pressSequentially('next');
  await expect(chip).toHaveText('$.nextLaunch');
  await tree.press('Home');
  await expect(chip).toHaveText('$');
  // A colour value shows its swatch; row actions copy the value exactly as written.
  await expect(
    tree.getByRole('treeitem', { name: 'theme #b5d68b' }).locator('.tree-swatch'),
  ).toBeVisible();
  await tree.getByRole('treeitem', { name: 'theme #b5d68b' }).hover();
  await page.getByRole('button', { name: 'Copy value of /settings/theme' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"#b5d68b"');
  // Search matches are marked in the tree.
  await page.getByLabel('Search paths and values').fill('orb');
  await expect(tree.locator('mark')).toHaveText('Orb');
});

test('clicks in the formatted code, repeated keys, blank queries, and collapsing keep the tree honest', async ({
  page,
}) => {
  await page.goto('/#format');
  await page
    .getByLabel('JSON source')
    .fill('{"a/b":{"0":9007199254740993},"dup":{"name":"d1","name":"d2"},"list":[1,2,3]}');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  // Click a value, then a key, in the Code view.
  await page
    .getByRole('tablist', { name: 'Output view' })
    .getByRole('tab', { name: 'Code' })
    .click();
  const code = page.locator('#output-pre');
  await code.getByText('9007199254740993', { exact: true }).click();
  await expect(page.locator('.selected-path-copy')).toContainText('$["a/b"]["0"]');
  await code.getByText('"list":').click();
  await expect(page.locator('.selected-path-copy')).toContainText('$.list');
  // Selecting text by dragging does not change the selection.
  const before = await page.locator('.selected-path-copy').textContent();
  const box = (await code.getByText('"dup":').boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await page.locator('.selected-path-copy').textContent()).toBe(before);
  // A repeated key counts once per path, so every step lands on a value that can be shown.
  await page.getByLabel('Search paths and values').fill('dup');
  await expect(page.getByRole('status').filter({ hasText: 'matches' })).toHaveText(/of 2 matches/);
  // A blank query is not a search: the tree keeps its structure.
  await page
    .getByRole('tablist', { name: 'Output view' })
    .getByRole('tab', { name: 'Tree' })
    .click();
  await page.getByLabel('Search paths and values').fill('   ');
  await expect(page.getByRole('treeitem').first()).toHaveAttribute('aria-level', '1');
  await expect(page.getByRole('treeitem', { name: /^a\/b / })).toHaveAttribute('aria-level', '2');
});

test('collapsing keeps the scroll position, and a collapsed preview meets contrast', async ({
  page,
}) => {
  await page.goto('/#format');
  const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, tag: `t${i}` }));
  await page.getByLabel('JSON source').fill(JSON.stringify({ items, other: { a: 1, b: 2 } }));
  await expect(page.locator('.stats-button')).toHaveText('6,005 values');
  await page
    .getByRole('tablist', { name: 'Output view' })
    .getByRole('tab', { name: 'Tree' })
    .click();
  const scroller = page.locator('.explorer-scroll');
  await scroller.evaluate((el) => (el.scrollTop = 30000));
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(29000);
  const row = page.getByRole('treeitem').first();
  await row.click();
  await page.keyboard.press('ArrowLeft');
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  // Collapsing the root shows its preview.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tree-preview')).toBeVisible();
  const violations = await new AxeBuilder({ page })
    .include('.explorer-scroll')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(violations.violations.map((v) => v.id)).toEqual([]);
});

test('a phone-sized Workspace leaves the explorer usable room while searching', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('/#workspace');
  await expect(page.getByText('Valid JSON', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.getByLabel('Search paths and values').fill('o');
  const scroller = page.locator('.explorer-scroll');
  await expect(scroller).toBeVisible();
  expect((await scroller.boundingBox())!.height).toBeGreaterThan(160);
  await page.getByLabel('Search paths and values').fill('zzzz-nothing');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('the export columns line up row for row at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await openExcel(page);
  const tops = async (role: string) =>
    page
      .getByRole('group', { name: `JSON is the ${role}` })
      .locator('.export-option')
      .evaluateAll((labels) =>
        labels.map((label) => Math.round(label.getBoundingClientRect().top)),
      );
  const [source, target] = [await tops('source'), await tops('target')];
  // Rows share their height, so tops agree to within sub-pixel rounding.
  source.forEach((top, index) => expect(Math.abs(top - target[index])).toBeLessThanOrEqual(1));
});
