import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTree } from '../src/tree';
import { EXAMPLE, pointer } from '../src/json';
import { diffTrees } from '../src/diff';

const diff = (a: string, b: string, options?: { ignoreOrder?: boolean; limit?: number }) =>
  diffTrees(parseTree(a), parseTree(b), options);
const brief = (a: string, b: string, options?: { ignoreOrder?: boolean }) =>
  diff(a, b, options).changes.map((c) => `${c.kind} ${pointer(c.parts)}`);

test('identical documents produce no changes', () => {
  const result = diff(EXAMPLE, EXAMPLE);
  assert.deepEqual(result, {
    changes: [],
    truncated: false,
    summary: { added: 0, removed: 0, changed: 0, type: 0 },
  });
  assert.deepEqual(diff('[]', '[]').changes, []);
  assert.deepEqual(diff('"x"', '"x"').changes, []);
  assert.deepEqual(diff('null', 'null').changes, []);
});

test('reports added, removed, changed, and type changes with compact text', () => {
  const result = diff(
    '{"a":1,"b":"x","c":true,"d":{"e":null}}',
    '{"a":2,"b":3,"d":[],"f":{"g":1}}',
  );
  assert.deepEqual(result.changes, [
    { kind: 'changed', parts: ['a'], before: '1', after: '2' },
    { kind: 'type', parts: ['b'], before: '"x"', after: '3' },
    { kind: 'removed', parts: ['c'], before: 'true' },
    { kind: 'type', parts: ['d'], before: '{"e":null}', after: '[]' },
    { kind: 'added', parts: ['f'], after: '{"g":1}' },
  ]);
  assert.deepEqual(result.summary, { added: 1, removed: 1, changed: 1, type: 2 });
  assert.equal(result.truncated, false);
  assert.deepEqual(diff('true', 'false').changes, [
    { kind: 'changed', parts: [], before: 'true', after: 'false' },
  ]);
  assert.deepEqual(diff('null', '0').changes[0].kind, 'type');
});

test('object key order never matters and additions follow their siblings', () => {
  assert.deepEqual(diff('{"a":1,"b":2}', '{"b":2,"a":1}').changes, []);
  assert.deepEqual(brief('{"a":1,"c":3}', '{"z":0,"a":1,"b":2,"c":3,"d":4}'), [
    'added /z',
    'added /b',
    'added /d',
  ]);
  assert.deepEqual(brief('{"a":1,"b":2,"c":3}', '{"a":1,"x":9,"c":4}'), [
    'added /x',
    'removed /b',
    'changed /c',
  ]);
});

test('duplicate keys: last occurrence wins', () => {
  assert.deepEqual(diff('{"a":1,"a":2}', '{"a":2}').changes, []);
  assert.deepEqual(diff('{"a":2}', '{"a":2,"a":3}').changes, [
    { kind: 'changed', parts: ['a'], before: '2', after: '3' },
  ]);
});

test('numbers compare by exact value, not by float or token text', () => {
  assert.deepEqual(diff('[1.0, 1e2, -0, 0.50, 1E+400]', '[1, 100, 0, 5e-1, 10e399]').changes, []);
  const big = diff('{"n":9007199254740993}', '{"n":9007199254740992}');
  assert.deepEqual(big.changes, [
    { kind: 'changed', parts: ['n'], before: '9007199254740993', after: '9007199254740992' },
  ]);
  assert.deepEqual(diff('[0.1]', '[0.10000000000000001]').changes.length, 1);
  assert.deepEqual(diff('[2]', '[-2]').changes.length, 1);
  assert.deepEqual(diff('[1]', '["1"]').changes[0].kind, 'type');
});

test('escaped keys keep exact path parts', () => {
  const result = diff('{"a/b":{"~":1},"x~1":1}', '{"a/b":{"~":2},"":0}');
  assert.deepEqual(result.changes, [
    { kind: 'changed', parts: ['a/b', '~'], before: '1', after: '2' },
    { kind: 'added', parts: [''], after: '0' },
    { kind: 'removed', parts: ['x~1'], before: '1' },
  ]);
  assert.deepEqual(
    result.changes.map((c) => pointer(c.parts)),
    ['/a~1b/~0', '/', '/x~01'],
  );
});

test('arrays compare by index by default', () => {
  assert.deepEqual(brief('[1,2,3]', '[1,5,3,4]'), ['changed /1', 'added /3']);
  assert.deepEqual(brief('[1,2,3]', '[1]'), ['removed /1', 'removed /2']);
  assert.deepEqual(brief('[1,2]', '[2,1]'), ['changed /0', 'changed /1']);
  assert.deepEqual(brief('{"l":[{"a":1},{"a":2}]}', '{"l":[{"a":1},{"a":3}]}'), ['changed /l/1/a']);
});

test('ignoreOrder matches array items as multisets', () => {
  const opts = { ignoreOrder: true };
  assert.deepEqual(brief('[1,2,3]', '[3,1,2]', opts), []);
  assert.deepEqual(brief('[{"a":1,"b":2},{"c":3}]', '[{"c":3},{"b":2,"a":1}]', opts), []);
  assert.deepEqual(brief('[1.0,"x"]', '["x",1]', opts), []);
  assert.deepEqual(brief('[[1,2],[3]]', '[[3],[2,1]]', opts), []);
  assert.deepEqual(brief('[1,1,2]', '[1,2,2]', opts), ['removed /1', 'added /2']);
  assert.deepEqual(diff('[1,2,3]', '[4,3,2]', opts).changes, [
    { kind: 'removed', parts: [0], before: '1' },
    { kind: 'added', parts: [0], after: '4' },
  ]);
  assert.deepEqual(brief('{"t":[{"id":1},{"id":2}]}', '{"t":[{"id":2},{"id":3}]}', opts), [
    'removed /t/0',
    'added /t/1',
  ]);
  // Objects are still compared by key inside order-insensitive mode.
  assert.deepEqual(brief('{"a":[1,2],"b":1}', '{"b":2,"a":[2,1]}', opts), ['changed /b']);
});

test('limit truncates and long values are shortened', () => {
  const a = JSON.stringify(Array.from({ length: 20 }, (_, i) => i));
  const b = JSON.stringify(Array.from({ length: 20 }, (_, i) => i + 1));
  const result = diff(a, b, { limit: 5 });
  assert.equal(result.changes.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.summary.changed, 5);
  assert.equal(diff(a, b).changes.length, 20);
  assert.equal(diff(a, b).truncated, false);
  const many = JSON.stringify(Array.from({ length: 6000 }, (_, i) => i));
  const defaults = diff('[]', many);
  assert.equal(defaults.changes.length, 5000);
  assert.equal(defaults.truncated, true);

  const long = JSON.stringify({ s: 'x'.repeat(500) });
  const text = diff('{}', long).changes[0].after!;
  assert.equal(text.length, 200);
  assert.ok(text.endsWith('…'));
  assert.ok(text.startsWith('"xxx'));
});

test('compares the Orbital example against an edited copy', () => {
  const edited = JSON.parse(EXAMPLE);
  edited.version = 3;
  edited.crew.push({ name: 'Kim', role: 'Pilot' });
  delete edited.nextLaunch;
  edited.settings.refreshInterval = '30';
  assert.deepEqual(brief(EXAMPLE, JSON.stringify(edited)), [
    'changed /version',
    'type /settings/refreshInterval',
    'added /crew/2',
    'removed /nextLaunch',
  ]);
});

test('large additions and ignore-order pools stay fast', () => {
  const many = `{${Array.from({ length: 40_000 }, (_, i) => `"k${i}":${i}`).join(',')}}`;
  let start = performance.now();
  const added = diffTrees(parseTree('{"x":1}'), parseTree(many));
  assert.equal(added.truncated, true);
  const repeated = `[${Array(40_000).fill('"active"').join(',')}]`;
  const same = diffTrees(parseTree(repeated), parseTree(repeated), { ignoreOrder: true });
  assert.equal(same.changes.length, 0);
  assert.ok(performance.now() - start < 1500, `took ${performance.now() - start} ms`);
  start = 0;
});

test('arrays of different lengths align on equal items', () => {
  const a = parseTree('[{"id":1},{"id":2},{"id":3},{"id":4}]');
  const b = parseTree('[{"id":1},{"id":9},{"id":2},{"id":3},{"id":44}]');
  const result = diffTrees(a, b);
  assert.deepEqual(
    result.changes.map((c) => [c.kind, c.parts.join('/')]),
    [
      ['added', '1'],
      ['changed', '3/id'],
    ],
  );
});
