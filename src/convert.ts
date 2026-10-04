/** Converters from the lossless JSON tree to other formats, plus a CSV importer. */
import { serialize, type Node } from './tree';

export type Format = 'typescript' | 'schema' | 'yaml' | 'csv';

export const FORMATS: {
  id: Format;
  label: string;
  extension: string;
  mime: string;
  description: string;
}[] = [
  {
    id: 'typescript',
    label: 'TypeScript',
    extension: 'ts',
    mime: 'text/typescript',
    description: 'Inferred interfaces with optional keys and union types.',
  },
  {
    id: 'schema',
    label: 'JSON Schema',
    extension: 'schema.json',
    mime: 'application/schema+json',
    description: 'Draft 2020-12 schema inferred from the document.',
  },
  {
    id: 'yaml',
    label: 'YAML',
    extension: 'yaml',
    mime: 'application/yaml',
    description: 'YAML 1.2 block style with exact numbers.',
  },
  {
    id: 'csv',
    label: 'CSV',
    extension: 'csv',
    mime: 'text/csv',
    description: 'One row per object; nested keys flattened with dots.',
  },
];

export function convert(node: Node, format: Format, options: { rootName?: string } = {}): string {
  switch (format) {
    case 'typescript':
      return toTypeScript(node, options.rootName);
    case 'schema':
      return toJSONSchema(node);
    case 'yaml':
      return toYAML(node);
    case 'csv':
      return toCSV(node);
    default:
      throw new Error(`Unknown format: ${String(format)}`);
  }
}

// ---- Shape inference (shared by TypeScript and JSON Schema) -----------------------------

interface Shape {
  string: boolean;
  /** Formats every sampled string matched; null until a string is seen. */
  formats: Set<string> | null;
  number: boolean;
  /** True when every sampled number token is an integer literal. */
  integer: boolean;
  boolean: boolean;
  null: boolean;
  object: { count: number; fields: Map<string, { shape: Shape; count: number }> } | null;
  /** Element shape; a never-shape when every sampled array was empty. */
  array: Shape | null;
}

const never = (): Shape => ({
  string: false,
  formats: null,
  number: false,
  integer: true,
  boolean: false,
  null: false,
  object: null,
  array: null,
});

const isNever = (s: Shape) =>
  !s.string && !s.number && !s.boolean && !s.null && !s.object && !s.array;

const STRING_FORMATS: [string, RegExp][] = [
  [
    'date-time',
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/,
  ],
  ['date', /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^[a-zA-Z][a-zA-Z\d+.-]*:\/\/[^\s]+$/],
];

function infer(node: Node): Shape {
  const shape = never();
  switch (node.type) {
    case 'string':
      shape.string = true;
      shape.formats = new Set(
        STRING_FORMATS.filter(([, re]) => re.test(node.value)).map(([f]) => f),
      );
      break;
    case 'number':
      shape.number = true;
      shape.integer = /^-?\d+$/.test(node.raw);
      break;
    case 'boolean':
      shape.boolean = true;
      break;
    case 'null':
      shape.null = true;
      break;
    case 'array':
      shape.array = node.items.map(infer).reduce(merge, never());
      break;
    case 'object': {
      const fields = new Map<string, { shape: Shape; count: number }>();
      for (const { key, value } of node.members) {
        const existing = fields.get(key);
        fields.set(key, {
          shape: existing ? merge(existing.shape, infer(value)) : infer(value),
          count: 1,
        });
      }
      shape.object = { count: 1, fields };
    }
  }
  return shape;
}

function merge(a: Shape, b: Shape): Shape {
  let object = a.object || b.object;
  if (a.object && b.object) {
    const fields = new Map(a.object.fields);
    for (const [key, field] of b.object.fields) {
      const existing = fields.get(key);
      fields.set(
        key,
        existing
          ? { shape: merge(existing.shape, field.shape), count: existing.count + field.count }
          : field,
      );
    }
    object = { count: a.object.count + b.object.count, fields };
  }
  return {
    string: a.string || b.string,
    formats:
      a.formats && b.formats
        ? new Set([...a.formats].filter((f) => b.formats!.has(f)))
        : a.formats || b.formats,
    number: a.number || b.number,
    integer: (!a.number || a.integer) && (!b.number || b.integer),
    boolean: a.boolean || b.boolean,
    null: a.null || b.null,
    object,
    array: a.array && b.array ? merge(a.array, b.array) : a.array || b.array,
  };
}

// ---- TypeScript -------------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function pascal(text: string): string {
  const name = text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  if (!name) return 'Item';
  return /^\d/.test(name) ? 'T' + name : name;
}

function singular(name: string): string {
  if (/[^aeiou]ies$/.test(name)) return name.slice(0, -3) + 'y';
  if (/(ss|x|ch|sh)es$/.test(name)) return name.slice(0, -2);
  if (/[^su]s$/.test(name)) return name.slice(0, -1);
  return name;
}

const itemName = (name: string) => {
  const one = singular(name);
  return one === name ? name + 'Item' : one;
};

export function toTypeScript(node: Node, rootName = 'Root'): string {
  const root = pascal(rootName);
  const declarations: { name: string; body: string }[] = [];
  const byBody = new Map<string, string>();
  const used = new Set([root]);

  const declare = (hint: string, body: string, reserved?: string): string => {
    const existing = byBody.get(body);
    if (existing) return existing;
    let name = reserved ?? hint;
    for (let n = 2; !reserved && used.has(name); n++) name = hint + n;
    used.add(name);
    byBody.set(body, name);
    declarations.push({ name, body });
    return name;
  };

  const typeOf = (shape: Shape, hint: string, reserved?: string): string =>
    unionOf(shape, hint, reserved).join(' | ');

  const unionOf = (shape: Shape, hint: string, reserved?: string): string[] => {
    if (isNever(shape)) return ['unknown'];
    const parts: string[] = [];
    if (shape.string) parts.push('string');
    if (shape.number) parts.push('number');
    if (shape.boolean) parts.push('boolean');
    if (shape.object) {
      const { count, fields } = shape.object;
      const lines = [...fields].map(([key, field]) => {
        const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
        const optional = field.count < count ? '?' : '';
        return `  ${name}${optional}: ${typeOf(field.shape, pascal(key))};`;
      });
      parts.push(declare(hint, lines.length ? `{\n${lines.join('\n')}\n}` : '{}', reserved));
    }
    if (shape.array) {
      const item = unionOf(shape.array, itemName(hint));
      parts.push(item.length > 1 ? `(${item.join(' | ')})[]` : `${item[0]}[]`);
    }
    if (shape.null) parts.push('null');
    return parts;
  };

  const shape = infer(node);
  const onlyObject =
    shape.object && !shape.string && !shape.number && !shape.boolean && !shape.null && !shape.array;
  const out: string[] = [];
  if (onlyObject) typeOf(shape, root, root);
  else out.push(`export type ${root} = ${typeOf(shape, root)};`);
  const first = declarations.findIndex((d) => d.name === root);
  if (first > 0) declarations.unshift(...declarations.splice(first, 1));
  for (const { name, body } of declarations) out.push(`export interface ${name} ${body}`);
  return out.join('\n\n') + '\n';
}

// ---- JSON Schema ------------------------------------------------------------------------

type Schema = Record<string, unknown>;

function schemaOf(shape: Shape): Schema {
  const options: Schema[] = [];
  if (shape.string) {
    const format = shape.formats && [...shape.formats][0];
    options.push(format ? { type: 'string', format } : { type: 'string' });
  }
  if (shape.number) options.push({ type: shape.integer ? 'integer' : 'number' });
  if (shape.boolean) options.push({ type: 'boolean' });
  if (shape.object) {
    const { count, fields } = shape.object;
    // A null prototype keeps keys such as __proto__ as ordinary properties.
    const properties: Schema = Object.create(null);
    const required: string[] = [];
    for (const [key, field] of fields) {
      properties[key] = schemaOf(field.shape);
      if (field.count === count) required.push(key);
    }
    options.push(
      required.length ? { type: 'object', properties, required } : { type: 'object', properties },
    );
  }
  if (shape.array) {
    options.push(
      isNever(shape.array) ? { type: 'array' } : { type: 'array', items: schemaOf(shape.array) },
    );
  }
  if (shape.null) options.push({ type: 'null' });
  if (options.length === 0) return {};
  return options.length === 1 ? options[0] : { anyOf: options };
}

export function toJSONSchema(node: Node): string {
  return (
    JSON.stringify(
      { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schemaOf(infer(node)) },
      null,
      2,
    ) + '\n'
  );
}

// ---- YAML -------------------------------------------------------------------------------

const YAML_RESERVED = /^(true|false|yes|no|on|off|y|n|null|~)$/i;
const YAML_NUMERIC =
  /^[-+]?(\.?\d[\d_.,:]*([eE][-+]?\d+)?|0[xXoObB][\da-fA-F_]+|\.(inf|Inf|INF|nan|NaN|NAN))$/;

function yamlString(text: string): string {
  const quote =
    text === '' ||
    text !== text.trim() ||
    YAML_RESERVED.test(text) ||
    YAML_NUMERIC.test(text) ||
    /^\d{4}-\d\d?-\d\d?/.test(text) ||
    text.includes(': ') ||
    text.includes(' #') ||
    text.endsWith(':') ||
    text === '<<' ||
    /^(---|\.\.\.)/.test(text) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(text) ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(text);
  if (!quote) return text;
  return JSON.stringify(text).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

function yamlInline(node: Node): string | null {
  switch (node.type) {
    case 'object':
      return node.members.length ? null : '{}';
    case 'array':
      return node.items.length ? null : '[]';
    case 'string':
      return yamlString(node.value);
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    default:
      return 'null';
  }
}

function yamlBlock(node: Node): string[] {
  const lines: string[] = [];
  if (node.type === 'object') {
    for (const { key, value } of node.members) {
      const inline = yamlInline(value);
      const name = yamlString(key);
      // Implicit keys are limited to 1024 characters; longer keys use explicit "? key" syntax.
      if (name.length > 1000) {
        lines.push(`? ${JSON.stringify(key)}`);
        if (inline !== null) lines.push(`: ${inline}`);
        else lines.push(':', ...yamlBlock(value).map((line) => '  ' + line));
      } else if (inline !== null) lines.push(`${name}: ${inline}`);
      else lines.push(`${name}:`, ...yamlBlock(value).map((line) => '  ' + line));
    }
  } else if (node.type === 'array') {
    for (const item of node.items) {
      const inline = yamlInline(item);
      if (inline !== null) lines.push(`- ${inline}`);
      else yamlBlock(item).forEach((line, i) => lines.push((i ? '  ' : '- ') + line));
    }
  }
  return lines;
}

export function toYAML(node: Node): string {
  const inline = yamlInline(node);
  return (inline ?? yamlBlock(node).join('\n')) + '\n';
}

// ---- CSV --------------------------------------------------------------------------------

const CSV_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function scalarText(node: Node): string {
  if (node.type === 'string') return node.value;
  if (node.type === 'number') return node.raw;
  if (node.type === 'boolean') return String(node.value);
  return '';
}

function flatten(node: Node, prefix: string, row: Map<string, string>) {
  if (node.type === 'object' && node.members.length) {
    for (const { key, value } of node.members)
      flatten(value, prefix ? `${prefix}.${key}` : key, row);
  } else if (node.type === 'object') {
    row.set(prefix, '{}');
  } else if (node.type === 'array') {
    const flat = node.items.every((item) => item.type !== 'object' && item.type !== 'array');
    row.set(prefix, flat ? node.items.map(scalarText).join('; ') : serialize(node, 0));
  } else row.set(prefix, scalarText(node));
}

function csvCell(text: string): string {
  if (/^[=+\-@\t\r]/.test(text) && !CSV_NUMBER.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(node: Node): string {
  const items = node.type === 'array' ? node.items : node.type === 'object' ? [node] : null;
  if (!items) throw new Error('CSV needs an array of objects.');
  if (!items.length) throw new Error('CSV needs at least one row; the array is empty.');
  const objects = items.every((item) => item.type === 'object');
  const primitives = items.every((item) => item.type !== 'object' && item.type !== 'array');
  if (!objects && !primitives) throw new Error('CSV needs an array of objects.');

  const columns = new Set<string>();
  const rows = items.map((item) => {
    const row = new Map<string, string>();
    if (objects) flatten(item, '', row);
    else row.set('value', scalarText(item));
    for (const key of row.keys()) columns.add(key);
    return row;
  });
  const header = [...columns];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(header.map((key) => csvCell(row.get(key) ?? '')).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---- CSV import -------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  let firstLine = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    firstLine += quoted ? '' : char;
  }
  let best = ',';
  let bestCount = 0;
  for (const delimiter of [',', ';', '\t']) {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) [best, bestCount] = [delimiter, count];
  }
  return best;
}

function parseCSV(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '"' && field === '') {
      // Quoted field: read until a lone closing quote.
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else field += text[i++];
      }
    } else if (char === delimiter) {
      endField();
      i++;
    } else if (char === '\r' || char === '\n') {
      endRow();
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += char;
      i++;
    }
  }
  if (field !== '' || row.length) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function csvValue(text: string): Node {
  if (text === '') return { type: 'null' };
  if (text === 'true' || text === 'false') return { type: 'boolean', value: text === 'true' };
  if (JSON_NUMBER.test(text)) return { type: 'number', raw: text };
  return { type: 'string', value: text };
}

export function csvToJSON(text: string): string {
  const source = text.replace(/^\ufeff/, '');
  const rows = parseCSV(source, detectDelimiter(source));
  if (!rows.length) throw new Error('CSV is empty.');
  const [head, ...body] = rows;
  const width = Math.max(head.length, ...body.map((r) => r.length));
  const used = new Set<string>();
  const header: string[] = [];
  for (let c = 0; c < width; c++) {
    const base = head[c] || `column${c + 1}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    header.push(name);
  }
  const node: Node = {
    type: 'array',
    items: body.map((cells) => ({
      type: 'object',
      members: header.map((key, c) => ({ key, value: csvValue(cells[c] ?? '') })),
    })),
  };
  return serialize(node, 2);
}
