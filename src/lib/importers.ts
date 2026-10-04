/** Pure converters from YAML, XML, CSV/TSV, XLSX, and ODS to strict JSON text. Run in a worker. */
import {
  parseAllDocuments,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  type Document,
  type Scalar,
} from 'yaml';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readXlsx } from 'hucre/xlsx';
import { readOds } from 'hucre/ods';
import type { CellValue, Workbook } from 'hucre/xlsx';
import { csvToJSON } from './convert';
import { serialize, type Node, type Member } from './tree';
import {
  formatFromName,
  sniffText,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELLS,
  type ImportFormat,
  type ImportResult,
} from './importFile';

export { formatFromName, sniffText, type ImportFormat, type ImportResult };

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const plural = (count: number, word: string) =>
  `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

// ---- YAML ---------------------------------------------------------------------------------

const base64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const SET = 'tag:yaml.org,2002:set';
const OMAP = 'tag:yaml.org,2002:omap';

/** Converts one YAML scalar to a lossless JSON node. */
function yamlScalar(node: Scalar): Node {
  const { value, source } = node;
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'bigint') return { type: 'number', raw: String(value) };
  if (typeof value === 'number')
    return source && JSON_NUMBER.test(source)
      ? { type: 'number', raw: source }
      : Number.isFinite(value)
        ? { type: 'number', raw: String(value) }
        : { type: 'null' };
  if (value instanceof Date) return { type: 'string', value: source ?? value.toISOString() };
  if (value instanceof Uint8Array) return { type: 'string', value: base64(value) };
  return { type: 'string', value: String(value) };
}

/**
 * Walks the parsed YAML document (not toJS) so key order, exact numbers, sets, ordered maps,
 * merge keys, and aliases all convert faithfully. Recursive aliases and complex keys are
 * reported in plain language.
 */
function yamlDocument(doc: Document.Parsed): Node {
  let aliases = 0;
  const active = new Set<unknown>();
  const keyText = (key: unknown): string => {
    if (key === null || key === undefined) return 'null';
    if (isScalar(key)) return key.source ?? String(key.value);
    if (isAlias(key)) return keyText(key.resolve(doc));
    throw new Error("YAML uses a map or list as a key, which JSON can't represent.");
  };
  const isMergeKey = (key: unknown) => isScalar(key) && (key.source ?? key.value) === '<<';
  const convert = (node: unknown, depth: number): Node => {
    if (depth > 256) throw new Error('YAML nesting is deeper than 256 levels.');
    if (node === null || node === undefined) return { type: 'null' };
    if (isAlias(node)) {
      if (++aliases > 1000) throw new Error('YAML expands too many aliases (more than 1,000).');
      const target = node.resolve(doc);
      if (!target) throw new Error(`YAML alias *${node.source} has no matching anchor.`);
      if (active.has(target))
        throw new Error(`YAML anchor &${node.source} refers to itself, so it can't become JSON.`);
      return convert(target, depth + 1);
    }
    if (isScalar(node)) return yamlScalar(node);
    active.add(node);
    try {
      if (isMap(node)) {
        if (node.tag === SET)
          return {
            type: 'array',
            items: node.items.map((pair) => convert(pair.key, depth + 1)),
          };
        const members: Member[] = [];
        const seen = new Map<string, number>();
        const add = (key: string, value: Node, override: boolean) => {
          const at = seen.get(key);
          if (at === undefined) {
            seen.set(key, members.length);
            members.push({ key, value });
          } else if (override) members[at] = { key, value };
        };
        const merges: Node[] = [];
        for (const pair of node.items) {
          if (isMergeKey(pair.key)) {
            const source = convert(pair.value, depth + 1);
            merges.push(...(source.type === 'array' ? source.items : [source]));
          } else add(keyText(pair.key), convert(pair.value, depth + 1), true);
        }
        // Merged keys fill in only what the map doesn't define; earlier sources win.
        for (const source of merges)
          if (source.type === 'object')
            for (const member of source.members) add(member.key, member.value, false);
        return { type: 'object', members };
      }
      if (isSeq(node)) {
        if (node.tag === OMAP || (node.items.every((item) => isPair(item)) && node.items.length))
          return {
            type: 'object',
            members: node.items.flatMap((item): Member[] => {
              if (isPair(item))
                return [{ key: keyText(item.key), value: convert(item.value, depth + 1) }];
              const entry = convert(item, depth + 1);
              return entry.type === 'object' ? entry.members : [];
            }),
          };
        return { type: 'array', items: node.items.map((item) => convert(item, depth + 1)) };
      }
      if (isPair(node)) return convert(node.value, depth + 1);
      return { type: 'string', value: String(node) };
    } finally {
      active.delete(node);
    }
  };
  return convert(doc.contents, 0);
}

/**
 * Lossless YAML → JSON. Numbers keep their source token when it is valid JSON (big integers,
 * trailing zeros); other numeric forms (0x1F) use their value; NaN/Infinity become null.
 * Key order is kept, timestamps stay strings, binary becomes base64, sets become arrays,
 * ordered maps become objects, aliases and merge keys are resolved, and several documents
 * become an array.
 */
export function yamlToJSON(text: string): string {
  const documents = parseAllDocuments(text, {
    merge: false,
    customTags: ['binary', 'omap', 'set', 'timestamp'],
  });
  if (!documents.length) return 'null';
  const values = documents.map((document) => {
    const error = document.errors[0];
    if (error) throw new Error(`YAML: ${error.message.split('\n')[0]}`);
    return yamlDocument(document);
  });
  return serialize(values.length === 1 ? values[0] : { type: 'array', items: values }, 2);
}

// ---- XML ----------------------------------------------------------------------------------

/**
 * XML → JSON with every value kept as a string. Attributes are prefixed `@`, mixed text is
 * `#text`, repeated elements become arrays, CDATA is merged into text.
 */
export function xmlToJSON(text: string): string {
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`XML line ${valid.err.line}: ${valid.err.msg}`);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    // Decode numeric (&#169; &#x41;) and HTML named entities, not just the XML five.
    htmlEntities: true,
  });
  return JSON.stringify(parser.parse(text), null, 2);
}

// ---- Spreadsheets -------------------------------------------------------------------------

function cellNode(value: CellValue): Node {
  if (value === null || value === '') return { type: 'null' };
  if (typeof value === 'number')
    return Number.isFinite(value) ? { type: 'number', raw: String(value) } : { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (value instanceof Date) {
    const iso = value.toISOString();
    return { type: 'string', value: iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso };
  }
  return { type: 'string', value };
}
const empty = (value: CellValue) => value === null || value === '';

/** First row is the header; blank rows and fully empty columns are dropped. */
function sheetRows(rows: CellValue[][]): Node[] {
  const body = rows.filter((row) => !row.every(empty));
  if (!body.length) return [];
  const [head, ...data] = body;
  const columns = head
    .map((_, c) => c)
    .filter((c) => !empty(head[c]) || data.some((row) => !empty(row[c])));
  const used = new Set<string>();
  const keys = columns.map((c) => {
    const label = cellNode(head[c]);
    const base =
      label.type === 'null'
        ? `column${c + 1}`
        : label.type === 'string'
          ? label.value
          : label.type === 'number'
            ? label.raw
            : String(head[c]);
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return key;
  });
  return data.map((row) => ({
    type: 'object',
    members: columns.map((c, i) => ({ key: keys[i], value: cellNode(row[c] ?? null) })),
  }));
}

async function readSpreadsheet(format: 'xlsx' | 'ods', bytes: Uint8Array): Promise<Workbook> {
  const options = { maxTotalCells: MAX_IMPORT_CELLS, maxDecompressedBytes: 64 * 1024 * 1024 };
  try {
    return format === 'xlsx' ? await readXlsx(bytes, options) : await readOds(bytes, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cell/i.test(message) && /limit|exceed|max/i.test(message)) throw tooManyCells();
    throw new Error(`Unable to read ${format.toUpperCase()}: ${message}`);
  }
}
const tooManyCells = () =>
  new Error(`Spreadsheet exceeds ${MAX_IMPORT_CELLS.toLocaleString('en-US')} cells.`);

async function spreadsheetToJSON(name: string, format: 'xlsx' | 'ods', bytes: Uint8Array) {
  const workbook = await readSpreadsheet(format, bytes);
  const sheets = workbook.sheets.filter((sheet) => !sheet.kind || sheet.kind === 'worksheet');
  const cells = sheets.reduce(
    (sum, sheet) => sum + sheet.rows.length * (sheet.rows[0]?.length ?? 0),
    0,
  );
  if (cells > MAX_IMPORT_CELLS) throw tooManyCells();
  const tables = sheets.map((sheet) => ({ name: sheet.name, rows: sheetRows(sheet.rows) }));
  // An unreadable or empty workbook must not silently replace the document with [].
  if (!tables.length)
    throw new Error(`${name} has no worksheets. It may be damaged or not a spreadsheet.`);
  if (tables.every((table) => !table.rows.length))
    throw new Error(`${name} has no data rows. The first row of a sheet is read as its header.`);
  if (tables.length === 1) {
    const [{ name: sheet, rows }] = tables;
    return {
      text: serialize({ type: 'array', items: rows }, 2),
      note: `Imported ${plural(rows.length, 'row')} from ${name} (${sheet}).`,
    };
  }
  return {
    text: serialize(
      {
        type: 'object',
        members: tables.map((table) => ({
          key: table.name,
          value: { type: 'array', items: table.rows },
        })),
      },
      2,
    ),
    note: `Imported ${plural(tables.length, 'sheet')} from ${name} (${tables
      .map((table) => `${table.name}: ${plural(table.rows.length, 'row')}`)
      .join(', ')}).`,
  };
}

// ---- Entry point --------------------------------------------------------------------------

const rowCount = (json: string) => {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.length : 0;
};

/** Converts file bytes to JSON text. Format comes from the extension, else from the content. */
export async function importBytes(name: string, bytes: Uint8Array): Promise<ImportResult> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error(`${name} is larger than 5 MiB.`);
  let format = formatFromName(name);
  if (format === 'xlsx' || format === 'ods') {
    const { text, note } = await spreadsheetToJSON(name, format, bytes);
    return { text, format, note };
  }
  const text = new TextDecoder().decode(bytes);
  if (!format) {
    try {
      JSON.parse(text);
      format = 'json';
    } catch {
      format = sniffText(text);
    }
    if (!format) throw new Error(`Unsupported file type: ${name}`);
  }
  switch (format) {
    case 'json':
      return { text, format, note: `Opened ${name}.` };
    case 'yaml':
      return { text: yamlToJSON(text), format, note: `Imported YAML from ${name}.` };
    case 'xml':
      return { text: xmlToJSON(text), format, note: `Imported XML from ${name}.` };
    default: {
      const json = csvToJSON(text);
      const label = format === 'tsv' ? 'TSV' : 'CSV';
      return {
        text: json,
        format,
        note: `Imported ${plural(rowCount(json), 'row')} of ${label} from ${name}.`,
      };
    }
  }
}
