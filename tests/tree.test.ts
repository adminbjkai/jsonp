import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTree,
  serialize,
  nodeAt,
  sortKeys,
  prune,
  escapeJSON,
  unescapeJSON,
  fromValue,
} from '../src/lib/tree';

test('round-trips exact numbers, escapes, and duplicate keys', () => {
  const source = '{"b":1.50,"a":[9007199254740993,-0,1e+400],"a":"\\u00e9\\n","":{}}';
  assert.equal(serialize(parseTree(source), 0), source);
  assert.equal(serialize(parseTree('[]'), 2), '[]');
  assert.equal(
    serialize(parseTree('{"x":[1,{"y":null}]}'), 2),
    '{\n  "x": [\n    1,\n    {\n      "y": null\n    }\n  ]\n}',
  );
});

test('finds nodes and transforms losslessly', () => {
  const tree = parseTree('{"z":{"b":null,"a":1.0},"y":["",[],{},null,0]}');
  assert.deepEqual(nodeAt(tree, ['z', 'a']), { type: 'number', raw: '1.0' });
  assert.equal(nodeAt(tree, ['missing']), undefined);
  assert.equal(serialize(sortKeys(tree), 0), '{"y":["",[],{},null,0],"z":{"a":1.0,"b":null}}');
  assert.equal(serialize(prune(tree), 0), '{"z":{"a":1.0},"y":["",[],{},0]}');
  assert.equal(serialize(prune(tree, true), 0), '{"z":{"a":1.0},"y":[0]}');
  const escaped = escapeJSON(tree);
  assert.equal(JSON.parse(escaped), serialize(tree, 0));
  assert.equal(serialize(unescapeJSON(parseTree(escaped))!, 0), serialize(tree, 0));
  assert.equal(unescapeJSON(parseTree('"plain"')), null);
  assert.equal(
    serialize(fromValue({ a: [1, 'x', true, null, NaN] }), 0),
    '{"a":[1,"x",true,null,null]}',
  );
  assert.throws(() => parseTree('{bad'));
});

test('compares number tokens exactly', async () => {
  const { compareNumbers } = await import('../src/lib/tree');
  assert.equal(compareNumbers('9007199254740993', '9007199254740992'), 1);
  assert.equal(compareNumbers('1.0', '1'), 0);
  assert.equal(compareNumbers('-0', '0'), 0);
  assert.equal(compareNumbers('-2', '-10'), 1);
  assert.equal(compareNumbers('1e400', '9e399'), 1);
  assert.equal(compareNumbers('0.001', '1e-3'), 0);
  assert.equal(compareNumbers('-1.5', '1'), -1);
});
