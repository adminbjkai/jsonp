/** Converters from the lossless JSON tree to other formats, plus a CSV importer. */
import { serialize, type Node } from './tree';

export type Format =
  | 'typescript'
  | 'schema'
  | 'go'
  | 'rust'
  | 'python'
  | 'zod'
  | 'kotlin'
  | 'csharp'
  | 'yaml'
  | 'csv'
  | 'xml';

export const FORMATS: {
  id: Format;
  label: string;
  extension: string;
  mime: string;
  description: string;
  /** "types" generate code or schemas from the inferred shape; "data" re-encode the values. */
  group: 'types' | 'data';
}[] = [
  {
    id: 'typescript',
    label: 'TypeScript',
    extension: 'ts',
    mime: 'text/typescript',
    description: 'Inferred interfaces with optional keys and union types.',
    group: 'types',
  },
  {
    id: 'schema',
    label: 'JSON Schema',
    extension: 'schema.json',
    mime: 'application/schema+json',
    description: 'Draft 2020-12 schema inferred from the document.',
    group: 'types',
  },
  {
    id: 'go',
    label: 'Go',
    extension: 'go',
    mime: 'text/x-go',
    description:
      'Structs with json tags; pointers for nullable or optional values, any for mixed types.',
    group: 'types',
  },
  {
    id: 'rust',
    label: 'Rust',
    extension: 'rs',
    mime: 'text/x-rust',
    description:
      'Serde structs; Option for optional or nullable fields, serde_json::Value for mixed types.',
    group: 'types',
  },
  {
    id: 'python',
    label: 'Python',
    extension: 'py',
    mime: 'text/x-python',
    description: 'Dataclasses with type hints; original keys kept in field metadata when renamed.',
    group: 'types',
  },
  {
    id: 'zod',
    label: 'Zod',
    extension: 'zod.ts',
    mime: 'text/typescript',
    description: 'Zod schemas with inferred TypeScript types.',
    group: 'types',
  },
  {
    id: 'kotlin',
    label: 'Kotlin',
    extension: 'kt',
    mime: 'text/x-kotlin',
    description: 'kotlinx.serialization data classes with @SerialName where names differ.',
    group: 'types',
  },
  {
    id: 'csharp',
    label: 'C#',
    extension: 'cs',
    mime: 'text/x-csharp',
    description: 'System.Text.Json classes with [JsonPropertyName] and nullable annotations.',
    group: 'types',
  },
  {
    id: 'yaml',
    label: 'YAML',
    extension: 'yaml',
    mime: 'application/yaml',
    description: 'YAML 1.2 block style with exact numbers.',
    group: 'data',
  },
  {
    id: 'csv',
    label: 'CSV',
    extension: 'csv',
    mime: 'text/csv',
    description: 'One row per object; nested keys flattened with dots.',
    group: 'data',
  },
  {
    id: 'xml',
    label: 'XML',
    extension: 'xml',
    mime: 'application/xml',
    description:
      'XML 1.0 elements named after keys; array items nest as singular elements. Keys that are not valid XML names keep the original in a key attribute.',
    group: 'data',
  },
];

export function convert(node: Node, format: Format, options: { rootName?: string } = {}): string {
  switch (format) {
    case 'typescript':
      return toTypeScript(node, options.rootName);
    case 'schema':
      return toJSONSchema(node);
    case 'go':
      return toGo(node, options.rootName);
    case 'rust':
      return toRust(node, options.rootName);
    case 'python':
      return toPython(node, options.rootName);
    case 'zod':
      return toZod(node, options.rootName);
    case 'kotlin':
      return toKotlin(node, options.rootName);
    case 'csharp':
      return toCSharp(node, options.rootName);
    case 'yaml':
      return toYAML(node);
    case 'csv':
      return toCSV(node);
    case 'xml':
      return toXML(node, options.rootName);
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
  /** True when some integer token is outside the signed 64-bit range. */
  big: boolean;
  boolean: boolean;
  null: boolean;
  object: { count: number; fields: Map<string, { shape: Shape; count: number }> } | null;
  /** Element shape; a never-shape when every sampled array was empty. */
  array: Shape | null;
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const fitsInt64 = (raw: string) => {
  const value = BigInt(raw);
  return value >= INT64_MIN && value <= INT64_MAX;
};

const never = (): Shape => ({
  string: false,
  formats: null,
  number: false,
  integer: true,
  big: false,
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
      shape.big = shape.integer && !fitsInt64(node.raw);
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
    big: a.big || b.big,
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

// ---- Typed-language model (shared by Go, Rust, Python, Zod, Kotlin, C#) -----------------

type Kind =
  'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'union' | 'null' | 'unknown';

/** A resolved type: "null" means only null was seen, "unknown" means nothing was (empty arrays). */
interface TypeRef {
  kind: Kind;
  nullable: boolean;
  name?: string;
  item?: TypeRef;
  /** Union members (never null); empty when the language has no union types. */
  options?: TypeRef[];
  /** An integer outside the 64-bit range: languages use an arbitrary-precision type. */
  big?: boolean;
}

interface Field {
  key: string;
  type: TypeRef;
  optional: boolean;
}

interface Declaration {
  name: string;
  fields: Field[];
}

interface Model {
  root: string;
  type: TypeRef;
  /** Dependencies first: every declaration only refers to earlier ones. */
  declarations: Declaration[];
}

function buildModel(
  node: Node,
  rootName: string,
  typeName: (text: string) => string,
  reserved: string[],
  unions: boolean,
): Model {
  const used = new Set(reserved);
  let root = typeName(rootName);
  for (let n = 2, base = root; used.has(root); n++) root = base + n;
  used.add(root);
  const declarations: Declaration[] = [];
  const bySignature = new Map<string, string>();

  const declare = (hint: string, fields: Field[], fixed?: string): string => {
    const signature = JSON.stringify(fields);
    const existing = bySignature.get(signature);
    if (existing) return existing;
    let name = fixed ?? hint;
    for (let n = 2; !fixed && used.has(name); n++) name = hint + n;
    used.add(name);
    bySignature.set(signature, name);
    declarations.push({ name, fields });
    return name;
  };

  const ref = (shape: Shape, hint: string, fixed?: string): TypeRef => {
    if (isNever(shape)) return { kind: 'unknown', nullable: false };
    const options: TypeRef[] = [];
    if (shape.string) options.push({ kind: 'string', nullable: false });
    if (shape.number)
      options.push({
        kind: shape.integer ? 'integer' : 'number',
        nullable: false,
        ...(shape.integer && shape.big ? { big: true } : {}),
      });
    if (shape.boolean) options.push({ kind: 'boolean', nullable: false });
    if (!unions && options.length + (shape.object ? 1 : 0) + (shape.array ? 1 : 0) > 1)
      return { kind: 'union', nullable: shape.null, options: [] };
    if (shape.object) {
      const { count, fields } = shape.object;
      const list = [...fields].map(([key, field]) => ({
        key,
        type: ref(field.shape, typeName(key)),
        optional: field.count < count,
      }));
      options.push({ kind: 'object', nullable: false, name: declare(hint, list, fixed) });
    }
    if (shape.array)
      options.push({ kind: 'array', nullable: false, item: ref(shape.array, itemName(hint)) });
    if (!options.length) return { kind: 'null', nullable: true };
    if (options.length === 1) return { ...options[0], nullable: shape.null };
    return { kind: 'union', nullable: shape.null, options };
  };

  const shape = infer(node);
  const onlyObject =
    shape.object && !shape.string && !shape.number && !shape.boolean && !shape.null && !shape.array;
  const type = ref(shape, root, onlyObject ? root : undefined);
  return { root, type, declarations };
}

/** Root declaration first, then the rest in dependency order (matches the TypeScript output). */
function rootFirst({ root, declarations }: Model): Declaration[] {
  const list = [...declarations];
  const index = list.findIndex((d) => d.name === root);
  if (index > 0) list.unshift(...list.splice(index, 1));
  return list;
}

/** The model's root is an object declaration rather than an alias for another type. */
const rootIsDeclared = (model: Model) =>
  model.type.kind === 'object' && !model.type.nullable && model.type.name === model.root;

const words = (text: string) =>
  text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z]{2})/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean);

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/** PascalCase; `prefix` is used when the result is empty or would start with a digit. */
function pascalWith(text: string, prefix: string, word = capital): string {
  const name = words(text).map(word).join('');
  return !name || /^\d/.test(name) ? prefix + name : name;
}

function snake(text: string): string {
  const name = words(text)
    .map((w) => w.toLowerCase())
    .join('_');
  return !name || /^\d/.test(name) ? 'field_' + name : name;
}

function camel(text: string): string {
  const [first = '', ...rest] = words(text);
  const name = first.toLowerCase() + rest.map(capital).join('');
  return !name || /^\d/.test(name) ? 'field' + name : name;
}

/** Assigns each field a distinct identifier within one declaration. */
function fieldNames(fields: Field[], name: (key: string) => string, taken: string[] = []) {
  const used = new Set(taken);
  return fields.map(({ key }) => {
    const base = name(key);
    let unique = base;
    for (let n = 2; used.has(unique); n++) unique = base + n;
    used.add(unique);
    return unique;
  });
}

/** A double-quoted string literal for C-like languages. */
function quoted(text: string, unicode: (hex: string) => string, extra = ''): string {
  const special = new RegExp(`["\\\\\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029${extra}]`, 'g');
  return (
    '"' +
    text.replace(special, (c) => {
      if (c === '\n') return '\\n';
      if (c === '\r') return '\\r';
      if (c === '\t') return '\\t';
      if (c === '"' || c === '\\' || extra.includes(c)) return '\\' + c;
      return unicode(c.charCodeAt(0).toString(16).padStart(4, '0'));
    }) +
    '"'
  );
}

/** Pads rows of cells into aligned columns (as gofmt does for struct fields). */
function columns(rows: string[][], indent: string): string[] {
  const widths: number[] = [];
  for (const row of rows)
    row.forEach((cell, i) => {
      if (i < row.length - 1) widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  return rows.map(
    (row) =>
      indent + row.map((cell, i) => (i < row.length - 1 ? cell.padEnd(widths[i]) : cell)).join(' '),
  );
}

// ---- Go ---------------------------------------------------------------------------------

const GO_INITIALISMS = new Set(
  'ACL API ASCII CPU CSS CSV DB DNS EOF GUID HTML HTTP HTTPS ID IP JSON JWT LHS OS QPS RAM RHS RPC SDK SLA SMTP SQL SSH SSO TCP TLS TTL UDP UI UID UUID URI URL UTF8 VM XML XMPP XSRF XSS'.split(
    ' ',
  ),
);

function goWord(word: string): string {
  const upper = word.toUpperCase();
  if (GO_INITIALISMS.has(upper)) return upper;
  if (/s$/i.test(word) && GO_INITIALISMS.has(upper.slice(0, -1))) return upper.slice(0, -1) + 's';
  return capital(word);
}

/** encoding/json ignores tag names with other characters and falls back to the field name. */
const GO_TAG_NAME = /^[\p{L}\p{N}!#$%&()*+\-./:;<=>?@[\]^_{|}~ ]+$/u;

export function toGo(node: Node, rootName = 'Root'): string {
  const model = buildModel(node, rootName, (t) => pascalWith(t, 'T', goWord), [], false);
  const goImports = new Set<string>();
  // Pointers let nullable values hold nil and let omitempty drop missing structs and scalars.
  const typeOf = (t: TypeRef, optional = false): string => {
    let base: string;
    switch (t.kind) {
      case 'string':
        base = 'string';
        break;
      case 'integer':
        if (t.big) goImports.add('encoding/json');
        base = t.big ? 'json.Number' : 'int64';
        break;
      case 'number':
        base = 'float64';
        break;
      case 'boolean':
        base = 'bool';
        break;
      case 'object':
        base = t.name!;
        break;
      case 'array':
        return '[]' + typeOf(t.item!);
      default:
        return 'any';
    }
    return t.nullable || optional ? '*' + base : base;
  };
  const out = ['package model'];
  const importAt = out.length;
  if (!rootIsDeclared(model)) out.push(`type ${model.root} ${typeOf(model.type)}`);
  for (const { name, fields } of rootFirst(model)) {
    const names = fieldNames(fields, (key) => pascalWith(key, 'Field', goWord));
    const rows = fields.map(({ key, type, optional }, i) => {
      const omit = optional ? ',omitempty' : '';
      const tag =
        key === '-'
          ? `json:"-,${omit.slice(1)}"`
          : GO_TAG_NAME.test(key) && !key.includes(',')
            ? `json:"${key}${omit}"`
            : null;
      return tag
        ? [names[i], typeOf(type, optional), '`' + tag + '`']
        : [
            names[i],
            typeOf(type, optional),
            '`json:"-"` // JSON key ' + JSON.stringify(key) + ' cannot be used in a struct tag',
          ];
    });
    out.push(
      rows.length
        ? `type ${name} struct {\n${columns(rows, '\t').join('\n')}\n}`
        : `type ${name} struct{}`,
    );
  }
  if (goImports.size)
    out.splice(
      importAt,
      0,
      [...goImports]
        .sort()
        .map((name) => `import "${name}"`)
        .join('\n'),
    );
  return out.join('\n\n') + '\n';
}

// ---- Rust -------------------------------------------------------------------------------

const RUST_KEYWORDS = new Set(
  'as async await break const continue crate dyn else enum extern false fn for gen if impl in let loop match mod move mut pub ref return self static struct super trait true try type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield'.split(
    ' ',
  ),
);

export function toRust(node: Node, rootName = 'Root'): string {
  const model = buildModel(
    node,
    rootName,
    (t) => pascalWith(t, 'T'),
    [
      'Box',
      'Deserialize',
      'Err',
      'None',
      'Ok',
      'Option',
      'Result',
      'Self',
      'Serialize',
      'Some',
      'String',
      'Vec',
    ],
    false,
  );
  const typeOf = (t: TypeRef, optional = false): string => {
    let base: string;
    switch (t.kind) {
      case 'string':
        base = 'String';
        break;
      case 'integer':
        base = t.big ? 'serde_json::Number' : 'i64';
        break;
      case 'number':
        base = 'f64';
        break;
      case 'boolean':
        base = 'bool';
        break;
      case 'object':
        base = t.name!;
        break;
      case 'array':
        base = `Vec<${typeOf(t.item!)}>`;
        break;
      default:
        base = 'serde_json::Value';
    }
    return t.nullable || optional ? `Option<${base}>` : base;
  };
  const string = (text: string) => quoted(text, (hex) => `\\u{${hex}}`);
  const out = model.declarations.length ? ['use serde::{Deserialize, Serialize};'] : [];
  if (!rootIsDeclared(model)) out.push(`pub type ${model.root} = ${typeOf(model.type)};`);
  for (const { name, fields } of rootFirst(model)) {
    const derive = '#[derive(Debug, Clone, Serialize, Deserialize)]';
    if (!fields.length) {
      out.push(`${derive}\npub struct ${name} {}`);
      continue;
    }
    const names = fieldNames(fields, (key) => {
      const base = snake(key);
      return RUST_KEYWORDS.has(base) ? base + '_' : base;
    });
    const lines = fields.flatMap(({ key, type, optional }, i) => [
      ...(names[i] !== key ? [`    #[serde(rename = ${string(key)})]`] : []),
      ...(optional ? ['    #[serde(default, skip_serializing_if = "Option::is_none")]'] : []),
      `    pub ${names[i]}: ${typeOf(type, optional)},`,
    ]);
    out.push(`${derive}\npub struct ${name} {\n${lines.join('\n')}\n}`);
  }
  return out.join('\n\n') + '\n';
}

// ---- Python -----------------------------------------------------------------------------

const PYTHON_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield dataclass field'.split(
    ' ',
  ),
);

export function toPython(node: Node, rootName = 'Root'): string {
  const model = buildModel(
    node,
    rootName,
    (t) => pascalWith(t, 'T'),
    ['Any', 'False', 'List', 'None', 'Optional', 'True', 'Union'],
    true,
  );
  const typing = new Set<string>();
  const use = (name: string) => (typing.add(name), name);
  const typeOf = (t: TypeRef): string => {
    let base: string;
    switch (t.kind) {
      case 'string':
        base = 'str';
        break;
      case 'integer':
        base = 'int';
        break;
      case 'number':
        base = 'float';
        break;
      case 'boolean':
        base = 'bool';
        break;
      case 'object':
        base = t.name!;
        break;
      case 'array':
        base = `${use('List')}[${typeOf(t.item!)}]`;
        break;
      case 'union':
        base = `${use('Union')}[${t.options!.map(typeOf).join(', ')}]`;
        break;
      case 'null':
        return 'None';
      default:
        base = use('Any');
    }
    return t.nullable ? `${use('Optional')}[${base}]` : base;
  };
  let needsField = false;
  const classes = rootFirst(model).map(({ name, fields }) => {
    const names = fieldNames(fields, (key) => {
      const base = snake(key);
      return PYTHON_KEYWORDS.has(base) ? base + '_' : base;
    });
    const lines = fields.map(({ key, type, optional }, i) => {
      let hint = typeOf(optional ? { ...type, nullable: true } : type);
      if (optional && type.kind === 'null') hint = 'None';
      const args = [
        ...(optional ? ['default=None'] : []),
        ...(names[i] !== key ? [`metadata={"json": ${JSON.stringify(key)}}`] : []),
      ];
      if (args.length && names[i] !== key) needsField = true;
      const value = names[i] !== key ? ` = field(${args.join(', ')})` : optional ? ' = None' : '';
      return `    ${names[i]}: ${hint}${value}`;
    });
    return `@dataclass(kw_only=True)\nclass ${name}:\n${lines.length ? lines.join('\n') : '    pass'}`;
  });
  const alias = rootIsDeclared(model) ? [] : [`${model.root} = ${typeOf(model.type)}`];
  const header = [
    'from __future__ import annotations',
    [
      ...(classes.length
        ? [`from dataclasses import ${needsField ? 'dataclass, field' : 'dataclass'}`]
        : []),
      ...(typing.size ? [`from typing import ${[...typing].sort().join(', ')}`] : []),
    ].join('\n'),
  ].filter(Boolean);
  return [header.join('\n\n'), ...classes, ...alias].join('\n\n\n') + '\n';
}

// ---- Zod --------------------------------------------------------------------------------

export function toZod(node: Node, rootName = 'Root'): string {
  const model = buildModel(node, rootName, (t) => pascalWith(t, 'T'), [], true);
  const schemaOf = (t: TypeRef, optional = false): string => {
    let base: string;
    switch (t.kind) {
      case 'string':
        base = 'z.string()';
        break;
      case 'integer':
        base = 'z.number().int()';
        break;
      case 'number':
        base = 'z.number()';
        break;
      case 'boolean':
        base = 'z.boolean()';
        break;
      case 'object':
        base = t.name + 'Schema';
        break;
      case 'array':
        base = `z.array(${schemaOf(t.item!)})`;
        break;
      case 'union':
        base = `z.union([${t.options!.map((o) => schemaOf(o)).join(', ')}])`;
        break;
      case 'null':
        base = 'z.null()';
        break;
      default:
        base = 'z.unknown()';
    }
    if (t.nullable && t.kind !== 'null') base += '.nullable()';
    return optional ? base + '.optional()' : base;
  };
  const out = ["import { z } from 'zod';"];
  // Dependency order: a const can only refer to schemas declared above it.
  for (const { name, fields } of model.declarations) {
    const lines = fields.map(({ key, type, optional }) => {
      // A literal __proto__ key would set the prototype; a computed key defines a property.
      const property =
        key === '__proto__' ? '["__proto__"]' : IDENTIFIER.test(key) ? key : JSON.stringify(key);
      return `  ${property}: ${schemaOf(type, optional)},`;
    });
    out.push(
      `export const ${name}Schema = z.object({${lines.length ? `\n${lines.join('\n')}\n` : ''}});\n` +
        `export type ${name} = z.infer<typeof ${name}Schema>;`,
    );
  }
  if (!rootIsDeclared(model))
    out.push(
      `export const ${model.root}Schema = ${schemaOf(model.type)};\n` +
        `export type ${model.root} = z.infer<typeof ${model.root}Schema>;`,
    );
  return out.join('\n\n') + '\n';
}

// ---- Kotlin -----------------------------------------------------------------------------

const KOTLIN_KEYWORDS = new Set(
  'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(
    ' ',
  ),
);

export function toKotlin(node: Node, rootName = 'Root'): string {
  const model = buildModel(
    node,
    rootName,
    (t) => pascalWith(t, 'T'),
    [
      'Any',
      'Array',
      'Boolean',
      'Char',
      'Double',
      'Int',
      'JsonElement',
      'List',
      'Long',
      'Map',
      'Nothing',
      'SerialName',
      'Serializable',
      'Set',
      'String',
      'Unit',
    ],
    false,
  );
  const imports = new Set<string>();
  const typeOf = (t: TypeRef): string => {
    let base: string;
    switch (t.kind) {
      case 'string':
        base = 'String';
        break;
      case 'integer':
        if (t.big) imports.add('kotlinx.serialization.json.JsonElement');
        base = t.big ? 'JsonElement' : 'Long';
        break;
      case 'number':
        base = 'Double';
        break;
      case 'boolean':
        base = 'Boolean';
        break;
      case 'object':
        base = t.name!;
        break;
      case 'array':
        base = `List<${typeOf(t.item!)}>`;
        break;
      default:
        imports.add('kotlinx.serialization.json.JsonElement');
        base = 'JsonElement';
    }
    return t.nullable ? base + '?' : base;
  };
  const string = (text: string) => quoted(text, (hex) => `\\u${hex}`, '$');
  const out: string[] = [];
  if (!rootIsDeclared(model)) out.push(`typealias ${model.root} = ${typeOf(model.type)}`);
  for (const { name, fields } of rootFirst(model)) {
    imports.add('kotlinx.serialization.Serializable');
    if (!fields.length) {
      out.push(`@Serializable\nclass ${name}`);
      continue;
    }
    const names = fieldNames(fields, camel);
    const lines = fields.map(({ key, type, optional }, i) => {
      if (names[i] !== key) imports.add('kotlinx.serialization.SerialName');
      const id = KOTLIN_KEYWORDS.has(names[i]) ? '`' + names[i] + '`' : names[i];
      const rename = names[i] !== key ? `@SerialName(${string(key)}) ` : '';
      const kotlinType = typeOf(optional ? { ...type, nullable: true } : type);
      return `    ${rename}val ${id}: ${kotlinType}${optional ? ' = null' : ''},`;
    });
    out.push(`@Serializable\ndata class ${name}(\n${lines.join('\n')}\n)`);
  }
  const header = [...imports].sort().map((i) => `import ${i}`);
  return [...(header.length ? [header.join('\n')] : []), ...out].join('\n\n') + '\n';
}

// ---- C# ---------------------------------------------------------------------------------

export function toCSharp(node: Node, rootName = 'Root'): string {
  const model = buildModel(
    node,
    rootName,
    (t) => pascalWith(t, 'T'),
    ['Dictionary', 'JsonElement', 'JsonPropertyName', 'List', 'Object', 'String', 'System'],
    false,
  );
  const usings = new Set<string>();
  const typeOf = (t: TypeRef): string => {
    let base: string;
    switch (t.kind) {
      case 'string':
        base = 'string';
        break;
      case 'integer':
        // System.Text.Json can't bind BigInteger without a custom converter; JsonElement keeps it.
        if (t.big) usings.add('System.Text.Json');
        base = t.big ? 'JsonElement' : 'long';
        break;
      case 'number':
        base = 'double';
        break;
      case 'boolean':
        base = 'bool';
        break;
      case 'object':
        base = t.name!;
        break;
      case 'array':
        usings.add('System.Collections.Generic');
        base = `List<${typeOf(t.item!)}>`;
        break;
      default:
        usings.add('System.Text.Json');
        base = 'JsonElement';
    }
    return t.nullable ? base + '?' : base;
  };
  const string = (text: string) => quoted(text, (hex) => `\\u${hex}`);
  const out: string[] = [];
  for (const { name, fields } of rootFirst(model)) {
    // A member cannot share its enclosing type's name.
    const names = fieldNames(fields, (key) => pascalWith(key, 'Field'), [name]);
    const lines = fields.map(({ key, type, optional }, i) => {
      usings.add('System.Text.Json.Serialization');
      const required = optional ? '' : 'required ';
      const csType = typeOf(optional ? { ...type, nullable: true } : type);
      return `    [JsonPropertyName(${string(key)})]\n    public ${required}${csType} ${names[i]} { get; set; }`;
    });
    out.push(`public sealed class ${name}\n{\n${lines.join('\n\n')}${lines.length ? '\n' : ''}}`);
  }
  if (!rootIsDeclared(model)) out.unshift(`// Deserialize the document as ${typeOf(model.type)}.`);
  const header = [...usings].sort().map((u) => `using ${u};`);
  return (
    [...(header.length ? [header.join('\n')] : []), '#nullable enable', ...out].join('\n\n') + '\n'
  );
}

// ---- XML --------------------------------------------------------------------------------

const XML_NAME = /^[\p{L}_][\p{L}\p{M}\p{N}_.-]*$/u;
/** Characters XML 1.0 cannot represent at all, even as character references. */
const XML_INVALID =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function xmlName(key: string): { name: string; renamed: boolean } {
  if (XML_NAME.test(key)) return { name: key, renamed: false };
  const name = key.replace(/[^\p{L}\p{M}\p{N}_.-]/gu, '_');
  return { name: /^[\p{L}_]/u.test(name) ? name : '_' + name, renamed: true };
}

const xmlText = (text: string) =>
  text
    .replace(XML_INVALID, '\ufffd')
    .replace(/[&<>\r]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;' })[c]!);

const xmlAttribute = (text: string) =>
  text
    .replace(XML_INVALID, '\ufffd')
    .replace(
      /[&<"\t\n\r]/g,
      (c) =>
        ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', '\t': '&#9;', '\n': '&#10;', '\r': '&#13;' })[
          c
        ]!,
    );

function xmlElement(name: string, attributes: string, node: Node, depth: number, out: string[]) {
  const pad = '  '.repeat(depth);
  const open = name + attributes;
  if (node.type === 'object' && node.members.length) {
    out.push(`${pad}<${open}>`);
    for (const { key, value } of node.members) {
      const child = xmlName(key);
      const attribute = child.renamed ? ` key="${xmlAttribute(key)}"` : '';
      xmlElement(child.name, attribute, value, depth + 1, out);
    }
    out.push(`${pad}</${name}>`);
  } else if (node.type === 'array' && node.items.length) {
    const one = singular(name);
    const item = one !== name && XML_NAME.test(one) ? one : 'item';
    out.push(`${pad}<${open}>`);
    for (const value of node.items) xmlElement(item, '', value, depth + 1, out);
    out.push(`${pad}</${name}>`);
  } else if (node.type === 'object' || node.type === 'array' || node.type === 'null') {
    out.push(`${pad}<${open}/>`);
  } else {
    out.push(`${pad}<${open}>${xmlText(scalarText(node))}</${name}>`);
  }
}

/**
 * XML 1.0 with one root element. Object members become child elements; array items become
 * repeated children named after the singular of the array's element name (or "item"). Keys
 * that are not XML names are sanitized and keep the original in a `key` attribute. Null, empty
 * objects, and empty arrays become empty elements, so those are indistinguishable in XML.
 */
export function toXML(node: Node, rootName = 'root'): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  xmlElement(xmlName(rootName).name, '', node, 0, out);
  return out.join('\n') + '\n';
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
