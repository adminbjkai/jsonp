import { EXAMPLE } from './json';
import { IRD_COLUMNS, type Role } from './ird';

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

// The same eleven fields read the other way, tables → JSON: how each column is turned back into
// the element at its path, and what that element must satisfy.
const reverse = [
  ['Copy unchanged.', 'JSON string; nonempty.'],
  ['Copy unchanged as a JSON number, not a string.', 'Integer >= 1.'],
  ['Convert to lowercase.', 'ready, active, or paused.'],
  ['Copy unchanged, including #.', '# followed by exactly six hexadecimal digits.'],
  ['Y → true; N → false, as JSON booleans rather than strings.', 'JSON boolean.'],
  ['Copy unchanged as a JSON number; unit is seconds.', 'Integer >= 1.'],
  [
    'Not copied. Check only: crew_count must equal the number of items built into $.crew.',
    'Reject the document when it differs from the number of related Crew rows.',
  ],
  [
    'Blank cell → null; otherwise copy the UTC timestamp as a string.',
    'null, or YYYY-MM-DDTHH:mm:ssZ, valid calendar date/time.',
  ],
  [
    'Join key: build $.crew only from Crew rows whose project_name equals Projects.project_name.',
    'Must match an existing Projects.project_name.',
  ],
  ['Copy unchanged for each Crew row, in stored order.', 'JSON string; nonempty.'],
  [
    'Capitalize the first letter and lowercase the rest (ENGINEER → Engineer).',
    'Engineer or Designer.',
  ],
] as const;

// Crew.project_name is a join key, not a copy of $.project: read backward it selects the Crew rows
// that become the items of $.crew.
const JOIN_KEY = 'Crew.project_name';

export const TABLE_FIELDS = definitions.map(
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
/** The completed IRD: tables → JSON when the JSON is the target, JSON → tables when it is the source. */
export const exampleMapping = (role: Role): Record<string, string>[] =>
  definitions.map(
    (
      [table, field, type, required, cardinality, path, jsonType, rule, constraints, description],
      index,
    ) => {
      const column = `${table}.${field}`;
      const optional = field === 'next_launch_at';
      const [reverseRule, reverseConstraints] = reverse[index];
      const joined = column === JOIN_KEY && role === 'target';
      const targetPath = joined ? '$.crew' : path;
      const targetType = joined ? 'array' : jsonType;
      const jsonName = targetPath.split('.').at(-1)!;
      const side: Record<string, string> =
        role === 'source'
          ? {
              'Source Field': jsonName,
              'Source JSONPath': path,
              'Source Type': jsonType,
              'Target Field / Path': column,
              'Target Type': type,
            }
          : {
              'Source Field / Path': column,
              'Source Type': type,
              'Target Field': jsonName,
              'Target JSONPath': targetPath,
              'Target Type': targetType,
            };
      return {
        ...Object.fromEntries(IRD_COLUMNS[role].map((header) => [header, ''])),
        'Mapping ID': `MAP-${String(index + 1).padStart(3, '0')}`,
        ...side,
        Required: required,
        Cardinality: cardinality,
        'Transformation / Business Rule': role === 'source' ? rule : reverseRule,
        'Default Value': optional
          ? role === 'source'
            ? 'Blank for null or absent'
            : 'null when the cell is blank'
          : 'None; reject missing source',
        'Validation / Constraints': role === 'source' ? constraints : reverseConstraints,
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
export const TABLE_PROJECTS = [
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
export const TABLE_CREW = source.crew.map((member) => ({
  project_name: source.project,
  member_name: member.name,
  role_code: member.role.toUpperCase(),
}));
/** Source-role wording is the original; target-role wording mirrors it for the JSON as target. */
const pick = <T>(role: Role, whenSource: T, whenTarget: T) =>
  role === 'source' ? whenSource : whenTarget;
export const exampleOverview = (role: Role) => {
  const tables = pick(role, 'Target', 'Source');
  const workbook = `Orbital_${tables}_Example_<date>.xlsx: Projects and Crew`;
  const json = `Bundled Orbital sample JSON (${pick(role, 'Source', 'Target')} JSON sheet)`;
  return [
    ['Property', `${pick(role, 'Known-target', 'Known-source')} worked example`],
    ['Project / Interface Name', 'Orbital project and crew import'],
    ['Interface ID', 'EXAMPLE-ORBITAL-001'],
    ['Document Version', '1.0'],
    ['Source System', pick(role, json, workbook)],
    ['Target System', pick(role, workbook, json)],
    [
      'Direction / Trigger',
      pick(
        role,
        'JSON → tabular workbook; one source document per import',
        'Tabular workbook → JSON; one JSON document per Projects row',
      ),
    ],
    [
      'Business Purpose',
      `Demonstrate a complete mapping against an explicitly defined ${pick(role, 'target', 'source')}.`,
    ],
    ['Status', 'Worked example; not an approved production contract'],
    [
      'Record creation',
      pick(
        role,
        'Create one Projects row; create one Crew row for each $.crew[*] item, in source order. An empty crew array creates no Crew rows.',
        'Create one JSON document for the Projects row; build $.crew from its Crew rows, in stored order. A project without Crew rows gets an empty crew array.',
      ),
    ],
    [
      'Keys',
      'Projects.project_name is the primary key. Crew uses (project_name, member_name) as its composite key.',
    ],
    [
      'Validation policy',
      pick(
        role,
        'Reject the entire document on a missing required source, invalid type, constraint violation, duplicate key, or unmatched foreign key. Do not silently coerce types or invent defaults.',
        'Reject the entire import on a missing required column, invalid value, constraint violation, duplicate key, or unmatched foreign key. Do not silently coerce types or invent defaults.',
      ),
    ],
    [
      pick(role, 'Source types', 'Target types'),
      pick(
        role,
        'Declared example contract; nextLaunch accepts string or null even though this sample contains null.',
        'Declared example contract; $.nextLaunch is a string or null, and this sample produces null.',
      ),
    ],
    [
      'Scope',
      'Both downloads always use the bundled sample, independently of the editor. Adapt and review the example contract for your own interface.',
    ],
  ];
};
export const exampleJson = (role: Role) => [[pick(role, 'Source JSON', 'Target JSON')], [EXAMPLE]];
export const exampleGuide = (role: Role) => {
  const fields = pick(role, 'Target Fields', 'Source Fields');
  return [
    ['Section', 'How to use this example'],
    [
      'Start',
      pick(
        role,
        'Download the target workbook and completed IRD together from Export → Excel IRD workbook… → Known-target worked example.',
        'Download the source workbook and completed IRD together from Export → Excel IRD workbook… → Known-source worked example, under JSON is the target.',
      ),
    ],
    [
      fields,
      pick(
        role,
        'The agreed example schema. Projects and Crew sheets contain the expected output for the bundled sample.',
        'The agreed example schema. Projects and Crew sheets contain the input rows that produce the bundled sample JSON.',
      ),
    ],
    [
      'Field Mapping',
      pick(
        role,
        'All eleven target columns are mapped, including the repeated project foreign key and calculated crew count.',
        'All eleven source columns are mapped, including the project foreign key used as a join and the crew count used as a check.',
      ),
    ],
    [
      'Collections',
      pick(
        role,
        'Crew is 0..n per project. Field cardinality applies to each created row; [*] denotes the current crew item.',
        'Crew is 0..n per project. Field cardinality applies to each Crew row; [*] denotes the item built from it.',
      ),
    ],
    [
      'Nulls',
      pick(
        role,
        'The optional next_launch_at column is blank for the sample null; a blank output cell is not the string "null".',
        'A blank next_launch_at cell becomes JSON null: not the string "null", and not a missing key.',
      ),
    ],
    [
      'Validation',
      pick(
        role,
        `Validate against ${fields} and the Overview rejection policy before writing any rows. Uppercase conversions precede enumeration checks.`,
        `Validate against ${fields} and the Overview rejection policy before building any JSON. Check the stored codes first, then convert them to JSON values.`,
      ),
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
};
