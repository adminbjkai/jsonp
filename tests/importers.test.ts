import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeXlsx } from 'hucre/xlsx';
import { writeOds } from 'hucre/ods';
import { formatFromName, sniffText, importBytes, yamlToJSON, xmlToJSON } from '../src/importers';

const bytes = (text: string) => new TextEncoder().encode(text);

test('YAML keeps exact numbers, quoted strings, anchors, merges, and YAML-only types', () => {
  const json = yamlToJSON(
    [
      'big: 9007199254740993',
      'price: 1.50',
      'exp: 1e3',
      'hex: 0x1F',
      'quoted: "123"',
      "single: '0042'",
      'inf: .inf',
      'nan: .nan',
      'date: 2024-01-15',
      '1.50: numeric key',
      'blob: !!binary aGVs bG8=',
      'base: &base { x: 1 }',
      'merged:',
      '  <<: *base',
      '  y: 2',
      'alias: *base',
      'empty:',
    ].join('\n'),
  );
  assert.match(json, /"big": 9007199254740993,/);
  assert.match(json, /"price": 1\.50,/);
  const value = JSON.parse(json);
  assert.equal(value.exp, 1000);
  assert.equal(value.hex, 31);
  assert.equal(value.quoted, '123');
  assert.equal(value.single, '0042');
  assert.equal(value.inf, null);
  assert.equal(value.nan, null);
  assert.equal(value.date, '2024-01-15');
  assert.equal(value['1.50'], 'numeric key');
  assert.equal(value.blob, 'aGVsbG8=');
  assert.deepEqual(value.merged, { x: 1, y: 2 });
  assert.deepEqual(value.alias, { x: 1 });
  assert.equal(value.empty, null);
  assert.ok(json.startsWith('{\n  "big"'));
});

test('multi-document YAML becomes an array; empty YAML is null; errors are reported', () => {
  assert.deepEqual(JSON.parse(yamlToJSON('---\na: 1\n---\n- 2\n- 3.0\n')), [{ a: 1 }, [2, 3]]);
  assert.match(yamlToJSON('--- 1\n--- 2.10\n'), /2\.10/);
  assert.equal(yamlToJSON(''), 'null');
  assert.throws(() => yamlToJSON('a: [1'), /^Error: YAML: /);
});

test('XML keeps every value as a string with attributes, repeats, text, and CDATA', () => {
  const value = JSON.parse(
    xmlToJSON(
      '<?xml version="1.0"?><order id="007" paid="true"><item>1</item><item>2.50</item>' +
        '<note lang="en">Hello</note><raw><![CDATA[<b>&</b>]]></raw><empty/></order>',
    ),
  );
  assert.deepEqual(value, {
    order: {
      item: ['1', '2.50'],
      note: { '#text': 'Hello', '@lang': 'en' },
      raw: '<b>&</b>',
      empty: '',
      '@id': '007',
      '@paid': 'true',
    },
  });
  assert.throws(() => xmlToJSON('<a><b></a>'), /^Error: XML line 1/);
});

test('XLSX import: one sheet becomes row objects; several become an object by sheet name', async () => {
  const one = await writeXlsx({
    sheets: [
      {
        name: 'Budget',
        rows: [
          ['Item', 'Cost', 'Paid', 'Due', null, 'Item'],
          ['Rent', 1200.5, true, new Date(Date.UTC(2024, 0, 15)), null, 'dup'],
          [null, null, null, null, null, null],
          ['Fees', 9.99, false, null, null, ''],
        ],
      },
    ],
  });
  const result = await importBytes('budget.xlsx', one);
  assert.equal(result.format, 'xlsx');
  assert.equal(result.note, 'Imported 2 rows from budget.xlsx (Budget).');
  assert.deepEqual(JSON.parse(result.text), [
    { Item: 'Rent', Cost: 1200.5, Paid: true, Due: '2024-01-15', Item_2: 'dup' },
    { Item: 'Fees', Cost: 9.99, Paid: false, Due: null, Item_2: null },
  ]);
  const two = await writeXlsx({
    sheets: [
      { name: 'Sheet1', rows: [['a'], [1], [2]] },
      {
        name: 'Sheet2',
        rows: [
          ['b', 'c'],
          ['x', 'y'],
        ],
      },
    ],
  });
  const multi = await importBytes('book.xlsx', two);
  assert.equal(multi.note, 'Imported 2 sheets from book.xlsx (Sheet1: 2 rows, Sheet2: 1 row).');
  assert.deepEqual(JSON.parse(multi.text), {
    Sheet1: [{ a: 1 }, { a: 2 }],
    Sheet2: [{ b: 'x', c: 'y' }],
  });
});

test('ODS import uses the same row conversion', async () => {
  const ods = await writeOds({
    sheets: [
      {
        name: 'S',
        rows: [
          ['k', 'v'],
          ['a', 2],
        ],
      },
    ],
  });
  const result = await importBytes('data.ods', ods);
  assert.equal(result.format, 'ods');
  assert.deepEqual(JSON.parse(result.text), [{ k: 'a', v: 2 }]);
});

test('spreadsheet and file limits are enforced with clear errors', async () => {
  const big = await writeXlsx({
    sheets: [{ name: 'S', rows: Array.from({ length: 1001 }, () => Array(300).fill(1)) }],
  });
  await assert.rejects(importBytes('big.xlsx', big), /exceeds 300,000 cells/);
  const split = await writeXlsx({
    sheets: [0, 1].map((i) => ({
      name: `S${i}`,
      rows: Array.from({ length: 600 }, () => Array(300).fill(1)),
    })),
  });
  await assert.rejects(importBytes('split.xlsx', split), /exceeds 300,000 cells/);
  await assert.rejects(
    importBytes('huge.json', new Uint8Array(5 * 1024 * 1024 + 1)),
    /larger than 5 MiB/,
  );
  await assert.rejects(importBytes('bad.xlsx', bytes('not a zip')), /Unable to read XLSX/);
});

test('CSV and TSV reuse the lossless CSV converter', async () => {
  const csv = await importBytes('people.csv', bytes('﻿name,id\nAda,9007199254740993\nBob,\n'));
  assert.equal(csv.format, 'csv');
  assert.equal(csv.note, 'Imported 2 rows of CSV from people.csv.');
  assert.match(csv.text, /"id": 9007199254740993/);
  const tsv = await importBytes('t.tsv', bytes('a\tb\n1\tx y\n'));
  assert.equal(tsv.format, 'tsv');
  assert.deepEqual(JSON.parse(tsv.text), [{ a: 1, b: 'x y' }]);
});

test('JSON files pass through untouched; unknown extensions are sniffed', async () => {
  const json = await importBytes('a.json', bytes('{"n": 1.50}'));
  assert.deepEqual(json, { text: '{"n": 1.50}', format: 'json', note: 'Opened a.json.' });
  assert.equal((await importBytes('paste.txt', bytes('[1]'))).format, 'json');
  assert.equal((await importBytes('paste.txt', bytes('a: 1\nb: 2\n'))).format, 'yaml');
  assert.equal((await importBytes('paste.txt', bytes('<a>1</a>'))).format, 'xml');
  await assert.rejects(importBytes('broken.txt', bytes('{a:1,}')), /Unsupported file type/);
});

test('formatFromName maps extensions case-insensitively', () => {
  assert.equal(formatFromName('Data.YML'), 'yaml');
  assert.equal(formatFromName('x.tab'), 'tsv');
  assert.equal(formatFromName('book.xlsx'), 'xlsx');
  assert.equal(formatFromName('notes.txt'), null);
  assert.equal(formatFromName('xlsx'), null);
});

test('sniffText detects obvious YAML, XML, and CSV but leaves broken JSON to repair', () => {
  for (const [text, expected] of [
    ['name: Ada\nage: 36\n', 'yaml'],
    ['---\nitems:\n  - a\n  - b\n', 'yaml'],
    ['- one\n- two\n', 'yaml'],
    ['# config\nserver:\n  port: 80\n  host: "x"\n', 'yaml'],
    ['<?xml version="1.0"?>\n<a/>', 'xml'],
    ['<root><item id="1">x</item></root>', 'xml'],
    ['<empty/>', 'xml'],
    ['name,age\nAda,36\nBob,40\n', 'csv'],
    ['a\tb\n1\t2\n', 'csv'],
    ['a;b;c\n1;"x;y";3\n', 'csv'],
  ] as const)
    assert.equal(sniffText(text), expected, text);
  for (const text of [
    '{a:1,}',
    '{\n  a: 1,\n  b: 2\n}',
    '[1, 2,]',
    '"a": 1,\n"b": 2',
    'name: "x",\nage: 3',
    'a:1, b:2',
    'key: value',
    'just some words',
    '',
    '<a><b>',
    'const x = { a: 1 }',
    'a,b\n1,2,3\n',
    'True',
  ])
    assert.equal(sniffText(text), null, text);
});

test('YAML keeps key order, sets, ordered maps, and explains unconvertible input', () => {
  assert.equal(
    yamlToJSON('b: 1\n2: x\na: 3\n10: y').replace(/\s+/g, ''),
    '{"b":1,"2":"x","a":3,"10":"y"}',
  );
  assert.deepEqual(JSON.parse(yamlToJSON('k: !!set {x, y}\no: !!omap [a: 1, b: 2]')), {
    k: ['x', 'y'],
    o: { a: 1, b: 2 },
  });
  assert.deepEqual(JSON.parse(yamlToJSON('base: &b {x: 1, y: 2}\nm:\n  <<: *b\n  y: 3')).m, {
    y: 3,
    x: 1,
  });
  assert.throws(() => yamlToJSON('a: &a\n  b: *a'), /refers to itself/);
  assert.throws(() => yamlToJSON('? {x: 1}\n: 2'), /map or list as a key/);
});

test('XML numeric character references are decoded', () => {
  assert.deepEqual(JSON.parse(xmlToJSON('<r a="&#x41;">&#169; &amp; &lt;x&gt;</r>')), {
    r: { '#text': '© & <x>', '@a': 'A' },
  });
});

test('workbooks without data rows are refused instead of importing []', async () => {
  const bytes = await writeXlsx({ sheets: [{ name: 'Empty', rows: [] }] });
  await assert.rejects(importBytes('empty.xlsx', bytes), /no data rows/);
});
