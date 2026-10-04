import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTree, serialize } from '../src/lib/tree';
import { EXAMPLE } from '../src/lib/json';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  FORMATS,
  convert,
  toTypeScript,
  toJSONSchema,
  toYAML,
  toCSV,
  csvToJSON,
  toGo,
  toRust,
  toPython,
  toZod,
  toKotlin,
  toCSharp,
  toXML,
} from '../src/lib/convert';

const orbital = parseTree(EXAMPLE);

test('lists the formats in Types and Data groups', () => {
  assert.deepEqual(
    FORMATS.map((f) => f.id),
    [
      'typescript',
      'schema',
      'go',
      'rust',
      'python',
      'zod',
      'kotlin',
      'csharp',
      'yaml',
      'csv',
      'xml',
    ],
  );
  assert.deepEqual(
    FORMATS.filter((f) => f.group === 'data').map((f) => f.id),
    ['yaml', 'csv', 'xml'],
  );
  for (const f of FORMATS) {
    assert.ok(f.label && f.extension && f.mime && f.description);
    assert.ok(!f.extension.startsWith('.'));
    assert.ok(f.group === 'types' || f.group === 'data');
  }
  assert.equal(new Set(FORMATS.map((f) => f.label)).size, FORMATS.length);
  assert.equal(convert(orbital, 'yaml'), toYAML(orbital));
  assert.match(convert(orbital, 'typescript', { rootName: 'mission' }), /export interface Mission/);
  for (const f of FORMATS)
    if (f.id !== 'csv') assert.ok(convert(orbital, f.id, { rootName: 'Root' }).endsWith('\n'));
  assert.equal(convert(orbital, 'go'), toGo(orbital));
  assert.equal(convert(orbital, 'xml', { rootName: 'Mission' }), toXML(orbital, 'Mission'));
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

// ---- Typed languages ----------------------------------------------------------------------

/** Keys that are reserved words somewhere, need renaming, collide, or are optional/nullable. */
const tricky = parseTree(
  JSON.stringify({
    type: 'x',
    class: 1,
    fun: true,
    'my-key': 'a',
    'user id': null,
    userID: 2,
    ['__proto__']: 'p',
    items: [{ id: 1, when: 'a', self: { x: 1 } }, { id: 2.5, opt: [1], when: null }, { id: 3 }],
    matrix: [[1, null]],
    mixed: [1, 'a', { q: 1 }],
    empty: [],
    emptyObj: {},
    List: { a: 1 },
    'a"b`c\n$x': 1,
    '-': 1,
    '': 2,
    '9lives': 3,
    Root: { Root: 1 },
    field: 1,
    String: { Vec: 's' },
  }),
);

test('tricky fixture keeps __proto__ as an ordinary key', () => {
  assert.ok(tricky.type === 'object' && tricky.members.some((m) => m.key === '__proto__'));
});

test('Go: Orbital example', () => {
  assert.equal(
    toGo(orbital),
    [
      'package model',
      '',
      'type Root struct {',
      '\tProject    string     `json:"project"`',
      '\tVersion    int64      `json:"version"`',
      '\tStatus     string     `json:"status"`',
      '\tSettings   Settings   `json:"settings"`',
      '\tCrew       []CrewItem `json:"crew"`',
      '\tNextLaunch any        `json:"nextLaunch"`',
      '}',
      '',
      'type Settings struct {',
      '\tTheme           string `json:"theme"`',
      '\tNotifications   bool   `json:"notifications"`',
      '\tRefreshInterval int64  `json:"refreshInterval"`',
      '}',
      '',
      'type CrewItem struct {',
      '\tName string `json:"name"`',
      '\tRole string `json:"role"`',
      '}',
      '',
    ].join('\n'),
  );
});

test('Go: initialisms, pointers, omitempty, unrepresentable tags, collisions, roots', () => {
  const go = toGo(tricky);
  assert.match(go, /\tUserID +any +`json:"user id"`/);
  assert.match(go, /\tUserID2 +int64 +`json:"userID"`/);
  assert.match(go, /\tMyKey +string +`json:"my-key"`/);
  assert.match(go, /\tMatrix +\[\]\[\]\*int64 /);
  assert.match(go, /\tMixed +\[\]any /);
  assert.match(go, /\tEmpty +\[\]any /);
  assert.match(go, /\tField +int64 +`json:"-,"`/);
  assert.match(go, /`json:"-"` \/\/ JSON key "" cannot be used in a struct tag/);
  assert.match(go, /`json:"-"` \/\/ JSON key "a\\"b`c\\n\$x" cannot be used/);
  assert.match(go, /\tField9lives +int64 +`json:"9lives"`/);
  assert.match(go, /\tRoot +Root2 +`json:"Root"`/);
  assert.match(
    go,
    /type Item struct \{\n\tID +float64 +`json:"id"`\n\tWhen +\*string +`json:"when,omitempty"`/,
  );
  assert.match(go, /\tSelf +\*Self +`json:"self,omitempty"`/);
  assert.match(go, /\tOpt +\[\]int64 +`json:"opt,omitempty"`/);
  assert.match(go, /type EmptyObj struct\{\}/);
  assert.match(
    toGo(parseTree('{"html_url":"x","apiKey":"k","ids":[1]}')),
    /HTMLURL .*\n\tAPIKey .*\n\tIDs /,
  );
  assert.equal(
    toGo(parseTree('[{"a":1},{"b":"x"}]')),
    'package model\n\ntype Root []RootItem\n\ntype RootItem struct {\n\tA *int64  `json:"a,omitempty"`\n\tB *string `json:"b,omitempty"`\n}\n',
  );
  assert.equal(toGo(parseTree('"x"'), 'name'), 'package model\n\ntype Name string\n');
  assert.equal(toGo(parseTree('{"a":{"b":null}}'), 'x'), toGo(parseTree('{"a":{"b":null}}'), 'X'));
});

test('Rust: Orbital example', () => {
  assert.equal(
    toRust(orbital),
    `use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Root {
    pub project: String,
    pub version: i64,
    pub status: String,
    pub settings: Settings,
    pub crew: Vec<CrewItem>,
    #[serde(rename = "nextLaunch")]
    pub next_launch: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub theme: String,
    pub notifications: bool,
    #[serde(rename = "refreshInterval")]
    pub refresh_interval: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrewItem {
    pub name: String,
    pub role: String,
}
`,
  );
});

test('Rust: keywords, renames, Option, Value, reserved type names', () => {
  const rust = toRust(tricky);
  assert.match(rust, /#\[serde\(rename = "type"\)\]\n {4}pub type_: String,/);
  assert.match(rust, /\n {4}pub class: i64,/);
  assert.match(rust, /#\[serde\(rename = "my-key"\)\]\n {4}pub my_key: String,/);
  assert.match(
    rust,
    /#\[serde\(rename = "user id"\)\]\n {4}pub user_id: Option<serde_json::Value>,/,
  );
  assert.match(rust, /#\[serde\(rename = "userID"\)\]\n {4}pub user_id2: i64,/);
  assert.match(rust, /#\[serde\(rename = "a\\"b`c\\n\$x"\)\]/);
  assert.match(rust, /pub matrix: Vec<Vec<Option<i64>>>,/);
  assert.match(rust, /pub mixed: Vec<serde_json::Value>,/);
  assert.match(rust, /pub empty: Vec<serde_json::Value>,/);
  assert.match(
    rust,
    /#\[serde\(default, skip_serializing_if = "Option::is_none"\)\]\n {4}pub when: Option<String>,/,
  );
  assert.match(rust, /pub self_: Option<Self2>,/);
  assert.match(rust, /#\[serde\(rename = "String"\)\]\n {4}pub string: String2,/);
  assert.match(
    rust,
    /pub struct String2 \{\n {4}#\[serde\(rename = "Vec"\)\]\n {4}pub vec: String,/,
  );
  assert.match(rust, /pub struct EmptyObj \{\}/);
  assert.match(rust, /pub field_9lives: i64,/);
  assert.equal(
    toRust(parseTree('[1,"a",null]')),
    'pub type Root = Vec<Option<serde_json::Value>>;\n',
  );
  assert.match(toRust(parseTree('"\\u0001"')), /^pub type Root = String;\n$/);
  assert.match(toRust(parseTree('{"\\u0001":1}')), /rename = "\\u\{0001\}"/);
});

test('Python: Orbital example', () => {
  assert.equal(
    toPython(orbital),
    `from __future__ import annotations

from dataclasses import dataclass, field
from typing import List


@dataclass(kw_only=True)
class Root:
    project: str
    version: int
    status: str
    settings: Settings
    crew: List[CrewItem]
    next_launch: None = field(metadata={"json": "nextLaunch"})


@dataclass(kw_only=True)
class Settings:
    theme: str
    notifications: bool
    refresh_interval: int = field(metadata={"json": "refreshInterval"})


@dataclass(kw_only=True)
class CrewItem:
    name: str
    role: str
`,
  );
});

test('Python: keywords, Optional defaults, unions, aliases', () => {
  const py = toPython(tricky);
  assert.match(py, /\n {4}type: str\n/);
  assert.match(py, /\n {4}class_: int = field\(metadata=\{"json": "class"\}\)/);
  assert.match(py, /\n {4}field_3: int = field\(metadata=\{"json": "field"\}\)/);
  assert.match(py, /\n {4}field_: int = field\(metadata=\{"json": "-"\}\)/);
  assert.match(py, /\n {4}mixed: List\[Union\[str, int, MixedItem\]\]/);
  assert.match(py, /\n {4}matrix: List\[List\[Optional\[int\]\]\]/);
  assert.match(py, /\n {4}empty: List\[Any\]/);
  assert.match(py, /\n {4}when: Optional\[str\] = None\n/);
  assert.match(py, /\n {4}self: Optional\[Self\] = None\n/);
  assert.match(py, /\n {4}list: List2 = field\(metadata=\{"json": "List"\}\)/);
  assert.match(py, /class EmptyObj:\n {4}pass/);
  assert.match(py, /from typing import Any, List, Optional, Union\n/);
  assert.equal(
    toPython(parseTree('[{"my-key":1},{"b":"x"}]')),
    `from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass(kw_only=True)
class RootItem:
    my_key: Optional[int] = field(default=None, metadata={"json": "my-key"})
    b: Optional[str] = None


Root = List[RootItem]
`,
  );
  assert.equal(toPython(parseTree('"x"')), 'from __future__ import annotations\n\n\nRoot = str\n');
  assert.match(toPython(parseTree('{"true":{"a":1}}')), /\n {4}true: True2\n[\s\S]*class True2:/);
});

test('Zod: Orbital example in dependency order', () => {
  assert.equal(
    toZod(orbital),
    `import { z } from 'zod';

export const SettingsSchema = z.object({
  theme: z.string(),
  notifications: z.boolean(),
  refreshInterval: z.number().int(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const CrewItemSchema = z.object({
  name: z.string(),
  role: z.string(),
});
export type CrewItem = z.infer<typeof CrewItemSchema>;

export const RootSchema = z.object({
  project: z.string(),
  version: z.number().int(),
  status: z.string(),
  settings: SettingsSchema,
  crew: z.array(CrewItemSchema),
  nextLaunch: z.null(),
});
export type Root = z.infer<typeof RootSchema>;
`,
  );
});

test('Zod: quoting, __proto__, optional, nullable, unions, roots', () => {
  const zod = toZod(tricky);
  assert.match(zod, /\n {2}"my-key": z\.string\(\),/);
  assert.match(zod, /\n {2}\["__proto__"\]: z\.string\(\),/);
  assert.match(zod, /\n {2}class: z\.number\(\)\.int\(\),/);
  assert.match(zod, /\n {2}when: z\.string\(\)\.nullable\(\)\.optional\(\),/);
  assert.match(zod, /\n {2}matrix: z\.array\(z\.array\(z\.number\(\)\.int\(\)\.nullable\(\)\)\),/);
  assert.match(
    zod,
    /\n {2}mixed: z\.array\(z\.union\(\[z\.string\(\), z\.number\(\)\.int\(\), MixedItemSchema\]\)\),/,
  );
  assert.match(zod, /\n {2}empty: z\.array\(z\.unknown\(\)\),/);
  assert.match(zod, /\n {2}"a\\"b`c\\n\$x": z\.number\(\)\.int\(\),/);
  assert.match(zod, /\n {2}Root: Root2Schema,/);
  // Every schema is declared before it is referenced.
  const declared: string[] = [];
  for (const [, name, body] of zod.matchAll(/export const (\w+) = ([^;]*);/g)) {
    for (const [used] of body.matchAll(/\w+Schema\b/g)) assert.ok(declared.includes(used), used);
    declared.push(name);
  }
  assert.equal(declared.at(-1), 'RootSchema');
  assert.ok(declared.indexOf('SelfSchema') < declared.indexOf('ItemSchema'));
  assert.equal(
    toZod(parseTree('[1,"a",null]')),
    "import { z } from 'zod';\n\nexport const RootSchema = z.array(z.union([z.string(), z.number().int()]).nullable());\nexport type Root = z.infer<typeof RootSchema>;\n",
  );
});

test('Kotlin: Orbital example', () => {
  assert.equal(
    toKotlin(orbital),
    `import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class Root(
    val project: String,
    val version: Long,
    val status: String,
    val settings: Settings,
    val crew: List<CrewItem>,
    val nextLaunch: JsonElement?,
)

@Serializable
data class Settings(
    val theme: String,
    val notifications: Boolean,
    val refreshInterval: Long,
)

@Serializable
data class CrewItem(
    val name: String,
    val role: String,
)
`,
  );
});

test('Kotlin: backticked keywords, @SerialName, defaults, empty classes', () => {
  const kt = toKotlin(tricky);
  assert.match(kt, /^import kotlinx\.serialization\.SerialName\n/);
  assert.match(kt, /\n {4}val `class`: Long,/);
  assert.match(kt, /\n {4}val `fun`: Boolean,/);
  assert.match(kt, /\n {4}val type: String,/);
  assert.match(kt, /\n {4}@SerialName\("my-key"\) val myKey: String,/);
  assert.match(kt, /\n {4}@SerialName\("user id"\) val userId: JsonElement\?,/);
  assert.match(kt, /\n {4}val userID: Long,/);
  assert.match(kt, /\n {4}@SerialName\("a\\"b`c\\n\\\$x"\) val aBCX: Long,/);
  assert.match(kt, /\n {4}val `when`: String\? = null,/);
  assert.match(kt, /\n {4}val matrix: List<List<Long\?>>,/);
  assert.match(kt, /\n {4}val mixed: List<JsonElement>,/);
  assert.match(kt, /\n {4}@SerialName\("List"\) val list: List2,/);
  assert.match(kt, /@Serializable\nclass EmptyObj\n/);
  assert.match(kt, /@SerialName\("String"\) val string: String2,/);
  assert.equal(
    toKotlin(parseTree('[{"a":1}]')),
    'import kotlinx.serialization.Serializable\n\ntypealias Root = List<RootItem>\n\n@Serializable\ndata class RootItem(\n    val a: Long,\n)\n',
  );
});

test('C#: Orbital example', () => {
  const cs = toCSharp(orbital);
  assert.ok(
    cs.startsWith(
      'using System.Collections.Generic;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\n\n#nullable enable\n\npublic sealed class Root\n{\n',
    ),
  );
  assert.match(
    cs,
    /\[JsonPropertyName\("project"\)\]\n {4}public required string Project \{ get; set; \}/,
  );
  assert.match(cs, /public required long Version \{ get; set; \}/);
  assert.match(cs, /public required List<CrewItem> Crew \{ get; set; \}/);
  assert.match(
    cs,
    /\[JsonPropertyName\("nextLaunch"\)\]\n {4}public required JsonElement\? NextLaunch/,
  );
  assert.match(cs, /public sealed class Settings\n\{\n {4}\[JsonPropertyName\("theme"\)\]/);
  assert.match(cs, /public required bool Notifications \{ get; set; \}/);
  assert.ok(
    cs.endsWith(
      '    [JsonPropertyName("role")]\n    public required string Role { get; set; }\n}\n',
    ),
  );
});

test('C#: optional members, member named like its class, escaping, roots', () => {
  const cs = toCSharp(tricky);
  assert.match(cs, /\[JsonPropertyName\("when"\)\]\n {4}public string\? When \{ get; set; \}/);
  assert.match(cs, /\[JsonPropertyName\("my-key"\)\]\n {4}public required string MyKey/);
  assert.match(cs, /\[JsonPropertyName\("a\\"b`c\\n\$x"\)\]/);
  assert.match(cs, /public required List<List<long\?>> Matrix/);
  assert.match(cs, /public required List<JsonElement> Mixed/);
  // A member can't share its class's name.
  assert.match(
    toCSharp(parseTree('{"settings":{"settings":1}}')),
    /public sealed class Settings\n\{\n {4}\[JsonPropertyName\("settings"\)\]\n {4}public required long Settings2 \{/,
  );
  assert.match(cs, /public sealed class EmptyObj\n\{\n\}/);
  assert.equal(
    toCSharp(parseTree('[1]')),
    'using System.Collections.Generic;\n\n#nullable enable\n\n// Deserialize the document as List<long>.\n',
  );
});

test('typed generators share collision handling and dedupe identical shapes', () => {
  const tree = parseTree(
    '{"owner":{"id":1,"name":"a"},"lead":{"id":2,"name":"b"},"settings":{"a":1},"nested":{"settings":{"b":"x"}}}',
  );
  assert.equal(toGo(tree).match(/^type Owner struct/gm)?.length, 1);
  assert.match(toGo(tree), /\tLead +Owner +`json:"lead"`/);
  assert.match(toRust(tree), /pub struct Settings2 \{\n {4}pub b: String,/);
  assert.match(toKotlin(tree), /data class Settings2\(\n {4}val b: String,/);
  assert.match(toCSharp(tree), /public sealed class Settings2\n/);
  assert.match(toPython(tree), /class Settings2:\n {4}b: str/);
  assert.match(toZod(tree), /export const Settings2Schema = z\.object\(\{\n {2}b: z\.string\(\),/);
});

// ---- XML ----------------------------------------------------------------------------------

const xmlParser = () =>
  new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    htmlEntities: true,
    trimValues: false,
  });

test('XML: Orbital example parses back with fast-xml-parser', () => {
  const xml = toXML(orbital);
  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <project>Orbital</project>
  <version>2</version>
  <status>ready</status>
  <settings>
    <theme>#b5d68b</theme>
    <notifications>true</notifications>
    <refreshInterval>30</refreshInterval>
  </settings>
  <crew>
    <item>
      <name>Alex</name>
      <role>Engineer</role>
    </item>
    <item>
      <name>Sam</name>
      <role>Designer</role>
    </item>
  </crew>
  <nextLaunch/>
</root>
`,
  );
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser().parse(xml);
  assert.deepEqual(parsed.root, {
    project: 'Orbital',
    version: 2,
    status: 'ready',
    settings: { theme: '#b5d68b', notifications: true, refreshInterval: 30 },
    crew: {
      item: [
        { name: 'Alex', role: 'Engineer' },
        { name: 'Sam', role: 'Designer' },
      ],
    },
    nextLaunch: '',
  });
});

test('XML: escaping, sanitized names, exact numbers, arrays, round trip', () => {
  const tree = parseTree(
    JSON.stringify({
      text: 'a & b < c > d "q" \'s\' ]]>',
      cr: 'line\r\nnext',
      control: 'bell\u0007',
      'my key': 1,
      '1st': 2,
      'a:b': 3,
      '': 4,
      ünïcode: 'ok',
      tags: ['x', 'y'],
      categories: [[1, 2], []],
      status: [true],
      empty: '',
      nothing: null,
      obj: {},
    }).slice(0, -1) + ',"big":9007199254740993,"exact":1.50}',
  );
  const xml = toXML(tree, 'doc');
  assert.equal(XMLValidator.validate(xml), true);
  assert.match(xml, /<text>a &amp; b &lt; c &gt; d "q" 's' \]\]&gt;<\/text>/);
  assert.match(xml, /<cr>line&#13;\nnext<\/cr>/);
  assert.match(xml, /<control>bell\ufffd<\/control>/);
  assert.match(xml, /<my_key key="my key">1<\/my_key>/);
  assert.match(xml, /<_1st key="1st">2<\/_1st>/);
  assert.match(xml, /<a_b key="a:b">3<\/a_b>/);
  assert.match(xml, /<_ key="">4<\/_>/);
  assert.match(xml, /<ünïcode>ok<\/ünïcode>/);
  assert.match(xml, /<tags>\n {4}<tag>x<\/tag>\n {4}<tag>y<\/tag>\n {2}<\/tags>/);
  assert.match(xml, /<categories>\n {4}<category>\n {6}<item>1<\/item>/);
  assert.match(xml, /<category\/>/);
  assert.match(xml, /<status>\n {4}<item>true<\/item>/);
  assert.match(xml, /<empty><\/empty>/);
  assert.match(xml, /<nothing\/>/);
  assert.match(xml, /<obj\/>/);
  assert.match(xml, /<big>9007199254740993<\/big>/);
  assert.match(xml, /<exact>1\.50<\/exact>/);
  const doc = xmlParser().parse(xml).doc;
  assert.equal(doc.text, 'a & b < c > d "q" \'s\' ]]>');
  assert.equal(doc.cr, 'line\r\nnext');
  assert.deepEqual(doc.my_key, { '#text': '1', '@_key': 'my key' });
  assert.deepEqual(doc.tags.tag, ['x', 'y']);
  assert.equal(doc.big, '9007199254740993');
  assert.equal(doc.exact, '1.50');
  assert.equal(toXML(parseTree('"x"')), '<?xml version="1.0" encoding="UTF-8"?>\n<root>x</root>\n');
  assert.equal(
    toXML(parseTree('[1,[2]]'), 'my list'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<my_list>\n  <item>1</item>\n  <item>\n    <item>2</item>\n  </item>\n</my_list>\n',
  );
  const attr = toXML(parseTree('{"a\\"<&\\n\\t\\r":1}'));
  assert.match(attr, /key="a&quot;&lt;&amp;&#10;&#9;&#13;"/);
  assert.equal(xmlParser().parse(attr).root.a______['@_key'], 'a"<&\n\t\r');
});
