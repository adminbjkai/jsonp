import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE, processJSON } from '../src/json';
import { reusablePath, needsSource, IRD_HEADERS } from '../src/ird';
import {
  TARGET_FIELDS,
  EXAMPLE_MAPPING,
  TARGET_PROJECTS,
  TARGET_CREW,
} from '../src/mapping-example';

test('known target and completed IRD cover precisely the same eleven columns', () => {
  const targets = TARGET_FIELDS.map((field) => `${field.Table}.${field.Field}`);
  assert.equal(new Set(targets).size, 11);
  assert.deepEqual(
    EXAMPLE_MAPPING.map((row) => row['Target Field / Path']),
    targets,
  );
  const paths = new Set(processJSON(EXAMPLE).entries.map((entry) => reusablePath(entry.parts)));
  for (const [index, row] of EXAMPLE_MAPPING.entries()) {
    assert.ok(paths.has(row['Source JSONPath']));
    assert.deepEqual(Object.keys(row), [...IRD_HEADERS]);
    assert.ok(Object.values(row).every((value) => value.length > 0));
    assert.equal(row['Target Type'], TARGET_FIELDS[index].Type);
    assert.equal(row.Required, TARGET_FIELDS[index].Required);
    assert.equal(row['Validation / Constraints'], TARGET_FIELDS[index]['Validation / Constraints']);
  }
});

test('expected target output has declared columns, conversions, keys, and null behavior', () => {
  assert.deepEqual(TARGET_PROJECTS, [
    {
      project_name: 'Orbital',
      version: 2,
      status_code: 'READY',
      theme_hex: '#b5d68b',
      notifications_enabled: 'Y',
      refresh_seconds: 30,
      crew_count: 2,
      next_launch_at: '',
    },
  ]);
  assert.deepEqual(TARGET_CREW, [
    { project_name: 'Orbital', member_name: 'Alex', role_code: 'ENGINEER' },
    { project_name: 'Orbital', member_name: 'Sam', role_code: 'DESIGNER' },
  ]);
  for (const [table, rows] of [
    ['Projects', TARGET_PROJECTS],
    ['Crew', TARGET_CREW],
  ] as const) {
    const fields = TARGET_FIELDS.filter((field) => field.Table === table).map(
      (field) => field.Field,
    );
    for (const row of rows) assert.deepEqual(Object.keys(row), fields);
  }
  assert.equal(TARGET_PROJECTS[0].crew_count, TARGET_CREW.length);
  assert.ok(TARGET_CREW.every((row) => row.project_name === TARGET_PROJECTS[0].project_name));
});

test('built-in example downloads and blank template never need current source', () => {
  for (const kind of ['blank', 'example-target', 'example-mapping'] as const)
    assert.equal(needsSource(kind), false);
  for (const kind of ['ird', 'samples'] as const) assert.equal(needsSource(kind), true);
});
