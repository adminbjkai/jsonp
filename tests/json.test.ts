import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processJSON,
  pointer,
  jsonPath,
  jsPath,
  mappingRows,
  entryAtOffset,
  entryMatcher,
  MAX_INPUT,
  EXAMPLE,
} from '../src/lib/json';

test('formats nested JSON with exact source and output ranges', () => {
  const source = '{"a": [1, {"b": true}], "empty": {}}';
  const result = processJSON(source);
  assert.equal(result.error, null);
  assert.equal(
    result.output,
    '{\n  "a": [\n    1,\n    {\n      "b": true\n    }\n  ],\n  "empty": {}\n}',
  );
  for (const entry of result.entries) {
    assert.deepEqual(
      JSON.parse(source.slice(entry.start, entry.end)),
      JSON.parse(result.output.slice(entry.outputStart, entry.outputEnd)),
    );
    assert.equal(result.output.slice(0, entry.outputStart).split('\n').length - 1, entry.line);
    assert.equal(result.output.slice(0, entry.outputEnd).split('\n').length - 1, entry.endLine);
  }
});

test('keeps unsafe integers, high precision decimals, exponents and negative zero exactly', () => {
  const source =
    '{"n":900719925474099312345,"d":0.123456789012345678901,"huge":1e999,"z":-0,"escaped":"\\u0061\\/"}';
  const result = processJSON(source);
  assert.equal(result.error, null);
  assert.equal(processJSON(result.output, 0).output, source);
  assert.equal(result.entries.find((e) => e.path === '/n')?.value, '900719925474099312345');
  assert.equal(result.entries.find((e) => e.path === '/huge')?.value, '1e999');
});

test('distinguishes containers, strings, null and primitive roots', () => {
  const result = processJSON('{"a":"Object","b":"Array(3)","c":false,"d":null}');
  assert.deepEqual(
    result.entries.map((e) => e.type),
    ['object', 'string', 'string', 'boolean', 'null'],
  );
  for (const source of ['null', '42', 'true', '"hello"', '[]', '{}']) {
    const parsed = processJSON(source);
    assert.equal(parsed.error, null);
    assert.equal(parsed.output, source);
    assert.equal(parsed.entries[0].path, '');
  }
});

test('uses RFC 6901 escaping, empty root pointer, and preserves numeric object keys', () => {
  const result = processJSON('{"": {"a/b~c":{"01":[7]}},"0":"Object"}');
  assert.equal(pointer([]), '');
  assert.equal(pointer(['']), '/');
  const value = result.entries.find((e) => e.value === '7')!;
  assert.equal(value.path, '//a~1b~0c/01/0');
  assert.deepEqual(value.parts, ['', 'a/b~c', '01', 0]);
  assert.equal(jsonPath(value.parts), '$[""]["a/b~c"]["01"][0]');
  assert.equal(jsonPath(['0']), '$["0"]');
  assert.equal(jsPath(['0']), '["0"]');
  assert.equal(result.entries.find((e) => e.path === '/0')?.type, 'string');
});

test('quotes complex property accessors without losing backslashes, newlines or quotes', () => {
  const parts = ['a\\b', 'x\ny', "can't", 'he said "hi"'];
  const data = { 'a\\b': { 'x\ny': { "can't": { 'he said "hi"': 123 } } } };
  assert.equal(new Function('$', `return ${jsonPath(parts)}`)(data), 123);
});

test('preserves duplicate object keys and flags ambiguous references', () => {
  const result = processJSON('{"a":1,"a":2,"__proto__":{"safe":true}}');
  assert.equal(result.error, null);
  assert.equal(processJSON(result.output, 0).output, '{"a":1,"a":2,"__proto__":{"safe":true}}');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.entries.filter((e) => e.path === '/a').length, 2);
  assert.equal(result.entries.find((e) => e.path === '/__proto__/safe')?.value, 'true');
  assert.equal(({} as { safe?: boolean }).safe, undefined);
});

test('invalid JSON clears all derived data; whitespace remains empty', () => {
  for (const source of ['{', '[1,]', '{"x":NaN}', 'true false', '{"x":"\n"}', '{"x":01}']) {
    const result = processJSON(source);
    assert.ok(result.error, source);
    assert.equal(result.output, '');
    assert.deepEqual(result.entries, []);
  }
  assert.deepEqual(processJSON(' \t\n'), { output: '', entries: [], warnings: [], error: null });
});

test('caps resource usage with explicit errors rather than partial data', () => {
  assert.match(processJSON(' '.repeat(MAX_INPUT + 1) + '0').error!, /5 MiB/);
  assert.match(processJSON('['.repeat(258) + '0' + ']'.repeat(258)).error!, /256/);
  assert.match(processJSON(JSON.stringify(Array(300_001).fill(0))).error!, /300,000/);
});

test('supports four-space and compact output without changing data', () => {
  assert.equal(processJSON('{"a": [true]}', 4).output, '{\n    "a": [\n        true\n    ]\n}');
  assert.equal(processJSON('{"a": [true]}', 0).output, '{"a":[true]}');
});

test('mapping exports preserve JSON order, exact numbers, original types, and references', () => {
  const result = processJSON('{"10":9007199254740993,"2":false,"n":null}');
  const rows = mappingRows(result.entries);
  assert.equal(rows[0]['JSON Pointer'], '');
  assert.equal(rows[1]['Field Name'], '10');
  assert.equal(rows[1]['Sample Value'], '9007199254740993');
  assert.equal(rows[1]['Type'], 'number');
  assert.equal(rows[1]['JSONPath Reference'], '$["10"]');
  assert.equal(rows[2]['Type'], 'boolean');
  assert.equal(rows[3]['Type'], 'null');
});

test('formats varied documents consistently against native JSON semantics', () => {
  const values = [
    { '': 1, '~': [], '/': {}, '"': '\\', 中文: '🚀' },
    [null, {}, [], -5, 1e-9],
    { alpha: { beta: [1, false, 'a:b,{x}'] } },
  ];
  for (const value of values)
    for (const indent of [0, 2, 4]) {
      const source = JSON.stringify(value);
      const result = processJSON(source, indent);
      assert.equal(result.error, null);
      assert.deepEqual(JSON.parse(result.output), value);
      assert.equal(processJSON(result.output, indent).output, result.output);
    }
});

test('entryAtOffset finds the same entry as scanning every entry', () => {
  const documents = [
    EXAMPLE,
    JSON.stringify({ a: [1, { b: [] }, 'x'], c: { d: { e: null } }, '': [[], [[]]] }, null, 3),
    '[1,2,[3,[4,{"k":"v"}]],"end"]',
    '{"a":{"b":{"c":{"d":1}}},"z":[true,false]}',
  ];
  for (const source of documents) {
    const { entries } = processJSON(source, 2);
    assert.ok(entries.length > 0);
    for (let offset = 0; offset <= source.length; offset++) {
      let expected: (typeof entries)[number] | undefined;
      for (const entry of entries)
        if (offset >= entry.keyStart && offset < entry.end) expected = entry;
      assert.equal(
        entryAtOffset(entries, offset),
        expected,
        `offset ${offset} in ${source.slice(0, 30)}`,
      );
    }
  }
});

test('explorer search matches exactly what scanning every path format would', () => {
  const awkward = {
    plain: 1,
    'with space': 'two words',
    'quo"te': true,
    'back\\slash': null,
    'new\nline': 'x',
    'tab\t': 5,
    'tilde~key': ['a~b', 'u0001'],
    'slash/key': { '0b': 'n' },
    'uni–é': '😀',
    '😀': [],
    $dollar: { 'user-1': 'USER-1', user_2: 3 },
    '': [{ id: 12, name: 'Name' }],
  };
  const tame = {
    rows: [
      { id: 1, 'user-1': 'abc', ok: true },
      { id: 12, tags: ['x'] },
    ],
    total: 2,
  };
  const queries = [
    'plain',
    'PLAIN',
    'user-1',
    'user_2',
    'u0001',
    'n',
    '0b',
    '0',
    '12',
    'name',
    'string',
    'true',
    'null',
    'object',
    'array',
    'two words',
    ' two',
    '/slash',
    '~1',
    '.rows',
    '$.rows[0]',
    '["user-1"]',
    '[0]',
    'tab',
    'x',
    'é',
    '😀',
    'id',
    'rows',
    'ok',
    'abc',
    'e',
    '-',
    '_',
  ];
  for (const value of [awkward, tame]) {
    const { entries } = processJSON(JSON.stringify(value), 2);
    const matcher = entryMatcher(entries);
    for (const query of queries) {
      const q = query.toLowerCase();
      const expected = entries.filter((entry) =>
        `${entry.path} ${jsonPath(entry.parts)} ${entry.value} ${entry.type}`
          .toLowerCase()
          .includes(q),
      );
      assert.deepEqual(entries.filter(matcher(query)), expected, `query ${JSON.stringify(query)}`);
    }
  }
});
