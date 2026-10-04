import { jsonPath, pointer, type MappingEntry, type ValueType } from './json';
export type ExportKind = 'ird' | 'blank' | 'samples' | 'example-target' | 'example-mapping';
export const IRD_HEADERS = [
  'Mapping ID',
  'Source Field',
  'Source JSONPath',
  'Source Type',
  'Target Field / Path',
  'Target Type',
  'Required',
  'Cardinality',
  'Transformation / Business Rule',
  'Default Value',
  'Validation / Constraints',
  'Description',
] as const;
type IRDRow = Record<(typeof IRD_HEADERS)[number], string>;
export const reusablePath = (parts: (string | number)[]) =>
  '$' +
  parts.map((part) => (typeof part === 'number' ? '[*]' : jsonPath([part]).slice(1))).join('');
const blankRow = (): IRDRow =>
  Object.fromEntries(IRD_HEADERS.map((header) => [header, ''])) as IRDRow;

/** Document structure only. Samples cannot determine requiredness or business rules. */
export function irdRows(entries: MappingEntry[]): IRDRow[] {
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
  return [...fields].map(([path, field], index) => ({
    ...blankRow(),
    'Mapping ID': `MAP-${String(index + 1).padStart(3, '0')}`,
    'Source Field': field.name,
    'Source JSONPath': path,
    'Source Type': typeOrder.filter((type) => field.types.has(type)).join(' | '),
  }));
}
export const blankIRDRows = () => Array.from({ length: 30 }, blankRow);
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
export const IRD_INSTRUCTIONS = [
  ['Section / Column', 'How to complete'],
  ['Overview', 'Record the interface context, ownership, version, and approval status.'],
  [
    'Field Mapping',
    'One row per source field or collection. Add, remove, or edit rows to suit the interface.',
  ],
  ['Mapping ID', 'Assign a stable reference for each mapping. Generated IDs can be edited.'],
  ['Source Field', 'The field or collection name in the source interface.'],
  [
    'Source JSONPath',
    'The source reference. [*] addresses array items without hardcoding an example index.',
  ],
  [
    'Source Type',
    'Confirm against the source contract. Generated types are observed in the provided JSON; multiple types are joined with |.',
  ],
  ['Target Field / Path', 'The destination field, property path, or column.'],
  ['Target Type', 'The destination data type agreed with the target system.'],
  [
    'Required',
    'Enter Yes, No, or Conditional based on the interface contract, not on sample presence.',
  ],
  ['Cardinality', 'Record allowed occurrences, such as 0..1, 1..1, 0..n, or 1..n.'],
  [
    'Transformation / Business Rule',
    'Describe conversion, lookup, calculation, conditional mapping, or other business logic.',
  ],
  [
    'Default Value',
    'An agreed default when the source is absent. No defaults are inferred or prefilled.',
  ],
  [
    'Validation / Constraints',
    'Record permitted values, formats, lengths, ranges, and rejection behavior.',
  ],
  ['Description', 'Record meaning, assumptions, and links to requirements or decisions.'],
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
