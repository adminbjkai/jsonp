import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE, processJSON } from '../src/lib/json';
import { reusablePath, needsSource, IRD_COLUMNS } from '../src/lib/ird';
import {
  TABLE_FIELDS,
  TABLE_PROJECTS,
  TABLE_CREW,
  exampleMapping,
  exampleOverview,
  exampleGuide,
} from '../src/lib/mapping-example';

test('known target and completed IRD cover precisely the same eleven columns', () => {
  const targets = TABLE_FIELDS.map((field) => `${field.Table}.${field.Field}`);
  assert.equal(new Set(targets).size, 11);
  assert.deepEqual(
    exampleMapping('source').map((row) => row['Target Field / Path']),
    targets,
  );
  const paths = new Set(processJSON(EXAMPLE).entries.map((entry) => reusablePath(entry.parts)));
  for (const [index, row] of exampleMapping('source').entries()) {
    assert.ok(paths.has(row['Source JSONPath']));
    assert.deepEqual(Object.keys(row), [...IRD_COLUMNS.source]);
    assert.ok(Object.values(row).every((value) => value.length > 0));
    assert.equal(row['Target Type'], TABLE_FIELDS[index].Type);
    assert.equal(row.Required, TABLE_FIELDS[index].Required);
    assert.equal(row['Validation / Constraints'], TABLE_FIELDS[index]['Validation / Constraints']);
  }
});

test('expected target output has declared columns, conversions, keys, and null behavior', () => {
  assert.deepEqual(TABLE_PROJECTS, [
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
  assert.deepEqual(TABLE_CREW, [
    { project_name: 'Orbital', member_name: 'Alex', role_code: 'ENGINEER' },
    { project_name: 'Orbital', member_name: 'Sam', role_code: 'DESIGNER' },
  ]);
  for (const [table, rows] of [
    ['Projects', TABLE_PROJECTS],
    ['Crew', TABLE_CREW],
  ] as const) {
    const fields = TABLE_FIELDS.filter((field) => field.Table === table).map(
      (field) => field.Field,
    );
    for (const row of rows) assert.deepEqual(Object.keys(row), fields);
  }
  assert.equal(TABLE_PROJECTS[0].crew_count, TABLE_CREW.length);
  assert.ok(TABLE_CREW.every((row) => row.project_name === TABLE_PROJECTS[0].project_name));
});

test('built-in example downloads and blank template never need current source', () => {
  for (const kind of ['blank', 'example-tables', 'example-mapping'] as const)
    assert.equal(needsSource(kind), false);
  for (const kind of ['ird', 'samples'] as const) assert.equal(needsSource(kind), true);
});

test('known-source IRD maps the same eleven columns into the example JSON paths', () => {
  const rows = exampleMapping('target');
  const columns = TABLE_FIELDS.map((field) => `${field.Table}.${field.Field}`);
  assert.deepEqual(
    rows.map((row) => row['Source Field / Path']),
    columns,
  );
  const paths = new Set(processJSON(EXAMPLE).entries.map((entry) => reusablePath(entry.parts)));
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(Object.keys(row), [...IRD_COLUMNS.target]);
    assert.ok(Object.values(row).every((value) => value.length > 0));
    assert.ok(paths.has(row['Target JSONPath']), row['Target JSONPath']);
    assert.equal(row['Source Type'], TABLE_FIELDS[index].Type);
    assert.equal(row.Required, TABLE_FIELDS[index].Required);
    assert.equal(row['Target Field'], row['Target JSONPath'].split('.').at(-1));
  }
  // Every JSON field is covered except the pure containers, which exist only to hold other fields.
  const covered = new Set(rows.map((row) => row['Target JSONPath']));
  const containers = new Set(['$', '$.settings', '$.crew[*]']);
  for (const path of paths) if (!containers.has(path)) assert.ok(covered.has(path), path);
});

test('the known-source rules rebuild the example JSON exactly from its tables', () => {
  const [project] = TABLE_PROJECTS;
  const capitalize = (text: string) => text[0] + text.slice(1).toLowerCase();
  const rebuilt = {
    project: project.project_name,
    version: project.version,
    status: project.status_code.toLowerCase(),
    settings: {
      theme: project.theme_hex,
      notifications: project.notifications_enabled === 'Y',
      refreshInterval: project.refresh_seconds,
    },
    crew: TABLE_CREW.filter((row) => row.project_name === project.project_name).map((row) => ({
      name: row.member_name,
      role: capitalize(row.role_code),
    })),
    nextLaunch: project.next_launch_at === '' ? null : project.next_launch_at,
  };
  assert.deepEqual(rebuilt, JSON.parse(EXAMPLE));
  assert.equal(project.crew_count, rebuilt.crew.length);
  assert.deepEqual(Object.keys(rebuilt), Object.keys(JSON.parse(EXAMPLE)));
});

test('example overview and guide name the right systems for each role', () => {
  const field = (rows: string[][], name: string) => rows.find((row) => row[0] === name)![1];
  const source = exampleOverview('source');
  const target = exampleOverview('target');
  assert.match(field(source, 'Source System'), /JSON/);
  assert.match(field(source, 'Target System'), /Orbital_Target_Example/);
  assert.match(field(target, 'Source System'), /Orbital_Source_Example/);
  assert.match(field(target, 'Target System'), /JSON/);
  assert.equal(target[0][1], 'Known-source worked example');
  assert.match(field(exampleGuide('target'), 'Start'), /Known-source/);
  assert.match(field(exampleGuide('source'), 'Start'), /Known-target/);
});

test('the join key reads backward as selecting the Crew rows, not as a second write to $.project', () => {
  const rows = exampleMapping('target');
  const join = rows.find((row) => row['Source Field / Path'] === 'Crew.project_name')!;
  assert.equal(join['Target JSONPath'], '$.crew');
  assert.equal(join['Target Type'], 'array');
  assert.match(join['Transformation / Business Rule'], /join key/i);
  assert.equal(rows.filter((row) => row['Target JSONPath'] === '$.project').length, 1);
  // Forward, the same column still maps to $.project.
  const forward = exampleMapping('source').find(
    (row) => row['Target Field / Path'] === 'Crew.project_name',
  )!;
  assert.equal(forward['Source JSONPath'], '$.project');
});
