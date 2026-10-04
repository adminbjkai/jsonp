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
export const MAX_ENTRIES = 300_000;
export type MappingEntry = Pick<Entry, 'path' | 'parts' | 'type' | 'value'>;
export const isContainer = (entry: Pick<Entry, 'type'>) =>
  entry.type === 'object' || entry.type === 'array';
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

export function processJSON(source: string, indent = 2): DocumentResult {
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
      if (indent) append('\n' + ' '.repeat(stack.length * indent));
    };
    for (const match of tokens) {
      const token = match[0],
        start = match.index!;
      const frame = stack[stack.length - 1];
      if (token === ',' || token === ':') {
        append(token);
        if (token === ':') {
          if (indent) append(' ');
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

export function mappingRows(entries: MappingEntry[]) {
  return entries.map((entry) => ({
    Level: entry.parts.length,
    'Field Name': entry.parts.length ? String(entry.parts.at(-1)) : 'root',
    Type: entry.type,
    'Sample Value': isContainer(entry) ? '' : entry.value,
    'JSONPath Reference': jsonPath(entry.parts),
    'JSON Pointer': entry.path,
    'Requirement ID': '',
    'Mapping Target': '',
    'Business Rule / Logic': '',
    Description: '',
  }));
}
