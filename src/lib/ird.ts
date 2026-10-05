import { jsonPath, pointer, type MappingEntry, type ValueType } from './json';
/** Which side of the mapping the editor's JSON sits on. */
export type Role = 'source' | 'target';
export type ExportKind = 'ird' | 'blank' | 'samples' | 'example-tables' | 'example-mapping';
const DECISIONS = [
  'Required',
  'Cardinality',
  'Transformation / Business Rule',
  'Default Value',
  'Validation / Constraints',
  'Description',
] as const;
/** The systems always read left to right: source columns, then target columns, then decisions. */
export const IRD_COLUMNS = {
  source: [
    'Mapping ID',
    'Source Field',
    'Source JSONPath',
    'Source Type',
    'Target Field / Path',
    'Target Type',
    ...DECISIONS,
  ],
  target: [
    'Mapping ID',
    'Source Field / Path',
    'Source Type',
    'Target Field',
    'Target JSONPath',
    'Target Type',
    ...DECISIONS,
  ],
} as const;
type IRDRow = Record<string, string>;
export const reusablePath = (parts: (string | number)[]) =>
  '$' +
  parts.map((part) => (typeof part === 'number' ? '[*]' : jsonPath([part]).slice(1))).join('');
const blankRow = (role: Role): IRDRow =>
  Object.fromEntries(IRD_COLUMNS[role].map((header) => [header, '']));

/** Document structure only. Samples cannot determine requiredness or business rules. */
function jsonFields(entries: MappingEntry[]) {
  const parents = new Set(
    entries.filter((entry) => entry.parts.length).map((entry) => pointer(entry.parts.slice(0, -1))),
  );
  const fields = new Map<string, { name: string; types: Set<ValueType> }>();
  for (const entry of entries) {
    if (entry.type === 'object' && parents.has(entry.path)) continue;
    const path = reusablePath(entry.parts);
    const existing = fields.get(path);
    if (existing) existing.types.add(entry.type);
    else
      fields.set(path, {
        name: entry.parts.length
          ? typeof entry.parts.at(-1) === 'number'
            ? 'item'
            : String(entry.parts.at(-1))
          : 'document',
        types: new Set([entry.type]),
      });
  }
  const typeOrder: ValueType[] = ['object', 'array', 'string', 'number', 'boolean', 'null'];
  return [...fields].map(([path, field]) => ({
    name: field.name,
    path,
    type: typeOrder.filter((type) => field.types.has(type)).join(' | '),
  }));
}

/** One row per JSON field, filling the columns of the side the JSON is on. */
export function irdRows(entries: MappingEntry[], role: Role = 'source'): IRDRow[] {
  const [name, path, type] =
    role === 'source'
      ? (['Source Field', 'Source JSONPath', 'Source Type'] as const)
      : (['Target Field', 'Target JSONPath', 'Target Type'] as const);
  return jsonFields(entries).map((field, index) => ({
    ...blankRow(role),
    'Mapping ID': `MAP-${String(index + 1).padStart(3, '0')}`,
    [name]: field.name,
    [path]: field.path,
    [type]: field.type,
  }));
}
export const blankIRDRows = (role: Role = 'source') =>
  Array.from({ length: 30 }, () => blankRow(role));
export const IRD_OVERVIEW = [
  ['IRD — Interface and Field Mapping', ''],
  ['Project / Interface Name', ''],
  ['Interface ID', ''],
  ['Document Version', ''],
  ['Source System', ''],
  ['Target System', ''],
  ['Direction / Trigger', ''],
  ['Business Purpose', ''],
  ['Owner', ''],
  ['Reviewer / Approver', ''],
  ['Status', ''],
  ['Last Updated', ''],
  ['Related Requirements', ''],
];
const OBSERVED =
  'Generated types are observed in the provided JSON; multiple types are joined with |.';
const SHORT_JSONPATH = '[*] addresses array items without hardcoding an example index.';
const COLUMN_HELP: Record<Role, Record<string, string>> = {
  source: {
    'Source Field': 'The field or collection name in the source interface.',
    'Source JSONPath': `The source reference. ${SHORT_JSONPATH}`,
    'Source Type': `Confirm against the source contract. ${OBSERVED}`,
    'Target Field / Path': 'The destination field, property path, or column.',
    'Target Type': 'The destination data type agreed with the target system.',
  },
  target: {
    'Source Field / Path': 'The originating field, property path, or column.',
    'Source Type': 'The data type agreed with the source system.',
    'Target Field': 'The field or collection name in the target JSON.',
    'Target JSONPath': `The target reference. ${SHORT_JSONPATH}`,
    'Target Type': `Confirm against the target contract. ${OBSERVED}`,
  },
};
const SHARED_HELP: Record<string, string> = {
  'Mapping ID': 'Assign a stable reference for each mapping. Generated IDs can be edited.',
  Required:
    'Enter Yes, No, or Conditional based on the interface contract, not on sample presence.',
  Cardinality: 'Record allowed occurrences, such as 0..1, 1..1, 0..n, or 1..n.',
  'Transformation / Business Rule':
    'Describe conversion, lookup, calculation, conditional mapping, or other business logic.',
  'Default Value':
    'An agreed default when the source is absent. No defaults are inferred or prefilled.',
  'Validation / Constraints':
    'Record permitted values, formats, lengths, ranges, and rejection behavior.',
  Description: 'Record meaning, assumptions, and links to requirements or decisions.',
};
export const irdInstructions = (role: Role = 'source') => [
  ['Section / Column', 'How to complete'],
  ['Overview', 'Record the interface context, ownership, version, and approval status.'],
  [
    'Field Mapping',
    `One row per ${role} field or collection. Add, remove, or edit rows to suit the interface.`,
  ],
  ...IRD_COLUMNS[role].map((header) => [header, COLUMN_HELP[role][header] ?? SHARED_HELP[header]]),
  [
    'Review',
    'Check source coverage, target coverage, repeated records, requiredness, and error handling before approval.',
  ],
  [
    'Privacy',
    'This template contains structure and blank decisions only. No sample values are included.',
  ],
];

export const needsSource = (kind: ExportKind) => kind === 'ird' || kind === 'samples';
