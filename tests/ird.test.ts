import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processJSON } from '../src/lib/json';
import { irdRows, blankIRDRows, irdInstructions, IRD_COLUMNS, reusablePath } from '../src/lib/ird';

test('IRD mapping is structural, sample-free, and leaves decisions blank', () => {
  const result = processJSON(
    '{"password":"SECRET_NOT_FOR_IRD","total":9007199254740993,"enabled":true}',
  );
  const rows = irdRows(result.entries);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['Mapping ID'], 'MAP-001');
  assert.equal(rows[0]['Source JSONPath'], '$.password');
  assert.equal(rows[1]['Source Type'], 'number');
  assert.ok(!JSON.stringify(rows).includes('SECRET_NOT_FOR_IRD'));
  assert.ok(!JSON.stringify(rows).includes('9007199254740993'));
  assert.ok(!IRD_COLUMNS.source.some((header) => /sample/i.test(header)));
  for (const row of rows)
    for (const header of IRD_COLUMNS.source.slice(4)) assert.equal(row[header], '');
});

test('repeated array records use reusable paths with observed type unions', () => {
  const rows = irdRows(
    processJSON('{"items":[{"id":1,"note":"a"},{"id":2,"note":null,"extra":false}]}').entries,
  );
  assert.deepEqual(
    rows.map((row) => row['Source JSONPath']),
    ['$.items', '$.items[*].id', '$.items[*].note', '$.items[*].extra'],
  );
  assert.equal(
    rows.find((row) => row['Source JSONPath'] === '$.items[*].note')!['Source Type'],
    'string | null',
  );
  assert.ok(rows.every((row) => row.Required === '' && row.Cardinality === ''));
});

test('numeric object keys, escaped keys, and nested arrays stay distinct', () => {
  assert.equal(reusablePath(['0', 0, 'a/b', 1, '']), '$["0"][*]["a/b"][*][""]');
  const rows = irdRows(processJSON('{"0":[[1,2]],"a/b":{"~":true}}').entries);
  assert.ok(rows.some((row) => row['Source JSONPath'] === '$["0"][*][*]'));
  assert.ok(rows.some((row) => row['Source JSONPath'] === '$["a/b"]["~"]'));
});

test('blank IRD has fixed columns and 30 completely empty editable rows', () => {
  const rows = blankIRDRows();
  assert.equal(rows.length, 30);
  assert.deepEqual(Object.keys(rows[0]), [...IRD_COLUMNS.source]);
  assert.ok(rows.every((row) => Object.values(row).every((value) => value === '')));
  rows[0]['Source Field'] = 'changed';
  assert.equal(rows[1]['Source Field'], '');
});

test('empty containers and primitive roots are represented without inventing fields', () => {
  for (const source of ['[]', '{}', 'false']) {
    const rows = irdRows(processJSON(source).entries);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['Source JSONPath'], '$');
  }
  const rows = irdRows(processJSON('{"empty":{},"list":[]}').entries);
  assert.deepEqual(
    rows.map((row) => row['Source JSONPath']),
    ['$.empty', '$.list'],
  );
});

test('JSON as the target fills the target columns and leaves the source side blank', () => {
  const json =
    '{"password":"SECRET_NOT_FOR_IRD","items":[{"id":1,"note":"a"},{"id":2,"note":null}]}';
  const rows = irdRows(processJSON(json).entries, 'target');
  assert.deepEqual(
    rows.map((row) => row['Target JSONPath']),
    ['$.password', '$.items', '$.items[*].id', '$.items[*].note'],
  );
  assert.deepEqual(
    rows.map((row) => row['Target Field']),
    ['password', 'items', 'id', 'note'],
  );
  assert.equal(rows[3]['Target Type'], 'string | null');
  assert.equal(rows[0]['Mapping ID'], 'MAP-001');
  assert.ok(!JSON.stringify(rows).includes('SECRET_NOT_FOR_IRD'));
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), [...IRD_COLUMNS.target]);
    for (const header of ['Source Field / Path', 'Source Type', ...IRD_COLUMNS.target.slice(6)])
      assert.equal(row[header], '');
  }
});

test('both roles describe the same fields and differ only in which side they fill', () => {
  const entries = processJSON('{"a":{"b":[1,"x"]},"c":{}}').entries;
  const source = irdRows(entries, 'source');
  const target = irdRows(entries, 'target');
  assert.deepEqual(
    source.map((row) => [row['Source JSONPath'], row['Source Type'], row['Source Field']]),
    target.map((row) => [row['Target JSONPath'], row['Target Type'], row['Target Field']]),
  );
  assert.deepEqual(IRD_COLUMNS.source.slice(0, 1), IRD_COLUMNS.target.slice(0, 1));
  assert.deepEqual(IRD_COLUMNS.source.slice(6), IRD_COLUMNS.target.slice(6));
  assert.equal(new Set(IRD_COLUMNS.target).size, IRD_COLUMNS.target.length);
});

test('blank target IRD has the target columns and 30 empty rows', () => {
  const rows = blankIRDRows('target');
  assert.equal(rows.length, 30);
  assert.deepEqual(Object.keys(rows[0]), [...IRD_COLUMNS.target]);
  assert.ok(rows.every((row) => Object.values(row).every((value) => value === '')));
});

test('instructions explain every column of the role in the same order', () => {
  for (const role of ['source', 'target'] as const) {
    const rows = irdInstructions(role);
    const described = rows.slice(3, 3 + IRD_COLUMNS[role].length);
    assert.deepEqual(
      described.map((row) => row[0]),
      [...IRD_COLUMNS[role]],
    );
    assert.ok(rows.every((row) => row.every((text) => text.length > 0)));
  }
});
