import { EXAMPLE } from './json';
import { IRD_HEADERS } from './ird';

// An explicit example contract, not a schema inferred from the user's JSON.
const definitions = [
  [
    'Projects',
    'project_name',
    'string',
    'Yes',
    '1..1',
    '$.project',
    'string',
    'Copy unchanged.',
    'Nonempty; primary key.',
    'Project identifier',
  ],
  [
    'Projects',
    'version',
    'integer',
    'Yes',
    '1..1',
    '$.version',
    'number',
    'Copy unchanged.',
    'Integer >= 1.',
    'Interface version',
  ],
  [
    'Projects',
    'status_code',
    'string',
    'Yes',
    '1..1',
    '$.status',
    'string',
    'Convert to uppercase.',
    'READY, ACTIVE, or PAUSED.',
    'Project status',
  ],
  [
    'Projects',
    'theme_hex',
    'string',
    'Yes',
    '1..1',
    '$.settings.theme',
    'string',
    'Copy unchanged, including #.',
    '# followed by exactly six hexadecimal digits.',
    'Display color',
  ],
  [
    'Projects',
    'notifications_enabled',
    'string',
    'Yes',
    '1..1',
    '$.settings.notifications',
    'boolean',
    'true → Y; false → N.',
    'Y or N.',
    'Notification preference',
  ],
  [
    'Projects',
    'refresh_seconds',
    'integer',
    'Yes',
    '1..1',
    '$.settings.refreshInterval',
    'number',
    'Copy unchanged; unit is seconds.',
    'Integer >= 1.',
    'Refresh interval',
  ],
  [
    'Projects',
    'crew_count',
    'integer',
    'Yes',
    '1..1',
    '$.crew',
    'array',
    'Count the array items, including zero for an empty array.',
    'Integer >= 0; equals the number of related Crew rows.',
    'Crew size',
  ],
  [
    'Projects',
    'next_launch_at',
    'string',
    'No',
    '0..1',
    '$.nextLaunch',
    'string | null',
    'Copy a UTC timestamp; null or absent → blank cell.',
    'If present: YYYY-MM-DDTHH:mm:ssZ, valid calendar date/time.',
    'Optional next launch',
  ],
  [
    'Crew',
    'project_name',
    'string',
    'Yes',
    '1..1 per crew row',
    '$.project',
    'string',
    'Repeat the parent project name for each $.crew[*] item.',
    'Foreign key to Projects.project_name.',
    'Parent project',
  ],
  [
    'Crew',
    'member_name',
    'string',
    'Yes',
    '1..1 per crew row',
    '$.crew[*].name',
    'string',
    'Copy unchanged for the current crew item.',
    'Nonempty; unique within a project.',
    'Crew member',
  ],
  [
    'Crew',
    'role_code',
    'string',
    'Yes',
    '1..1 per crew row',
    '$.crew[*].role',
    'string',
    'Convert to uppercase for the current crew item.',
    'ENGINEER or DESIGNER.',
    'Member role',
  ],
] as const;

export const TARGET_FIELDS = definitions.map(
  ([table, field, type, required, cardinality, , , , constraints, description]) => ({
    Table: table,
    Field: field,
    Type: type,
    Required: required,
    Cardinality: cardinality,
    'Validation / Constraints': constraints,
    Description: description,
  }),
);
export const EXAMPLE_MAPPING = definitions.map(
  (
    [table, field, type, required, cardinality, path, sourceType, rule, constraints, description],
    index,
  ) => {
    const row = Object.fromEntries(IRD_HEADERS.map((header) => [header, '']));
    return {
      ...row,
      'Mapping ID': `MAP-${String(index + 1).padStart(3, '0')}`,
      'Source Field': path.split('.').at(-1)!,
      'Source JSONPath': path,
      'Source Type': sourceType,
      'Target Field / Path': `${table}.${field}`,
      'Target Type': type,
      Required: required,
      Cardinality: cardinality,
      'Transformation / Business Rule': rule,
      'Default Value':
        field === 'next_launch_at' ? 'Blank for null or absent' : 'None; reject missing source',
      'Validation / Constraints': constraints,
      Description: description,
    };
  },
);
const source = JSON.parse(EXAMPLE) as {
  project: string;
  version: number;
  status: string;
  settings: { theme: string; notifications: boolean; refreshInterval: number };
  crew: { name: string; role: string }[];
  nextLaunch: string | null;
};
export const TARGET_PROJECTS = [
  {
    project_name: source.project,
    version: source.version,
    status_code: source.status.toUpperCase(),
    theme_hex: source.settings.theme,
    notifications_enabled: source.settings.notifications ? 'Y' : 'N',
    refresh_seconds: source.settings.refreshInterval,
    crew_count: source.crew.length,
    next_launch_at: source.nextLaunch ?? '',
  },
];
export const TARGET_CREW = source.crew.map((member) => ({
  project_name: source.project,
  member_name: member.name,
  role_code: member.role.toUpperCase(),
}));
export const EXAMPLE_OVERVIEW = [
  ['Property', 'Known-target worked example'],
  ['Project / Interface Name', 'Orbital project and crew import'],
  ['Interface ID', 'EXAMPLE-ORBITAL-001'],
  ['Document Version', '1.0'],
  ['Source System', 'Bundled Orbital sample JSON (Source JSON sheet)'],
  ['Target System', 'Orbital_Target_Example_<date>.xlsx: Projects and Crew'],
  ['Direction / Trigger', 'JSON → tabular workbook; one source document per import'],
  ['Business Purpose', 'Demonstrate a complete mapping against an explicitly defined target.'],
  ['Status', 'Worked example; not an approved production contract'],
  [
    'Record creation',
    'Create one Projects row; create one Crew row for each $.crew[*] item, in source order. An empty crew array creates no Crew rows.',
  ],
  [
    'Keys',
    'Projects.project_name is the primary key. Crew uses (project_name, member_name) as its composite key.',
  ],
  [
    'Validation policy',
    'Reject the entire document on a missing required source, invalid type, constraint violation, duplicate key, or unmatched foreign key. Do not silently coerce types or invent defaults.',
  ],
  [
    'Source types',
    'Declared example contract; nextLaunch accepts string or null even though this sample contains null.',
  ],
  [
    'Scope',
    'Both downloads always use the bundled sample, independently of the editor. Adapt and review the example contract for your own interface.',
  ],
];
export const EXAMPLE_SOURCE = [['Source JSON'], [EXAMPLE]];
export const EXAMPLE_GUIDE = [
  ['Section', 'How to use this example'],
  [
    'Start',
    'Download the target workbook and completed IRD together from Export XLSX → Known-target worked example.',
  ],
  [
    'Target Fields',
    'The agreed example schema. Projects and Crew sheets contain the expected output for the bundled sample.',
  ],
  [
    'Field Mapping',
    'All eleven target columns are mapped, including the repeated project foreign key and calculated crew count.',
  ],
  [
    'Collections',
    'Crew is 0..n per project. Field cardinality applies to each created row; [*] denotes the current crew item.',
  ],
  [
    'Nulls',
    'The optional next_launch_at column is blank for the sample null; a blank output cell is not the string "null".',
  ],
  [
    'Validation',
    'Validate against Target Fields and the Overview rejection policy before writing any rows. Uppercase conversions precede enumeration checks.',
  ],
  [
    'Privacy',
    'Only the bundled Orbital sample is included. Your current editor content is never included in either example download.',
  ],
  [
    'Editing',
    'Use the separate clean or blank IRD templates for your own mapping. Changing the editor does not change this worked example.',
  ],
];
