import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readXlsx } from 'hucre/xlsx';
import type { Workbook } from 'hucre/xlsx';
import { processJSON } from '../src/json';
import { IRD_HEADERS } from '../src/ird';
import { buildWorkbook } from '../src/workbooks';

const entries = processJSON(
  '{"a/b":{"0":9007199254740993},"kind":"#N/A","formula":"=1+1","nil":null}',
).entries.map(({ path, parts, type, value }) => ({ path, parts, type, value }));
const read = async (...args: Parameters<typeof buildWorkbook>) =>
  readXlsx(await buildWorkbook(...args), { readStyles: true });
const sheet = (workbook: Workbook, name: string) =>
  workbook.sheets.find((item) => item.name === name)!;
const column = (workbook: Workbook, name: string, header: string) => {
  const [head, ...rows] = sheet(workbook, name).rows;
  return rows.map((row) => row[head.indexOf(header)]);
};
/** Shared shape of every filterable table: bold frozen header, filter over the data, widths. */
function assertTable(workbook: Workbook, name: string, headers: string[], range: string) {
  const table = sheet(workbook, name);
  assert.deepEqual(table.rows[0], headers);
  assert.deepEqual(table.autoFilter, { range });
  assert.deepEqual(table.freezePane, { rows: 1 });
  assert.equal(table.cells?.get('0,0')?.style?.font?.bold, true);
  assert.equal(table.columns?.length, headers.length);
  assert.ok(table.columns!.every((col) => col.width! > 3 && col.width! < 61));
}

test('samples workbook keeps sample numbers and error-like strings as text', async () => {
  const workbook = await read('samples', entries);
  assert.deepEqual(
    workbook.sheets.map((item) => item.name),
    ['Data_Mapping_IRD'],
  );
  assertTable(
    workbook,
    'Data_Mapping_IRD',
    [
      'Level',
      'Field Name',
      'Type',
      'Sample Value',
      'JSONPath Reference',
      'JSON Pointer',
      'Requirement ID',
      'Mapping Target',
      'Business Rule / Logic',
      'Description',
    ],
    'A1:J7',
  );
  const table = sheet(workbook, 'Data_Mapping_IRD');
  assert.equal(table.rows[3][3], '9007199254740993');
  assert.equal(table.rows[3][0], 2); // Level stays numeric
  assert.deepEqual(column(workbook, 'Data_Mapping_IRD', 'Sample Value').slice(3), [
    '#N/A',
    '=1+1',
    'null',
  ]);
  assert.notEqual(table.cells?.get('4,3')?.type, 'error');
  assert.equal(table.cells?.get('4,3')?.value, '#N/A');
  assert.equal(table.cells?.get('5,3')?.formula, undefined);
  assert.equal(table.columns![3].width! - 0.83203125, 19);
});

test('IRD template has overview, fitted mapping table with margins, and instructions', async () => {
  const workbook = await read(
    'ird',
    entries.map((entry) => ({ ...entry, value: '' })),
  );
  assert.deepEqual(
    workbook.sheets.map((item) => item.name),
    ['Overview', 'Field Mapping', 'Instructions'],
  );
  assertTable(workbook, 'Field Mapping', [...IRD_HEADERS], 'A1:L5');
  assert.deepEqual(column(workbook, 'Field Mapping', 'Source JSONPath'), [
    '$["a/b"]["0"]',
    '$.kind',
    '$.formula',
    '$.nil',
  ]);
  assert.equal(sheet(workbook, 'Field Mapping').pageSetup?.margins?.left, 0.3);
  assert.equal(sheet(workbook, 'Overview').rows[0][0], 'IRD — Interface and Field Mapping');
  assert.equal(sheet(workbook, 'Overview').columns?.[0].width, 52.83203125);
  assert.equal(sheet(workbook, 'Instructions').rows[0][0], 'Section / Column');
  assert.ok(!JSON.stringify(workbook.sheets.map((item) => item.rows)).includes('9007199254740993'));
});

test('blank IRD has 30 editable empty rows', async () => {
  const workbook = await read('blank', []);
  const mapping = sheet(workbook, 'Field Mapping');
  assertTable(workbook, 'Field Mapping', [...IRD_HEADERS], 'A1:L31');
  assert.equal(mapping.rows.length, 31);
  assert.ok(mapping.rows.slice(1).every((row) => row.every((value) => value === '')));
});

test('worked example workbooks share target sheets; the IRD adds the field mapping', async () => {
  const target = await read('example-target', []);
  const mapping = await read('example-mapping', []);
  assert.deepEqual(
    target.sheets.map((item) => item.name),
    ['Overview', 'Target Fields', 'Projects', 'Crew', 'Source JSON', 'Instructions'],
  );
  assert.deepEqual(
    mapping.sheets.map((item) => item.name),
    [
      'Overview',
      'Field Mapping',
      'Target Fields',
      'Projects',
      'Crew',
      'Source JSON',
      'Instructions',
    ],
  );
  assertTable(target, 'Crew', ['project_name', 'member_name', 'role_code'], 'A1:C3');
  assertTable(mapping, 'Field Mapping', [...IRD_HEADERS], 'A1:L12');
  assert.deepEqual(sheet(target, 'Projects').rows[1].slice(1, 3), [2, 'READY']);
  assert.equal(sheet(target, 'Projects').rows[1][7], '');
  assert.deepEqual(sheet(mapping, 'Target Fields').rows, sheet(target, 'Target Fields').rows);
  assert.equal(sheet(target, 'Source JSON').rows[1][0]?.toString().includes('"Orbital"'), true);
});

test('cell text drops characters XML cannot hold and respects the Excel cell limit', async () => {
  const { cellText } = await import('../src/workbooks');
  assert.equal(cellText('a￾b\u0001c\td'), 'a�b�c\td');
  assert.equal(cellText('\uD800x'), '�x');
  assert.equal(cellText('😀'), '😀');
  const long = cellText('x'.repeat(40_000));
  assert.equal(long.length, 32_767);
  assert.ok(long.endsWith('…[truncated]'));
  const workbook = await buildWorkbook('samples', processJSON('{"v":"\\ufffe"}').entries);
  const parsed: Workbook = await readXlsx(workbook);
  assert.equal(parsed.sheets.length, 1);
});
