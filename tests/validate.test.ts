import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../src/validate';
import { toJSONSchema } from '../src/convert';
import { parseTree } from '../src/tree';
import { EXAMPLE, processJSON } from '../src/json';

const schema = (value: unknown) => JSON.stringify(value);

const orbitalSchema = schema({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['project', 'version', 'crew'],
  properties: {
    project: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    status: { enum: ['draft', 'ready'] },
    settings: {
      type: 'object',
      additionalProperties: false,
      properties: {
        theme: { type: 'string' },
        notifications: { type: 'boolean' },
        refreshInterval: { type: 'integer' },
      },
    },
    crew: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'role'],
        properties: { name: { type: 'string' }, role: { type: 'string' } },
      },
    },
    nextLaunch: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  },
});

test('valid document', () => {
  assert.deepEqual(validateDocument(EXAMPLE, orbitalSchema), {
    valid: true,
    issues: [],
    draft: 'draft 2020-12',
  });
  assert.equal(validateDocument('1', 'true').valid, true);
  assert.equal(validateDocument('1', 'false').valid, false);
});

test('type errors point at the value with Entry.path pointers', () => {
  const doc = EXAMPLE.replace('"version": 2', '"version": "2"').replace('"Sam"', '7');
  const result = validateDocument(doc, orbitalSchema);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.map(({ pointer, message, keyword }) => ({ pointer, message, keyword })),
    [
      { pointer: '/version', message: 'Expected an integer, found a string.', keyword: 'type' },
      { pointer: '/crew/1/name', message: 'Expected a string, found a number.', keyword: 'type' },
    ],
  );
  assert.equal(result.issues[1].schemaPointer, '/properties/crew/items/properties/name/type');
  // Pointers are the same strings the explorer uses for entries.
  const paths = new Set(processJSON(doc).entries.map((e) => e.path));
  for (const issue of result.issues) assert.ok(paths.has(issue.pointer), issue.pointer);
});

test('missing required property points at the object', () => {
  const result = validateDocument('{"project":"x","crew":[{"name":"A"}]}', orbitalSchema);
  assert.deepEqual(
    result.issues.map(({ pointer, message }) => ({ pointer, message })),
    [
      { pointer: '', message: 'Missing required property "version".' },
      { pointer: '/crew/0', message: 'Missing required property "role".' },
    ],
  );
});

test('additionalProperties false reports only undeclared keys, at the key', () => {
  const doc = EXAMPLE.replace('"theme": "#b5d68b"', '"theme": 5, "font size": 12, "a/b~c": 1');
  const result = validateDocument(doc, orbitalSchema);
  assert.deepEqual(
    result.issues.map(({ pointer, message, keyword }) => ({ pointer, message, keyword })),
    [
      {
        pointer: '/settings/theme',
        message: 'Expected a string, found a number.',
        keyword: 'type',
      },
      {
        pointer: '/settings/font size',
        message: 'Property "font size" is not allowed.',
        keyword: 'additionalProperties',
      },
      {
        pointer: '/settings/a~1b~0c',
        message: 'Property "a/b~c" is not allowed.',
        keyword: 'additionalProperties',
      },
    ],
  );
  const paths = new Set(processJSON(doc).entries.map((e) => e.path));
  for (const issue of result.issues) assert.ok(paths.has(issue.pointer), issue.pointer);
});

test('enum, const, minimum, format, and anyOf messages are plain language', () => {
  const doc = EXAMPLE.replace('"ready"', '"done"')
    .replace('"version": 2', '"version": 0')
    .replace('"nextLaunch": null', '"nextLaunch": "soon"');
  const messages = validateDocument(doc, orbitalSchema).issues.map(
    (i) => `${i.pointer} ${i.message}`,
  );
  assert.deepEqual(messages, [
    '/version 0 is less than 1.',
    '/status Must be one of "draft", "ready".',
    '/nextLaunch Not a valid date.',
  ]);
  const nullable = validateDocument('{"nextLaunch": 5}', orbitalSchema).issues;
  assert.ok(
    nullable.some(
      (i) =>
        i.pointer === '/nextLaunch' && i.message === 'Expected a string or null, found a number.',
    ),
  );
  assert.deepEqual(
    validateDocument('"b"', schema({ const: 'a' })).issues[0].message,
    'Must equal "a".',
  );
});

test('draft-07 and draft-04 schemas are detected and honored', () => {
  const draft7 = schema({
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: { positive: { type: 'number', exclusiveMinimum: 0 } },
    type: 'object',
    properties: { n: { $ref: '#/definitions/positive' }, list: { items: [{ type: 'string' }] } },
  });
  const result = validateDocument('{"n": 0, "list": [1]}', draft7);
  assert.equal(result.draft, 'draft-07');
  assert.deepEqual(
    result.issues.map((i) => i.pointer),
    ['/n', '/list/0'],
  );
  assert.equal(validateDocument('{"n": 1, "list": ["a", 2]}', draft7).valid, true);
  const draft4 = schema({
    $schema: 'http://json-schema.org/draft-04/schema#',
    properties: { n: { type: 'number', minimum: 0, exclusiveMinimum: true } },
  });
  const four = validateDocument('{"n": 0}', draft4);
  assert.equal(four.draft, 'draft-04');
  assert.equal(four.valid, false);
  assert.equal(
    validateDocument('{}', schema({ $schema: 'https://json-schema.org/draft/2019-09/schema' }))
      .draft,
    'draft 2019-09',
  );
});

test('invalid schema text and unusable schemas report schemaError', () => {
  const bad = validateDocument(EXAMPLE, '{"type": "object",}');
  assert.equal(bad.valid, false);
  assert.match(bad.schemaError!, /^The schema isn’t valid JSON/);
  assert.deepEqual(bad.issues, []);
  assert.match(validateDocument(EXAMPLE, '[1]').schemaError!, /must be a JSON object/);
  assert.match(validateDocument(EXAMPLE, '{"$ref": "#/nope"}').schemaError!, /can’t be used/);
  assert.match(validateDocument('"x"', '{"pattern": "("}').schemaError!, /can’t be used/);
  assert.match(validateDocument('{', '{}').issues[0].message, /document isn’t valid JSON/);
});

test('generated schema validates its own source document', () => {
  for (const source of [
    EXAMPLE,
    '[{"id":1,"name":"a","tags":["x"]},{"id":2.5,"name":null,"extra":{"deep":[[1,"a"]]}}]',
    '{"big": 90071992547409930000123, "exact": 1.50, "when": "2026-10-03", "at": "2026-10-03T12:00:00Z"}',
  ]) {
    const result = validateDocument(source, toJSONSchema(parseTree(source)));
    assert.deepEqual(result, { valid: true, issues: [], draft: 'draft 2020-12' }, source);
  }
  const generated = toJSONSchema(parseTree(EXAMPLE));
  const broken = validateDocument(EXAMPLE.replace('"Alex"', 'false'), generated);
  assert.deepEqual(
    broken.issues.map((i) => [i.pointer, i.message]),
    [['/crew/0/name', 'Expected a string, found a boolean.']],
  );
});

test('numbers beyond 2^53 do not crash and issues are capped at 500', () => {
  assert.equal(
    validateDocument('{"n": 123456789012345678901234567890}', '{"type":"object"}').valid,
    true,
  );
  assert.equal(validateDocument('1e400', '{"type":"number"}').valid, true);
  const many = JSON.stringify(Array.from({ length: 700 }, (_, i) => i));
  const result = validateDocument(many, schema({ items: { type: 'string' } }));
  assert.equal(result.issues.length, 500);
  assert.equal(result.issues[0].pointer, '/0');
  assert.equal(result.issues[499].pointer, '/499');
});

test('duplicate messages are collapsed and wrappers are not reported', () => {
  const result = validateDocument(
    '{"a": 1}',
    schema({
      allOf: [{ properties: { a: { type: 'string' } } }, { properties: { a: { type: 'string' } } }],
    }),
  );
  assert.deepEqual(
    result.issues.map((i) => [i.pointer, i.message]),
    [['/a', 'Expected a string, found a number.']],
  );
});
