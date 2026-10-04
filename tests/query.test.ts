import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, serialize } from '../src/lib/tree';
import { EXAMPLE } from '../src/lib/json';
import { isQuery, runQuery } from '../src/lib/query';

const values = (source: string, expression: string, limit?: number) =>
  runQuery(parseTree(source), expression, limit).map((m) => serialize(m.node, 0));
const paths = (source: string, expression: string) =>
  runQuery(parseTree(source), expression).map((m) => m.parts);

const STORE = `{
  "store": {
    "book": [
      { "category": "reference", "author": "Rees", "title": "Sayings", "price": 8.95 },
      { "category": "fiction", "author": "Waugh", "title": "Sword", "price": 12.99 },
      { "category": "fiction", "author": "Melville", "title": "Moby Dick", "isbn": "0-553", "price": 8.99 },
      { "category": "fiction", "author": "Tolkien", "title": "Rings", "isbn": "0-395", "price": 22.99 }
    ],
    "bicycle": { "color": "red", "price": 399 }
  },
  "expensive": 10
}`;

test('detects query text', () => {
  assert.equal(isQuery('  $.a'), true);
  assert.equal(isQuery('$'), true);
  assert.equal(isQuery('/a/b'), false);
  assert.equal(isQuery('crew'), false);
});

test('queries the Orbital example', () => {
  assert.deepEqual(values(EXAMPLE, '$.crew[*].name'), ['"Alex"', '"Sam"']);
  assert.deepEqual(paths(EXAMPLE, '$.crew[*].name'), [
    ['crew', 0, 'name'],
    ['crew', 1, 'name'],
  ]);
  assert.deepEqual(values(EXAMPLE, '$..name'), ['"Alex"', '"Sam"']);
  assert.deepEqual(values(EXAMPLE, "$.crew[?(@.role=='Designer')].name"), ['"Sam"']);
  assert.deepEqual(values(EXAMPLE, '$.settings.*'), ['"#b5d68b"', 'true', '30']);
  assert.deepEqual(paths(EXAMPLE, '$.settings.*'), [
    ['settings', 'theme'],
    ['settings', 'notifications'],
    ['settings', 'refreshInterval'],
  ]);
  assert.deepEqual(paths(EXAMPLE, '$'), [[]]);
  assert.deepEqual(values(EXAMPLE, '$.nextLaunch'), ['null']);
  assert.deepEqual(values(EXAMPLE, '$.missing'), []);
});

test('child selectors: names, quotes, escapes, indexes, wildcards', () => {
  const doc = `{"a/b":1,"~":2,"it's":3,"q\\"":4,"é":5,"first-name":6,"arr":[10,20,30,40,50],"$id":7}`;
  assert.deepEqual(paths(doc, "$['a/b']"), [['a/b']]);
  assert.deepEqual(paths(doc, '$["~"]'), [['~']]);
  assert.deepEqual(values(doc, "$['it\\'s']"), ['3']);
  assert.deepEqual(values(doc, '$["q\\""]'), ['4']);
  assert.deepEqual(values(doc, "$['\\u00e9']"), ['5']);
  assert.deepEqual(values(doc, '$.é'), ['5']);
  assert.deepEqual(values(doc, '$.first-name'), ['6']);
  assert.deepEqual(values(doc, '$.$id'), ['7']);
  assert.deepEqual(values(doc, '$.arr[0]'), ['10']);
  assert.deepEqual(values(doc, '$.arr[-1]'), ['50']);
  assert.deepEqual(values(doc, '$.arr[5]'), []);
  assert.deepEqual(values(doc, '$.arr[-6]'), []);
  assert.deepEqual(values(doc, '$.arr[*]'), ['10', '20', '30', '40', '50']);
  assert.deepEqual(values(doc, '$.arr.*'), ['10', '20', '30', '40', '50']);
  assert.deepEqual(values(doc, '$.arr[0, 2]'), ['10', '30']);
  assert.deepEqual(values(doc, '$.arr[2,0]'), ['30', '10']);
  assert.deepEqual(values(doc, "$['a/b','~']"), ['1', '2']);
  assert.deepEqual(values(doc, '$.arr.name'), []);
  assert.deepEqual(values(doc, '$[0]'), []);
  assert.deepEqual(values(doc, ' $ .arr [ 1 ] '), ['20']);
});

test('slices', () => {
  const doc = '[0,1,2,3,4,5,6,7,8,9]';
  assert.deepEqual(values(doc, '$[1:3]'), ['1', '2']);
  assert.deepEqual(values(doc, '$[:2]'), ['0', '1']);
  assert.deepEqual(values(doc, '$[8:]'), ['8', '9']);
  assert.deepEqual(values(doc, '$[-2:]'), ['8', '9']);
  assert.deepEqual(values(doc, '$[::3]'), ['0', '3', '6', '9']);
  assert.deepEqual(values(doc, '$[::-1]').join(''), '9876543210');
  assert.deepEqual(values(doc, '$[5:1:-2]'), ['5', '3']);
  assert.deepEqual(values(doc, '$[:]').length, 10);
  assert.deepEqual(values(doc, '$[1:5:0]'), []);
  assert.deepEqual(values(doc, '$[-100:100]').length, 10);
  assert.deepEqual(values('{"a":1}', '$[0:1]'), []);
});

test('recursive descent is pre-order', () => {
  const doc = '{"a":{"name":1,"x":{"name":2}},"name":3,"list":[{"name":4},[5,6]]}';
  assert.deepEqual(values(doc, '$..name'), ['1', '2', '3', '4']);
  assert.deepEqual(paths(doc, '$..name'), [
    ['a', 'name'],
    ['a', 'x', 'name'],
    ['name'],
    ['list', 0, 'name'],
  ]);
  assert.deepEqual(values('{"a":{"b":1},"c":2}', '$..*'), ['{"b":1}', '1', '2']);
  assert.deepEqual(values(doc, '$..[0]'), ['{"name":4}', '5']);
  assert.deepEqual(values(doc, "$..['name']"), ['1', '2', '3', '4']);
  assert.deepEqual(values(doc, '$.a..name'), ['1', '2']);
  assert.deepEqual(values(STORE, '$..book[?(@.isbn)].title'), ['"Moby Dick"', '"Rings"']);
  assert.deepEqual(values(STORE, '$..price').length, 5);
});

test('duplicate keys yield every member', () => {
  assert.deepEqual(values('{"a":1,"b":2,"a":3}', '$.a'), ['1', '3']);
  assert.deepEqual(values('{"a":1,"b":2,"a":3}', '$.*'), ['1', '2', '3']);
});

test('filters: comparisons, logic, existence, regex', () => {
  const titles = (expression: string) =>
    runQuery(parseTree(STORE), expression).map((m) => (m.node as { value: string }).value);
  assert.deepEqual(titles('$.store.book[?(@.price < 10)].title'), ['Sayings', 'Moby Dick']);
  assert.deepEqual(titles('$.store.book[?@.price < 10].title'), ['Sayings', 'Moby Dick']);
  assert.deepEqual(titles('$.store.book[?(@.price <= 8.99)].title'), ['Sayings', 'Moby Dick']);
  assert.deepEqual(titles('$.store.book[?(@.price > 20)].title'), ['Rings']);
  assert.deepEqual(titles('$.store.book[?(@.price >= 22.99)].title'), ['Rings']);
  assert.deepEqual(titles('$.store.book[?(@.price < $.expensive)].title'), [
    'Sayings',
    'Moby Dick',
  ]);
  assert.deepEqual(titles('$.store.book[?(@.category != "fiction")].title'), ['Sayings']);
  assert.deepEqual(titles('$.store.book[?(@.isbn)].title'), ['Moby Dick', 'Rings']);
  assert.deepEqual(titles('$.store.book[?(!@.isbn)].title'), ['Sayings', 'Sword']);
  assert.deepEqual(titles('$.store.book[?(@.isbn && @.price < 10)].title'), ['Moby Dick']);
  assert.deepEqual(titles('$.store.book[?(@.price < 9 || @.price > 20)].title'), [
    'Sayings',
    'Moby Dick',
    'Rings',
  ]);
  assert.deepEqual(titles('$.store.book[?(!(@.price < 9 || @.price > 20))].title'), ['Sword']);
  assert.deepEqual(titles('$.store.book[?(@.author =~ /^m/i)].title'), ['Moby Dick']);
  assert.deepEqual(titles('$.store.book[?(@.title =~ /[/ ]/)].title'), ['Moby Dick']);
  assert.deepEqual(titles('$.store.book[?(@.price =~ /9/)].title'), []);
  assert.deepEqual(titles("$.store.book[?(@['category'] == 'reference')].title"), ['Sayings']);
  assert.deepEqual(titles('$.store.book[?(10 > @.price)].title'), ['Sayings', 'Moby Dick']);
  // Missing operands are never ordered against a value; both-missing counts as equal.
  assert.deepEqual(titles('$.store.book[?(@.isbn < "1")].title'), ['Moby Dick', 'Rings']);
  assert.deepEqual(titles('$.store.book[?(@.nope == @.missing)].title').length, 4);
  // Mixed types never compare as ordered.
  assert.deepEqual(titles('$.store.book[?(@.price < "100")].title'), []);
});

test('filters: @ itself, literals, deep equality, indexes', () => {
  assert.deepEqual(values('[1,"1",true,null,2.0,{"a":[1]}]', '$[?(@ == 1)]'), ['1']);
  assert.deepEqual(values('[1,"1",true,null,2.0]', "$[?(@ == '1')]"), ['"1"']);
  assert.deepEqual(values('[1,"1",true,null,2.0]', '$[?(@ == true)]'), ['true']);
  assert.deepEqual(values('[1,"1",true,null,2.0]', '$[?(@ == null)]'), ['null']);
  assert.deepEqual(values('[1,"1",true,null,2.0]', '$[?(@ == 2)]'), ['2.0']);
  assert.deepEqual(values('[1,"1",true,null,2.0]', '$[?(@ == -1.5e0)]'), []);
  assert.deepEqual(values('[{"a":[1,{"b":2}]},{"a":[1,{"b":3}]}]', '$[?(@.a == $[0].a)]'), [
    '{"a":[1,{"b":2}]}',
  ]);
  assert.deepEqual(
    values('[{"o":{"x":1,"y":2}},{"o":{"y":2,"x":1}},{"o":{"x":1}}]', '$[?(@.o == $[0].o)]').length,
    2,
  );
  assert.deepEqual(values('[[1,2],[3],[]]', '$[?(@[0])]'), ['[1,2]', '[3]']);
  assert.deepEqual(values('[[1,2],[3],[]]', '$[?(@[-1] == 2)]'), ['[1,2]']);
  assert.deepEqual(values('{"a":{"x":1},"b":{"x":2}}', '$[?(@.x == 2)]'), ['{"x":2}']);
  assert.deepEqual(values('[{"a":{"b":5}},{"a":{"b":6}}]', '$[?(@.a.b == 6)]'), ['{"a":{"b":6}}']);
  assert.deepEqual(values('[{"a":[{"k":1}]},{"a":[{"k":2}]}]', '$[?(@.a[?(@.k == 2)])]'), [
    '{"a":[{"k":2}]}',
  ]);
  assert.deepEqual(values('[{"a":1},{"b":1}]', '$[?@.a, ?@.b]'), ['{"a":1}', '{"b":1}']);
});

test('limit caps matches', () => {
  const doc = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i })));
  assert.equal(runQuery(parseTree(doc), '$[*]', 7).length, 7);
  assert.equal(runQuery(parseTree(doc), '$..id', 3).length, 3);
  assert.deepEqual(values(doc, '$..id', 2), ['0', '1']);
  assert.equal(runQuery(parseTree(doc), '$..*').length, 200);
});

test('syntax errors throw short messages', () => {
  const tree = parseTree(EXAMPLE);
  const error = (expression: string, message: string | RegExp) =>
    assert.throws(() => runQuery(tree, expression), { message });
  error('$.crew]', "Unexpected character ']' at 6");
  error('crew', "Unexpected character 'c' at 0");
  error('', 'Unexpected end of query');
  error('$.', 'Unexpected end of query');
  error('$.crew[', 'Unclosed bracket');
  error('$.crew[0', 'Unclosed bracket');
  error('$.crew[?(@.name', 'Unclosed filter');
  error('$.crew[?(@.name == ', 'Unclosed filter');
  error("$['abc", 'Unclosed string');
  error('$[1.5]', "Unexpected character '.' at 3");
  error('$[?(@.a =~ /(/)]', /^Invalid regular expression/);
  error('$[?(@.a =~ /abc)]', 'Unclosed regular expression');
  error('$[?(1)]', /^Expected a comparison/);
  error("$['\\x']", /^Invalid escape/);
  error('$[?(@.a === 1)]', "Unexpected character '=' at 10");
  let nested = '@';
  for (let i = 0; i < 100; i++) nested = `@[?(${nested})]`;
  error(`$[?(${nested})]`, 'Query is nested too deeply');
  error('$ . arr', "Unexpected character ' ' at 3");
});

test('stays bounded on expensive queries', () => {
  const deep = '['.repeat(250) + ']'.repeat(250);
  assert.throws(() => runQuery(parseTree(deep), '$..*..*..*..*'), /Query is too expensive/);
  assert.equal(runQuery(parseTree(deep), '$..*').length, 249);
});

test('filters compare large numbers exactly', () => {
  const root = parseTree('[{"id":9007199254740993},{"id":9007199254740992},{"id":1.0}]');
  assert.deepEqual(
    runQuery(root, '$[?(@.id == 9007199254740992)]').map((m) => m.parts),
    [[1]],
  );
  assert.deepEqual(
    runQuery(root, '$[?(@.id > 9007199254740992)]').map((m) => m.parts),
    [[0]],
  );
  assert.equal(runQuery(root, '$[?(@.id == 1)]').length, 1);
});
