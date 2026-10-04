import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignLines,
  buildDisplay,
  compareDocuments,
  displayIndexOf,
  pairToRows,
  SAMPLE_MODIFIED,
  SAMPLE_ORIGINAL,
  type Row,
} from '../src/lib/linediff';
import { processJSON } from '../src/lib/json';
import { parseTree, serialize, sortKeys } from '../src/lib/tree';

const kinds = (rows: Row[]) => rows.map((row) => row.kind).join(' ');
const pretty = (value: unknown) => JSON.stringify(value, null, 2).split('\n');

test('identical documents align as same rows with no hunks', () => {
  const lines = pretty({ a: 1, b: [1, 2, 3], c: { d: 'x' } });
  const result = alignLines(lines, [...lines]);
  assert.equal(result.hunks.length, 0);
  assert.equal(result.approximate, false);
  assert.ok(result.rows.every((row, i) => row.kind === 'same' && row.a === i && row.b === i));
  assert.deepEqual(alignLines([], []), { rows: [], hunks: [], approximate: false });
});

test('an item inserted in the middle of an array is one added hunk', () => {
  const crew = (names: string[]) => ({
    crew: names.map((name) => ({ name, role: 'Crew', active: true })),
    total: 3,
  });
  const a = pretty(crew(['Alex', 'Sam', 'Kim'])),
    b = pretty(crew(['Alex', 'Riley', 'Sam', 'Kim']));
  const result = alignLines(a, b);
  assert.equal(result.hunks.length, 1);
  const changed = result.rows.filter((row) => row.kind !== 'same');
  assert.equal(changed.length, 5);
  assert.ok(changed.every((row) => row.kind === 'add'));
  assert.equal(result.rows.length, b.length);
  // Every original line is still paired with an identical line.
  for (const row of result.rows) if (row.kind === 'same') assert.equal(a[row.a!], b[row.b!]);
});

test('adjacent removed and added lines pair into modified rows; excess stays add/del', () => {
  const a = ['{', '  "a": 1,', '  "b": 2', '}'];
  const b = ['{', '  "a": 10,', '  "b": 20,', '  "c": 3', '}'];
  const result = alignLines(a, b);
  assert.equal(kinds(result.rows), 'same mod mod add same');
  assert.deepEqual(result.rows[1], { kind: 'mod', a: 1, b: 1 });
  assert.deepEqual(result.rows[3], { kind: 'add', b: 3 });
  assert.deepEqual(result.hunks, [1]);
  // Direct pairing: same shape pairs, different keys stay separate.
  assert.equal(kinds(pairToRows(['  "x": 1', '  "y": 2'], 0, 2, ['  "x": 5'], 0, 1)), 'mod del');
  assert.equal(kinds(pairToRows(['  "v": 2'], 0, 1, ['  "t": [', '  "v": 3'], 0, 2)), 'add mod');
  assert.equal(kinds(pairToRows(['a'], 0, 1, [], 0, 0)), 'del');
});

test('falls back to positional pairing when the diff gives up', () => {
  const a = Array.from({ length: 50 }, (_, i) => `  "k${i}": ${i},`);
  const b = Array.from({ length: 60 }, (_, i) => `  "x${(i * 7) % 61}": ${i * 3},`);
  const result = alignLines(a, b, { maxEditLength: 2 });
  assert.equal(result.approximate, true);
  assert.equal(result.rows.length, 60);
  assert.equal(kinds(result.rows.slice(0, 50)), Array(50).fill('mod').join(' '));
  assert.ok(result.rows.slice(50).every((row) => row.kind === 'add'));
  assert.deepEqual(result.hunks, [0]);
});

test('100k-line documents align in under 2 seconds', () => {
  const a = Array.from({ length: 100_000 }, (_, i) => `    "field${i}": ${i},`);
  const b = a.slice();
  for (let i = 5; i < 100_000; i += 997) b[i] = `    "field${i}": "changed",`;
  b.splice(50_000, 0, '    "inserted": true,');
  b.splice(80_000, 3);
  const started = performance.now();
  const result = alignLines(a, b);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, `took ${elapsed.toFixed(0)} ms`);
  assert.equal(result.approximate, false);
  assert.equal(result.rows.filter((row) => row.kind === 'add').length, 1);
  assert.equal(result.rows.filter((row) => row.kind === 'del').length, 3);
  const display = buildDisplay(result.rows, { onlyChanges: true });
  assert.ok(display.items.length < 2000);
});

test('only-changes display folds long unchanged runs and expands them on request', () => {
  const rows: Row[] = [];
  for (let i = 0; i < 20; i++) rows.push({ kind: i === 10 ? 'mod' : 'same', a: i, b: i });
  const folded = buildDisplay(rows, { onlyChanges: true });
  assert.deepEqual(folded.folds, [
    { start: 0, end: 7 },
    { start: 14, end: 20 },
  ]);
  // fold, 3 context, change, 3 context, fold
  assert.equal(folded.items.length, 9);
  assert.equal(folded.items[0], -1);
  assert.equal(folded.items[4] >> 1, 10);
  assert.equal(displayIndexOf(folded, 10), 4);
  assert.equal(displayIndexOf(folded, 3), 0);
  const expanded = buildDisplay(rows, { onlyChanges: true, expanded: new Set([0]) });
  assert.equal(expanded.folds.length, 1);
  assert.equal(expanded.items.length, 15);
  const unified = buildDisplay(rows, { onlyChanges: false, unified: true });
  assert.equal(unified.items.length, 21);
  assert.equal(displayIndexOf(unified, 10), 10);
  assert.equal(displayIndexOf(unified, 11), 12);
});

test('compareDocuments normalizes, counts, and maps structural changes to rows', () => {
  const result = compareDocuments({
    left: SAMPLE_ORIGINAL,
    right: SAMPLE_MODIFIED,
    sortKeys: true,
    ignoreOrder: false,
  });
  assert.deepEqual(result.counts, { added: 8, removed: 1, changed: 4 });
  assert.equal(result.hunks.length, 5);
  // The inserted crew member is one addition, not two shifted changes plus an addition.
  assert.deepEqual(result.structural, { added: 2, removed: 1, changed: 2, type: 2 });
  for (const change of result.changes) {
    const row = result.rows[change.row];
    const line = change.kind === 'added' ? result.right[row.b!] : result.left[row.a!];
    const key = change.parts.at(-1);
    if (typeof key === 'string') assert.match(line, new RegExp(`"${key}"`), change.kind);
  }
  const ignored = compareDocuments({
    left: SAMPLE_ORIGINAL,
    right: SAMPLE_MODIFIED,
    sortKeys: true,
    ignoreOrder: true,
  });
  assert.deepEqual(ignored.structural, { added: 2, removed: 1, changed: 2, type: 2 });
});

test('key order only matters when sorting is off', () => {
  const request = { left: '{"a":1,"b":[1,2]}', right: '{"b":[1,2],"a":1}', ignoreOrder: false };
  const sorted = compareDocuments({ ...request, sortKeys: true });
  assert.equal(sorted.hunks.length, 0);
  assert.equal(sorted.keyOrderOnly, true);
  assert.equal(sorted.changes.length, 0);
  const raw = compareDocuments({ ...request, sortKeys: false });
  assert.ok(raw.hunks.length > 0);
  assert.equal(raw.keyOrderOnly, false);
  assert.throws(() => compareDocuments({ ...request, right: '{', sortKeys: true }), /modified/);
});

test('processJSON line numbers match the normalized serialization', () => {
  const tree = sortKeys(parseTree(SAMPLE_MODIFIED));
  const text = serialize(tree, 2);
  assert.equal(processJSON(text, 2).output, text);
  assert.equal(
    processJSON(serialize(parseTree('{"a":{},"b":[],"c":[{}]}'), 2)).output,
    serialize(parseTree('{"a":{},"b":[],"c":[{}]}'), 2),
  );
});
