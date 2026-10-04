import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processJSON } from '../src/json';
import { irdRows, blankIRDRows, IRD_HEADERS, reusablePath } from '../src/ird';

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
  assert.ok(!IRD_HEADERS.some((header) => /sample/i.test(header)));
  for (const row of rows) for (const header of IRD_HEADERS.slice(4)) assert.equal(row[header], '');
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
  assert.deepEqual(Object.keys(rows[0]), [...IRD_HEADERS]);
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
