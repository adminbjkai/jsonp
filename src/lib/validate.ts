/** JSON Schema validation (drafts 4, 7, 2019-09, 2020-12) with plain-language, pointer-addressed issues. */
import { Validator, type OutputUnit, type SchemaDraft } from '@cfworker/json-schema';

export interface SchemaIssue {
  /** RFC 6901 pointer into the document, in the same form as Entry.path ('' is the root). */
  pointer: string;
  message: string;
  keyword?: string;
  /** Evaluation path of the failing keyword in the schema (follows $ref names). */
  schemaPointer?: string;
}

interface ValidationReport {
  valid: boolean;
  issues: SchemaIssue[];
  schemaError?: string;
  draft: string;
}

const MAX_ISSUES = 500;

const DRAFT_LABELS: Record<SchemaDraft, string> = {
  '4': 'draft-04',
  '7': 'draft-07',
  '2019-09': 'draft 2019-09',
  '2020-12': 'draft 2020-12',
};

/** Picks the validator dialect from $schema; anything unrecognized uses 2020-12. Draft 6 runs as 7. */
function detectDraft(schema: unknown): SchemaDraft {
  const uri =
    schema &&
    typeof schema === 'object' &&
    typeof (schema as { $schema?: unknown }).$schema === 'string'
      ? (schema as { $schema: string }).$schema
      : '';
  if (/draft-0[34]\b/.test(uri)) return '4';
  if (/draft-0[67]\b/.test(uri)) return '7';
  if (uri.includes('2019-09')) return '2019-09';
  return '2020-12';
}

/** "#/a~1b/0" (URI-encoded segments) to "/a~1b/0"; "#" to "". */
const toPointer = (location: string) =>
  location.replace(/^#/, '').split('/').map(decodeURIComponent).join('/');

const escapeSegment = (key: string) => encodeURI(key.replace(/~/g, '~0').replace(/\//g, '~1'));

/** Keywords whose own error only says "a subschema failed"; their nested errors carry the detail. */
const WRAPPERS = new Set([
  'properties',
  'patternProperties',
  'items',
  'prefixItems',
  'additionalItems',
  'unevaluatedItems',
  '$ref',
  '$recursiveRef',
  'allOf',
  'if',
  'dependentSchemas',
]);

const isWrapper = (unit: OutputUnit) =>
  WRAPPERS.has(unit.keyword) ||
  (unit.keyword === 'dependencies' && unit.error.includes('dependant schema'));

const propertyOf = (unit: OutputUnit) =>
  /^Property (?:name )?"([\s\S]*)" (does|matches)/.exec(unit.error)?.[1];

const quoteList = (values: string[]) =>
  values.length < 2 ? values.join('') : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`;

function typeNames(error: string): { expected: string[]; actual: string } | null {
  const match = /^Instance type "(\w+)" is invalid\. Expected (.+)\.$/.exec(error);
  if (!match) return null;
  return { actual: match[1], expected: [...match[2].matchAll(/"(\w+)"/g)].map((m) => m[1]) };
}

const article = (type: string) =>
  type === 'null' ? type : (/^[aeiou]/.test(type) ? 'an ' : 'a ') + type;

function describe(unit: OutputUnit): string {
  const { error } = unit;
  switch (unit.keyword) {
    case 'type': {
      const types = typeNames(error);
      return types
        ? `Expected ${quoteList(types.expected.map(article))}, found ${article(types.actual)}.`
        : error;
    }
    case 'required':
      return error.replace(
        /^Instance does not have required property/,
        'Missing required property',
      );
    case 'enum': {
      const values = error.replace(/^Instance does not match any of /, '').replace(/\.$/, '');
      return `Must be one of ${values.replace(/^\[|\]$/g, '').replace(/,/g, ', ')}.`;
    }
    case 'const':
      return error.replace(/^Instance does not match /, 'Must equal ');
    case 'format':
      return error.replace(/^String does not match format "(.+)"\.$/, 'Not a valid $1.');
    case 'pattern':
      return 'Does not match the required pattern.';
    case 'minProperties':
      return error.replace(/^Instance does not have at least/, 'Needs at least');
    case 'maxProperties':
      return `Has more than ${/\d+/.exec(error)?.[0]} properties.`;
    case 'dependencies':
    case 'dependentRequired':
      return error.replace(
        /^Instance has (".*") but does not have (".*")\.$/,
        'Has $1, so $2 is required.',
      );
    case 'not':
      return 'Matches a schema it must not match.';
    case 'false':
      return 'No value is allowed here.';
    default:
      return error.replace(/^Instance /, 'Value ').replace(/\s+/g, ' ');
  }
}

/** Turns cfworker's nested output units into a flat list of leaf problems. */
function simplify(units: OutputUnit[]): { unit: OutputUnit; message: string; at: string }[] {
  const issues: { unit: OutputUnit; message: string; at: string }[] = [];
  // cfworker does not mark properties that failed their own "properties" schema as evaluated,
  // so additionalProperties reports them again. Those keys are declared, so drop the repeats.
  const declared = new Set(
    units
      .filter((u) => u.keyword === 'properties' || u.keyword === 'patternProperties')
      .map((u) => `${u.instanceLocation}\u0000${propertyOf(u)}`),
  );
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (
      unit.keyword === 'additionalProperties' ||
      unit.keyword === 'unevaluatedProperties' ||
      unit.keyword === 'propertyNames'
    ) {
      const key = propertyOf(unit) ?? '';
      const child = `${unit.instanceLocation}/${escapeSegment(key)}`;
      let end = i + 1;
      while (
        end < units.length &&
        (units[end].instanceLocation === child ||
          units[end].instanceLocation.startsWith(child + '/'))
      )
        end++;
      const nested = units.slice(i + 1, end);
      i = end - 1;
      if (unit.keyword === 'propertyNames')
        issues.push({ unit, message: `Property name "${key}" is not allowed.`, at: child });
      else if (declared.has(`${unit.instanceLocation}\u0000${key}`)) continue;
      else if (nested.every((u) => u.keyword === 'false'))
        issues.push({ unit, message: `Property "${key}" is not allowed.`, at: child });
      else issues.push(...simplify(nested));
      continue;
    }
    if (unit.keyword === 'anyOf' || unit.keyword === 'oneOf') {
      const prefix = unit.keywordLocation + '/';
      let end = i + 1;
      while (
        end < units.length &&
        (units[end].keywordLocation.startsWith(prefix) ||
          (units[end].keyword === 'false' &&
            units[end].instanceLocation.startsWith(unit.instanceLocation)))
      )
        end++;
      const nested = units.slice(i + 1, end);
      i = end - 1;
      issues.push(...alternatives(unit, nested));
      continue;
    }
    if (isWrapper(unit)) continue;
    if (unit.keyword === 'false') {
      const previous = units[i - 1]?.keyword ?? '';
      if (/[Ii]tems$/.test(previous)) {
        issues.push({
          unit,
          message: 'This array item is not allowed.',
          at: unit.instanceLocation,
        });
        continue;
      }
      if (previous === 'properties') {
        issues.push({ unit, message: 'This property is not allowed.', at: unit.instanceLocation });
        continue;
      }
    }
    issues.push({ unit, message: describe(unit), at: unit.instanceLocation });
  }
  return issues;
}

/** Explains a failed anyOf/oneOf by the most specific alternative where possible. */
function alternatives(unit: OutputUnit, nested: OutputUnit[]) {
  const generic = () => {
    const matches = /\((\d+) matches\)/.exec(unit.error)?.[1];
    const message =
      unit.keyword === 'oneOf' && matches && matches !== '0'
        ? `Matches ${matches} of the allowed alternatives; exactly one is allowed.`
        : 'Does not match any of the allowed alternatives.';
    return [{ unit, message, at: unit.instanceLocation }];
  };
  if (unit.keyword === 'oneOf' && !/\(0 matches\)/.test(unit.error)) return generic();
  const groups = new Map<string, OutputUnit[]>();
  for (const child of nested) {
    const index = /^\d+/.exec(child.keywordLocation.slice(unit.keywordLocation.length + 1))?.[0];
    if (index === undefined) return generic();
    groups.set(index, [...(groups.get(index) ?? []), child]);
  }
  const leaves = [...groups.values()].map((group) => group.filter((u) => !isWrapper(u)));
  const typeOnly = (group: OutputUnit[]) =>
    group.length === 1 &&
    group[0].keyword === 'type' &&
    group[0].instanceLocation === unit.instanceLocation;
  const specific = leaves.filter((group) => !typeOnly(group));
  if (specific.length === 0) {
    // Every alternative failed on type alone: list the accepted types.
    const expected = new Set<string>();
    let actual = '';
    for (const [only] of leaves) {
      const types = typeNames(only.error);
      if (!types) return generic();
      types.expected.forEach((t) => expected.add(t));
      actual = types.actual;
    }
    return [
      {
        unit,
        message: `Expected ${quoteList([...expected].map(article))}, found ${article(actual)}.`,
        at: unit.instanceLocation,
      },
    ];
  }
  if (specific.length === 1) {
    const index = leaves.indexOf(specific[0]);
    return simplify([...groups.values()][index]);
  }
  return generic();
}

export function validateDocument(documentText: string, schemaText: string): ValidationReport {
  let schema: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch (error) {
    return {
      valid: false,
      issues: [],
      draft: DRAFT_LABELS['2020-12'],
      schemaError: `The schema isn’t valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const draft = detectDraft(schema);
  const label = DRAFT_LABELS[draft];
  if (
    typeof schema !== 'boolean' &&
    (!schema || typeof schema !== 'object' || Array.isArray(schema))
  )
    return {
      valid: false,
      issues: [],
      draft: label,
      schemaError: 'A schema must be a JSON object, true, or false.',
    };
  let document: unknown;
  try {
    // Values are only compared, so JSON.parse rounding of very large numbers is harmless here.
    document = JSON.parse(documentText);
  } catch (error) {
    return {
      valid: false,
      draft: label,
      issues: [
        {
          pointer: '',
          message: `The document isn’t valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  let units: OutputUnit[];
  try {
    const result = new Validator(schema as object, draft, false).validate(document);
    if (result.valid) return { valid: true, issues: [], draft: label };
    units = result.errors;
  } catch (error) {
    // Unresolvable $ref, an invalid pattern, duplicate $id, and similar schema problems.
    return {
      valid: false,
      issues: [],
      draft: label,
      schemaError: `The schema can’t be used: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const issues: SchemaIssue[] = [];
  const seen = new Set<string>();
  for (const { unit, message, at } of simplify(units)) {
    const pointer = toPointer(at);
    const id = `${pointer}\u0000${message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    issues.push({
      pointer,
      message,
      keyword: unit.keyword,
      schemaPointer: toPointer(unit.keywordLocation),
    });
    if (issues.length >= MAX_ISSUES) break;
  }
  return { valid: false, issues, draft: label };
}
