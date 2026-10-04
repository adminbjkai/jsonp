import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairJSON } from '../src/lib/repair';

/** Repairs and returns the compact-comparable parsed value plus fixes. */
const fix = (source: string) => {
  const result = repairJSON(source);
  assert.ok(result, `expected a repair for ${JSON.stringify(source)}`);
  return { value: JSON.parse(result.output), output: result.output, fixes: result.fixes };
};

test('returns null for valid, blank, and unrepairable input', () => {
  assert.equal(repairJSON('{"a": [1, 2.50, null]}'), null);
  assert.equal(repairJSON('  42  '), null);
  assert.equal(repairJSON(''), null);
  assert.equal(repairJSON('  \n\t '), null);
  assert.equal(repairJSON('<html><body>hi</body></html>'), null);
  assert.equal(repairJSON('{"a": }'), null);
  assert.equal(repairJSON('[1, 2}'), null);
  assert.equal(repairJSON('{"a" 1}'), null);
  assert.equal(repairJSON('[hello]'), null);
  assert.equal(repairJSON('{"a":'), null);
  assert.equal(repairJSON('['.repeat(300)), null);
});

test('repairs the combined messy example with exact numbers and fix list', () => {
  const result = repairJSON(
    "// config\n{ name: 'Orbital', version: 2, tags: ['a', 'b',], enabled: True, ratio: NaN, big: 9007199254740993, }",
  );
  assert.ok(result);
  assert.equal(
    result.output,
    '{\n  "name": "Orbital",\n  "version": 2,\n  "tags": [\n    "a",\n    "b"\n  ],\n  "enabled": true,\n  "ratio": null,\n  "big": 9007199254740993\n}',
  );
  assert.deepEqual(result.fixes, [
    'Removed 1 comment',
    'Converted 3 single-quoted strings',
    'Quoted 6 keys',
    'Replaced Python literals (True/False/None)',
    'Replaced NaN/Infinity/undefined with null',
    'Removed 2 trailing commas',
  ]);
});

test('preserves exact number tokens', () => {
  const { output } = fix('[9007199254740993, 1.50, -0, 1e400, 1E+5, 0.10,]');
  assert.equal(output, '[\n  9007199254740993,\n  1.50,\n  -0,\n  1e400,\n  1E+5,\n  0.10\n]');
});

test('removes comments outside strings only', () => {
  const r = fix('{\n  // line\n  "url": "http://x/*y*/#z", /* block\n */ "n": 1 # hash\n,}');
  assert.deepEqual(r.value, { url: 'http://x/*y*/#z', n: 1 });
  assert.deepEqual(r.fixes, ['Removed 3 comments', 'Removed 1 trailing comma']);
});

test('converts single-quoted strings with correct escapes', () => {
  const r = fix(`{'a': 'it\\'s "quoted"', 'b': 'back\\\\slash', 'c': '\\u00e9\\n'}`);
  assert.deepEqual(r.value, { a: 'it\'s "quoted"', b: 'back\\slash', c: 'é\n' });
  assert.deepEqual(r.fixes, ['Converted 6 single-quoted strings']);
});

test('fixes invalid escapes and raw control characters in strings', () => {
  const r = fix('["tab\there", "line\nbreak", "\\x41\\\'", "a\\\nb"]');
  assert.deepEqual(r.value, ['tab\there', 'line\nbreak', "A'", 'ab']);
  assert.deepEqual(r.fixes, [
    'Fixed 3 invalid escape sequences',
    'Escaped 2 control characters in strings',
  ]);
});

test('quotes unquoted keys including $, _, -, digits', () => {
  const r = fix('{$id: 1, _x: 2, kebab-case: 3, a1: 4, 5: 5, "ok": 6, true: 7}');
  assert.deepEqual(Object.keys(r.value), ['5', '$id', '_x', 'kebab-case', 'a1', 'ok', 'true']);
  assert.deepEqual(r.fixes, ['Quoted 6 keys']);
});

test('removes trailing and extra commas', () => {
  assert.deepEqual(fix('{"a": [1, 2,], "b": {},}').fixes, ['Removed 2 trailing commas']);
  const r = fix('[1,,2,]');
  assert.deepEqual(r.value, [1, 2]);
  assert.deepEqual(r.fixes, ['Removed 1 extra comma', 'Removed 1 trailing comma']);
});

test('inserts missing commas between values and members', () => {
  const r = fix('{\n  "a": 1\n  "b": [1 2 3]\n  "c": {"d": true} "e": "f"\n}');
  assert.deepEqual(r.value, { a: 1, b: [1, 2, 3], c: { d: true }, e: 'f' });
  assert.deepEqual(r.fixes, ['Inserted 5 missing commas']);
});

test('replaces Python and non-finite literals', () => {
  const r = fix('[True, False, None, NaN, Infinity, -Infinity, +Infinity, undefined]');
  assert.deepEqual(r.value, [true, false, null, null, null, null, null, null]);
  assert.deepEqual(r.fixes, [
    'Replaced Python literals (True/False/None)',
    'Replaced NaN/Infinity/undefined with null',
  ]);
});

test('replaces smart quotes used as delimiters', () => {
  const r = fix('{“name”: “Orbital”, ‘k’: ‘v’, "keep": "“inner”"}');
  assert.deepEqual(r.value, { name: 'Orbital', k: 'v', keep: '“inner”' });
  assert.deepEqual(r.fixes, ['Replaced smart quotes']);
});

test('strips BOM, Markdown fences, JSONP, and JS assignments', () => {
  assert.deepEqual(fix('\uFEFF{"a": 1}').fixes, ['Removed byte order mark']);
  const fenced = fix('Here you go:\n```json\n{"a": 1,}\n```\nDone.');
  assert.deepEqual(fenced.value, { a: 1 });
  assert.deepEqual(fenced.fixes, ['Removed Markdown code fence', 'Removed 1 trailing comma']);
  const jsonp = fix('callback_1.done({"a": [1]});');
  assert.deepEqual(jsonp.value, { a: [1] });
  assert.deepEqual(jsonp.fixes, ['Removed JSONP wrapper']);
  assert.deepEqual(fix('const config = {a: 1};\n').value, { a: 1 });
  assert.deepEqual(fix('module.exports = [1, 2];').fixes, ['Removed JavaScript assignment']);
  assert.deepEqual(fix('export default {"x": null}').value, { x: null });
});

test('wraps multiple top-level values (NDJSON and concatenated)', () => {
  const ndjson = fix('{"a": 1}\n{"a": 2}\n{"a": 3}\n');
  assert.deepEqual(ndjson.value, [{ a: 1 }, { a: 2 }, { a: 3 }]);
  assert.deepEqual(ndjson.fixes, ['Wrapped 3 values in an array']);
  assert.deepEqual(fix('{"a":1}{"b":2}').value, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(fix('[1],[2]').value, [[1], [2]]);
  assert.deepEqual(fix('1 "two" null').value, [1, 'two', null]);
});

test('closes unclosed brackets and an unterminated string', () => {
  const r = fix('{"a": [1, {"b": 2');
  assert.deepEqual(r.value, { a: [1, { b: 2 }] });
  assert.deepEqual(r.fixes, ['Closed 3 unclosed brackets']);
  const s = fix('{"a": ["x", "unfinished');
  assert.deepEqual(s.value, { a: ['x', 'unfinished'] });
  assert.deepEqual(s.fixes, ['Closed unterminated string', 'Closed 2 unclosed brackets']);
  assert.deepEqual(fix('[1, 2,').fixes, ['Removed 1 trailing comma', 'Closed 1 unclosed bracket']);
});

test('converts hex numbers and normalizes number formats', () => {
  const hex = fix('[0x1F, -0xff, 0xFFFFFFFFFFFFFFFFFF]');
  assert.equal(hex.output, '[\n  31,\n  -255,\n  4722366482869645213695\n]');
  assert.deepEqual(hex.fixes, ['Converted 3 hex numbers']);
  const num = fix('[+1, .5, -.5, 5., 007, -00.25, 1.e3, 2]');
  assert.equal(num.output, '[\n  1,\n  0.5,\n  -0.5,\n  5,\n  7,\n  -0.25,\n  1e3,\n  2\n]');
  assert.deepEqual(num.fixes, ['Normalized number format']);
});

test('never throws and handles 5 MiB of messy input quickly', () => {
  for (const s of ['{', '"', "'", '\\', '{a', '[,', '/*', '```', 'x(', '{1:', '0x']) {
    assert.doesNotThrow(() => repairJSON(s));
  }
  const line = "{id: 12345, name: 'item', tags: ['a', 'b',], ok: True, n: 1.50, } // note\n";
  const big = line.repeat(Math.ceil((5 * 1024 * 1024) / line.length));
  const start = performance.now();
  const result = repairJSON(big);
  const ms = performance.now() - start;
  assert.ok(result);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  const value = JSON.parse(result.output) as unknown[];
  assert.equal(value.length, Math.ceil((5 * 1024 * 1024) / line.length));
});

test('keeps stray backslashes in Windows paths and regular expressions', () => {
  const r = repairJSON('{"p": "C:\\Users\\me\\data.json", "re": "\\d+\\.\\w",}')!;
  assert.deepEqual(JSON.parse(r.output), { p: 'C:\\Users\\me\\data.json', re: '\\d+\\.\\w' });
});
