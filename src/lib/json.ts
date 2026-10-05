import { locateError, type SyntaxProblem } from './locate';
import type { RepairResult } from './repair';
/** Lossless JSON formatting and source ranges. Numbers and strings keep their exact tokens. */
export type ValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export interface Entry {
  path: string;
  parent: string | null;
  parts: (string | number)[];
  type: ValueType;
  value: string;
  start: number;
  end: number;
  keyStart: number;
  outputStart: number;
  outputEnd: number;
  line: number;
  endLine: number;
  count: number;
}
export interface DocumentResult {
  output: string;
  entries: Entry[];
  warnings: string[];
  error: string | null;
  /** Location of a syntax error, when the document isn't valid JSON. */
  problem?: SyntaxProblem;
  /** A repaired copy of invalid input, when one can be made. */
  repair?: RepairResult;
}
export const MAX_INPUT = 5 * 1024 * 1024;
const MAX_ENTRIES = 300_000;
export type MappingEntry = Pick<Entry, 'path' | 'parts' | 'type' | 'value'>;
export const isContainer = (entry: Pick<Entry, 'type'>) =>
  entry.type === 'object' || entry.type === 'array';
/** The innermost entry whose key or value covers a source offset. Entries are in source order. */
export function entryAtOffset(entries: Entry[], offset: number): Entry | undefined {
  let low = 0,
    high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid].keyStart <= offset) low = mid + 1;
    else high = mid;
  }
  for (let i = low - 1; i >= 0; i--) if (offset < entries[i].end) return entries[i];
  return undefined;
}
/**
 * The entry at an offset in the formatted output: the innermost value covering it, or the member
 * whose key the offset falls in (the output records where values start, not keys).
 */
export function entryAtOutput(entries: Entry[], output: string, offset: number): Entry | undefined {
  let low = 0,
    high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid].outputStart <= offset) low = mid + 1;
    else high = mid;
  }
  const next = entries[low];
  if (
    next &&
    typeof next.parts.at(-1) === 'string' &&
    /^"?(?:[^"\\]|\\.)*"\s*:\s*$/.test(output.slice(offset, next.outputStart))
  )
    return next;
  for (let i = low - 1; i >= 0; i--) if (offset < entries[i].outputEnd) return entries[i];
  return undefined;
}
export const pointer = (parts: (string | number)[]) =>
  parts.length
    ? '/' + parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
    : '';
const property = (part: string) =>
  /^[a-zA-Z_$][\w$]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`;
export const jsonPath = (parts: (string | number)[]) =>
  '$' + parts.map((p) => (typeof p === 'number' ? `[${p}]` : property(p))).join('');
export const jsPath = (parts: (string | number)[]) =>
  parts.length
    ? parts
        .map((p, i) =>
          typeof p === 'number'
            ? `[${p}]`
            : i === 0 && /^[a-zA-Z_$][\w$]*$/.test(p)
              ? p
              : property(p),
        )
        .join('')
    : '';
/**
 * Explorer search: a value matches when the query appears in its JSON Pointer, JSONPath, value, or
 * type. Plain queries skip building the JSONPath, which is the slow part, whenever that cannot
 * change the result: a query of only letters, digits, `_`, and `-` can only appear in a JSONPath
 * inside raw key text (also present in the pointer) unless a key contains characters that JSON
 * escapes there (quotes, backslashes, control characters, surrogates), which a one-time scan detects.
 */
export function entryMatcher(entries: Entry[]) {
  let escapedKeys: boolean | undefined;
  return (query: string): ((entry: Entry) => boolean) => {
    escapedKeys ??= entries.some((entry) => {
      const key = entry.parts.at(-1);
      return typeof key === 'string' && /["\\\u0000-\u001f\ud800-\udfff]/.test(key);
    });
    const q = query.toLowerCase();
    if (!escapedKeys && /^[\w-]+$/.test(q))
      return (entry) =>
        entry.path.toLowerCase().includes(q) ||
        entry.value.toLowerCase().includes(q) ||
        entry.type.includes(q);
    return (entry) =>
      `${entry.path} ${jsonPath(entry.parts)} ${entry.value} ${entry.type}`
        .toLowerCase()
        .includes(q);
  };
}
export const EXAMPLE = `{
  "project": "Orbital",
  "version": 2,
  "status": "ready",
  "settings": {
    "theme": "#b5d68b",
    "notifications": true,
    "refreshInterval": 30
  },
  "crew": [
    { "name": "Alex", "role": "Engineer" },
    { "name": "Sam", "role": "Designer" }
  ],
  "nextLaunch": null
}`;

/** Indentation: a number of spaces (0 = compact) or '\t' for tabs. */
export type Indent = number | '\t';
export function processJSON(source: string, indent: Indent = 2): DocumentResult {
  const unit = typeof indent === 'string' ? indent : ' '.repeat(indent);
  const empty: DocumentResult = { output: '', entries: [], warnings: [], error: null };
  if (!source.trim()) return empty;
  try {
    if (source.length > MAX_INPUT)
      throw new Error('Document exceeds the 5 MiB character limit. Open a smaller JSON file.');
    // Validation only: never serialize this parsed value, which can round numbers.
    try {
      JSON.parse(source);
    } catch {
      const problem = locateError(source);
      return {
        ...empty,
        problem,
        error: `Line ${problem.line + 1}, column ${problem.column}: ${problem.message}`,
      };
    }
    const tokens = source.matchAll(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g,
    );
    const chunks: string[] = [];
    const entries: Entry[] = [];
    const warnings = new Set<string>();
    const seen = new Set<string>();
    const stack: {
      entry: Entry;
      key: string | null;
      keyStart: number;
      expectKey: boolean;
      index: number;
    }[] = [];
    let length = 0,
      line = 0,
      previous = '';
    const append = (text: string) => {
      length += text.length;
      if (length > 20 * 1024 * 1024)
        throw new Error('Formatted output exceeds 20 MiB. Try compact formatting.');
      chunks.push(text);
      line += text.split('\n').length - 1;
    };
    const newline = () => {
      if (unit) append('\n' + unit.repeat(stack.length));
    };
    for (const match of tokens) {
      const token = match[0],
        start = match.index!;
      const frame = stack[stack.length - 1];
      if (token === ',' || token === ':') {
        append(token);
        if (token === ':') {
          if (unit) append(' ');
        } else {
          if (frame.entry.type === 'object') frame.expectKey = true;
          newline();
        }
      } else if (token === '}' || token === ']') {
        const closed = stack.pop()!;
        if (previous !== '{' && previous !== '[') newline();
        append(token);
        closed.entry.end = start + 1;
        closed.entry.outputEnd = length;
        closed.entry.endLine = line;
        closed.entry.value =
          closed.entry.type === 'array'
            ? `Array(${closed.entry.count})`
            : `Object(${closed.entry.count})`;
      } else if (frame?.expectKey && token.startsWith('"')) {
        frame.key = JSON.parse(token);
        frame.keyStart = start;
        frame.expectKey = false;
        append(token);
      } else {
        if (entries.length >= MAX_ENTRIES)
          throw new Error(
            'This document has more than 300,000 values. Split it into smaller documents.',
          );
        const part = frame ? (frame.entry.type === 'array' ? frame.index++ : frame.key!) : null;
        const parts = frame ? [...frame.entry.parts, part!] : [];
        const path = pointer(parts);
        const type: ValueType =
          token === '{'
            ? 'object'
            : token === '['
              ? 'array'
              : token.startsWith('"')
                ? 'string'
                : token === 'null'
                  ? 'null'
                  : token === 'true' || token === 'false'
                    ? 'boolean'
                    : 'number';
        if (seen.has(path))
          warnings.add(
            'Duplicate object keys found. Formatting preserves them; paths select the last occurrence.',
          );
        seen.add(path);
        const entry: Entry = {
          path,
          parent: frame?.entry.path ?? null,
          parts,
          type,
          value: type === 'string' ? JSON.parse(token) : token,
          start,
          end: start + token.length,
          keyStart: frame?.entry.type === 'object' ? frame.keyStart : start,
          outputStart: length,
          outputEnd: length + token.length,
          line,
          endLine: line,
          count: 0,
        };
        entries.push(entry);
        if (frame) frame.entry.count++;
        append(token);
        if (isContainer(entry)) {
          if (stack.length >= 256)
            throw new Error(
              'Nesting exceeds 256 levels. Reduce nesting to keep the workspace responsive.',
            );
          stack.push({ entry, key: null, keyStart: 0, expectKey: type === 'object', index: 0 });
          // Empty containers stay on one line; defer the newline until next token.
        }
      }
      previous = token;
      // Insert opening newline only for a nonempty container.
      if (token === '{' || token === '[') {
        let nextIndex = start + 1;
        while (/\s/.test(source[nextIndex] || '') && nextIndex < source.length) nextIndex++;
        const next = source[nextIndex];
        if (next !== '}' && next !== ']') newline();
      }
    }
    return { output: chunks.join(''), entries, warnings: [...warnings], error: null };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'Unable to process JSON.' };
  }
}

/** Every value with its exact path. The blank mapping column names the other side of the interface. */
export function mappingRows(entries: MappingEntry[], role: 'source' | 'target' = 'source') {
  return entries.map((entry) => ({
    Level: entry.parts.length,
    'Field Name': entry.parts.length ? String(entry.parts.at(-1)) : 'root',
    Type: entry.type,
    'Sample Value': isContainer(entry) ? '' : entry.value,
    'JSONPath Reference': jsonPath(entry.parts),
    'JSON Pointer': entry.path,
    'Requirement ID': '',
    [role === 'source' ? 'Mapping Target' : 'Mapping Source']: '',
    'Business Rule / Logic': '',
    Description: '',
  }));
}
