import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, serialize } from '../src/tree';
import { EXAMPLE } from '../src/json';
import {
  FORMATS,
  convert,
  toTypeScript,
  toJSONSchema,
  toYAML,
  toCSV,
  csvToJSON,
} from '../src/convert';

const orbital = parseTree(EXAMPLE);

test('lists the four formats', () => {
  assert.deepEqual(
    FORMATS.map((f) => f.id),
    ['typescript', 'schema', 'yaml', 'csv'],
  );
  for (const f of FORMATS) assert.ok(f.label && f.extension && f.mime && f.description);
  assert.equal(convert(orbital, 'yaml'), toYAML(orbital));
  assert.match(convert(orbital, 'typescript', { rootName: 'mission' }), /export interface Mission/);
});

test('TypeScript: Orbital example', () => {
  assert.equal(
    toTypeScript(orbital),
    `export interface Root {
  project: string;
  version: number;
  status: string;
  settings: Settings;
  crew: CrewItem[];
  nextLaunch: null;
}

export interface Settings {
  theme: string;
  notifications: boolean;
  refreshInterval: number;
}

export interface CrewItem {
  name: string;
  role: string;
}
`,
  );
});

test('TypeScript: optional keys, unions, quoting, dedupe, collisions', () => {
  const tree = parseTree(
    JSON.stringify({
      projects: [
        { id: 1, name: 'a', tags: ['x'], owner: { id: 2, name: 'b' } },
        { id: 2, name: null, extra: true, owner: { id: 3, name: 'c' }, code: 'x' },
        { id: 3, name: 'c', owner: { id: 4, name: 'd' }, code: 7 },
      ],
      lead: { id: 9, name: 'z' },
      items: [1, 'a', { q: 1 }],
      empty: [],
      'my-key': { a: 1 },
      Root: { a: 's' },
      settings: { a: true },
      nested: { settings: { a: 'other', b: 1 } },
    }),
  );
  const ts = toTypeScript(tree);
  assert.match(ts, /^export interface Root \{/);
  assert.match(ts, /projects: Project\[\];/);
  assert.match(ts, /name: string \| null;/);
  assert.match(ts, /tags\?: string\[\];/);
  assert.match(ts, /extra\?: boolean;/);
  assert.match(ts, /code\?: string \| number;/);
  assert.match(ts, /items: \(string \| number \| Item\)\[\];/);
  assert.match(ts, /empty: unknown\[\];/);
  assert.match(ts, /"my-key": MyKey;/);
  // Identical owner and lead shapes share one interface.
  assert.match(ts, /owner: Owner;/);
  assert.match(ts, /lead: Owner;/);
  assert.equal(ts.match(/export interface Owner /g)?.length, 1);
  // Name collisions get numeric suffixes; the root name is reserved.
  assert.match(ts, /Root: Root2;/);
  assert.match(ts, /settings: Settings;/);
  assert.match(ts, /export interface Settings2 \{\n {2}a: string;/);
});

test('TypeScript: primitive and array roots', () => {
  assert.equal(toTypeScript(parseTree('"x"')), 'export type Root = string;\n');
  assert.equal(toTypeScript(parseTree('[]'), 'list'), 'export type List = unknown[];\n');
  assert.equal(
    toTypeScript(parseTree('[{"a":1},{"b":"x"}]')),
    'export type Root = RootItem[];\n\nexport interface RootItem {\n  a?: number;\n  b?: string;\n}\n',
  );
  assert.equal(
    toTypeScript(parseTree('{"categories":[[1,null]]}')),
    'export interface Root {\n  categories: (number | null)[][];\n}\n',
  );
});

test('JSON Schema: Orbital example', () => {
  const schema = JSON.parse(toJSONSchema(orbital));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, [
    'project',
    'version',
    'status',
    'settings',
    'crew',
    'nextLaunch',
  ]);
  assert.deepEqual(schema.properties.version, { type: 'integer' });
  assert.deepEqual(schema.properties.nextLaunch, { type: 'null' });
  assert.deepEqual(schema.properties.crew.items, {
    type: 'object',
    properties: { name: { type: 'string' }, role: { type: 'string' } },
    required: ['name', 'role'],
  });
  assert.ok(toJSONSchema(orbital).startsWith('{\n  "$schema"'));
});

test('JSON Schema: integers, anyOf, required, formats', () => {
  const tree = parseTree(`[
    {"id": 1, "score": 1, "at": "2026-10-03T12:00:00Z", "day": "2026-10-03", "mail": "a@b.co", "site": "https://x.dev", "v": 1},
    {"id": 9007199254740993, "score": 1.0, "at": "2026-10-03T12:00:00.5+02:00", "day": "2026-01-31", "mail": "c@d.org", "site": "ftp://y.example/z", "v": "one"},
    {"id": 2, "score": 2e3, "at": "2026-10-03", "day": "2026-02-01", "mail": "nope", "site": "https://z"}
  ]`);
  const schema = JSON.parse(toJSONSchema(tree));
  assert.equal(schema.type, 'array');
  const { properties, required } = schema.items;
  assert.deepEqual(properties.id, { type: 'integer' });
  assert.deepEqual(properties.score, { type: 'number' });
  assert.deepEqual(properties.at, { type: 'string' });
  assert.deepEqual(properties.day, { type: 'string', format: 'date' });
  assert.deepEqual(properties.mail, { type: 'string' });
  assert.deepEqual(properties.site, { type: 'string', format: 'uri' });
  assert.deepEqual(properties.v, { anyOf: [{ type: 'string' }, { type: 'integer' }] });
  assert.deepEqual(required, ['id', 'score', 'at', 'day', 'mail', 'site']);
  const formats = JSON.parse(toJSONSchema(parseTree('["2026-10-03T12:00:00Z"]')));
  assert.deepEqual(formats.items, { type: 'string', format: 'date-time' });
  const email = JSON.parse(toJSONSchema(parseTree('{"e":"ops@orbital.space"}')));
  assert.deepEqual(email.properties.e, { type: 'string', format: 'email' });
  assert.deepEqual(JSON.parse(toJSONSchema(parseTree('[]'))), {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
  });
});

test('YAML: Orbital example', () => {
  assert.equal(
    toYAML(orbital),
    `project: Orbital
version: 2
status: ready
settings:
  theme: "#b5d68b"
  notifications: true
  refreshInterval: 30
crew:
  - name: Alex
    role: Engineer
  - name: Sam
    role: Designer
nextLaunch: null
`,
  );
});

test('YAML: quoting, exact numbers, nesting, empty containers', () => {
  const tree = parseTree(
    `{"plain":"hello world","empty":"","pad":" x","num":"42","float":"1.5e3","yes":"yes","Off":"Off","tilde":"~","nul":"null",
      "colon":"a: b","hash":"a #b","dash":"- x","star":"*ref","quote":"'q'","multi":"line1\\nline2","url":"https://x.dev/a#b",
      "big":9007199254740993,"exact":1.50,"date":"2026-10-03","": 1,"key: x":2,"true":3,
      "obj":{},"arr":[],"nested":[[1,2],{"a":{"b":[]}}]}`,
  );
  assert.equal(
    toYAML(tree),
    `plain: hello world
empty: ""
pad: " x"
num: "42"
float: "1.5e3"
"yes": "yes"
"Off": "Off"
tilde: "~"
nul: "null"
colon: "a: b"
hash: "a #b"
dash: "- x"
star: "*ref"
quote: "'q'"
multi: "line1\\nline2"
url: https://x.dev/a#b
big: 9007199254740993
exact: 1.50
date: "2026-10-03"
"": 1
"key: x": 2
"true": 3
obj: {}
arr: []
nested:
  - - 1
    - 2
  - a:
      b: []
`,
  );
  assert.equal(toYAML(parseTree('"yes"')), '"yes"\n');
  assert.equal(toYAML(parseTree('-0')), '-0\n');
  assert.equal(toYAML(parseTree('[]')), '[]\n');
  assert.equal(toYAML(parseTree('[null,true,"a\\u2028b"]')), '- null\n- true\n- "a\\u2028b"\n');
});

test('CSV: Orbital example and crew rows', () => {
  assert.equal(
    toCSV(orbital),
    'project,version,status,settings.theme,settings.notifications,settings.refreshInterval,crew,nextLaunch\r\n' +
      'Orbital,2,ready,#b5d68b,true,30,"[{""name"":""Alex"",""role"":""Engineer""},{""name"":""Sam"",""role"":""Designer""}]",\r\n',
  );
  const crew = orbital.type === 'object' ? orbital.members[4].value : orbital;
  assert.equal(toCSV(crew), 'name,role\r\nAlex,Engineer\r\nSam,Designer\r\n');
});

test('CSV: flattening, column order, quoting, numbers, injection', () => {
  const tree = parseTree(`[
    {"id": 9007199254740993, "name": "Alex, Jr.", "tags": ["a", "b"], "settings": {"theme": "dark"}},
    {"id": 2, "note": "say \\"hi\\"\\nbye", "settings": {"theme": "light", "font": {"size": 12}}, "matrix": [[1]]},
    {"id": -3, "name": "=SUM(A1)", "note": "+1 555", "tags": [], "value": "-12.5", "at": "@me", "dash": "-"}
  ]`);
  assert.equal(
    toCSV(tree),
    [
      'id,name,tags,settings.theme,note,settings.font.size,matrix,value,at,dash',
      '9007199254740993,"Alex, Jr.",a; b,dark,,,,,,',
      '2,,,light,"say ""hi""\nbye",12,[[1]],,,',
      "-3,'=SUM(A1),,,'+1 555,,,-12.5,'@me,'-",
      '',
    ].join('\r\n'),
  );
  assert.equal(toCSV(parseTree('[1,"x",null,1.0]')), 'value\r\n1\r\nx\r\n\r\n1.0\r\n');
  assert.throws(() => toCSV(parseTree('"x"')), /CSV needs an array of objects/);
  assert.throws(() => toCSV(parseTree('[[1]]')), /CSV needs an array of objects/);
  assert.throws(() => toCSV(parseTree('[{"a":1},2]')), /CSV needs an array of objects/);
  assert.throws(() => convert(parseTree('[]'), 'csv'), /empty/);
});

test('csvToJSON: types, quoting, delimiters, BOM, duplicates', () => {
  assert.equal(
    csvToJSON(
      '\ufeffid,code,ok,name,name,empty,big\r\n1,007,true,"Alex, ""A""",x,,9007199254740993\r\n-2.5e3,1.0,false,"two\nlines",y,,0\r\n',
    ),
    `[
  {
    "id": 1,
    "code": "007",
    "ok": true,
    "name": "Alex, \\"A\\"",
    "name_2": "x",
    "empty": null,
    "big": 9007199254740993
  },
  {
    "id": -2.5e3,
    "code": 1.0,
    "ok": false,
    "name": "two\\nlines",
    "name_2": "y",
    "empty": null,
    "big": 0
  }
]`,
  );
  assert.equal(csvToJSON('a;b\n1,5;TRUE\n'), '[\n  {\n    "a": "1,5",\n    "b": "TRUE"\n  }\n]');
  assert.equal(csvToJSON('a\tb\n+1\t.5'), '[\n  {\n    "a": "+1",\n    "b": ".5"\n  }\n]');
  assert.equal(csvToJSON('a,b\n1'), '[\n  {\n    "a": 1,\n    "b": null\n  }\n]');
  assert.equal(csvToJSON('only\n'), '[]');
  assert.throws(() => csvToJSON(''), /empty/);
  assert.throws(() => csvToJSON('\ufeff\r\n\r\n'), /empty/);
});

test('round trip: csvToJSON(toCSV(flat array)) is lossless', () => {
  const source = `[
  {
    "id": 9007199254740993,
    "name": "Alex, \\"Lead\\"",
    "role": "Engineer",
    "rate": 1.50,
    "active": true,
    "note": null
  },
  {
    "id": 2,
    "name": "Sam",
    "role": "Line one\\nLine two",
    "rate": -0.25,
    "active": false,
    "note": "ok; fine"
  }
]`;
  assert.equal(csvToJSON(toCSV(parseTree(source))), serialize(parseTree(source), 2));
  assert.equal(csvToJSON(toCSV(parseTree(source))), source);
});

test('CSV export neutralizes tab and carriage-return formula prefixes', () => {
  const csv = toCSV(parseTree('[{"a":"\\t=1+1","b":"\\r=2"}]'));
  assert.ok(csv.includes(`"'\t=1+1"`) || csv.includes(`'\t=1+1`), csv);
  assert.ok(!/(^|,)"?\t=/m.test(csv), csv);
});
