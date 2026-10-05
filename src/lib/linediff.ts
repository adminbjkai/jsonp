/** Line-aligned comparison of two normalized JSON documents (pure; runs in the compare worker). */
import { diffArrays } from 'diff';
import { diffTrees, type Change, type ChangeKind } from './diff';
import { processJSON, pointer } from './json';
import { parseTree, serialize, sortKeys as sortTreeKeys, type Part } from './tree';

type RowKind = 'same' | 'add' | 'del' | 'mod';
/** One aligned row. `a` and `b` are 0-based line indexes in the original and modified texts. */
export interface Row {
  kind: RowKind;
  a?: number;
  b?: number;
}
interface Alignment {
  rows: Row[];
  /** Row index where each run of consecutive changed rows starts. */
  hunks: number[];
  /** True when the line diff gave up (timeout) and lines were paired by position. */
  approximate: boolean;
}
interface AlignOptions {
  /** Milliseconds before the line diff falls back to positional pairing (default 3000). */
  timeout?: number;
  /** Upper bound on edit distance before falling back (mainly for tests). */
  maxEditLength?: number;
}

// A line's "shape": indentation plus its property name, or the closing bracket, or "·" for a value.
// Lines with the same shape pair up as modified; others stay separate removed/added lines.
const SHAPE = /^(\s*)("(?:\\.|[^"\\])*"\s*:)?/;
function shape(line: string) {
  const [, indent, key] = SHAPE.exec(line)!;
  if (key) return indent + key;
  const first = line[indent.length];
  return indent + (first === '}' || first === ']' ? first : '·');
}

/**
 * Turns an adjacent run of removed lines a[aStart, aStart+aCount) and added lines
 * b[bStart, bStart+bCount) into rows. Lines with the same shape (indent + key) pair into
 * 'mod' rows in order; the excess stays 'del'/'add'.
 */
export function pairToRows(
  a: string[],
  aStart: number,
  aCount: number,
  b: string[],
  bStart: number,
  bCount: number,
  out: Row[] = [],
  /** Milliseconds allowed for shape matching; 0 or less pairs by position. */
  timeout = 200,
): Row[] {
  let i = aStart,
    j = bStart;
  const del = (n: number) => {
    for (let k = 0; k < n; k++) out.push({ kind: 'del', a: i++ });
  };
  const add = (n: number) => {
    for (let k = 0; k < n; k++) out.push({ kind: 'add', b: j++ });
  };
  const pair = (n: number) => {
    for (let k = 0; k < n; k++, i++, j++)
      out.push({ kind: a[i] === b[j] ? 'same' : 'mod', a: i, b: j });
  };
  const positional = () => {
    const n = Math.min(aCount, bCount);
    pair(n);
    del(aCount - n);
    add(bCount - n);
    return out;
  };
  if (!aCount || !bCount) {
    del(aCount);
    add(bCount);
    return out;
  }
  if (aCount === bCount && aCount === 1) return positional();
  if (timeout <= 0 || aCount * bCount > 4_000_000) return positional();
  const shapesA = a.slice(aStart, aStart + aCount).map(shape);
  const shapesB = b.slice(bStart, bStart + bCount).map(shape);
  const parts = diffArrays(shapesA, shapesB, { timeout });
  if (!parts) return positional();
  for (const part of parts) {
    const n = part.count ?? part.value.length;
    if (part.removed) del(n);
    else if (part.added) add(n);
    else pair(n);
  }
  return out;
}

/** Row indexes where each run of non-'same' rows begins. */
function findHunks(rows: Row[]): number[] {
  const hunks: number[] = [];
  for (let i = 0; i < rows.length; i++)
    if (rows[i].kind !== 'same' && (i === 0 || rows[i - 1].kind === 'same')) hunks.push(i);
  return hunks;
}

/** Aligns two line arrays into side-by-side rows (Myers diff, positional fallback on timeout). */
export function alignLines(a: string[], b: string[], options: AlignOptions = {}): Alignment {
  const rows: Row[] = [];
  let approximate = false;
  // Common prefix and suffix are cheap to strip and keep the diff itself small.
  let start = 0;
  const shortest = Math.min(a.length, b.length);
  while (start < shortest && a[start] === b[start]) {
    rows.push({ kind: 'same', a: start, b: start });
    start++;
  }
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start < endA && start < endB) {
    // Interned line ids make every comparison an integer compare.
    const ids = new Map<string, number>();
    const intern = (line: string) => {
      let id = ids.get(line);
      if (id === undefined) ids.set(line, (id = ids.size));
      return id;
    };
    const timeout = options.timeout ?? 3000;
    // Shape matching inside changed blocks shares one more `timeout` budget.
    const deadline = Date.now() + 2 * timeout;
    const midA = a.slice(start, endA).map(intern);
    const midB = b.slice(start, endB).map(intern);
    const parts = diffArrays(midA, midB, {
      timeout,
      ...(options.maxEditLength !== undefined && { maxEditLength: options.maxEditLength }),
    });
    let i = start,
      j = start;
    if (!parts) {
      approximate = true;
      const n = Math.min(endA - start, endB - start);
      for (let k = 0; k < n; k++, i++, j++)
        rows.push({ kind: a[i] === b[j] ? 'same' : 'mod', a: i, b: j });
      while (i < endA) rows.push({ kind: 'del', a: i++ });
      while (j < endB) rows.push({ kind: 'add', b: j++ });
    } else {
      let removed = 0,
        added = 0;
      const flush = () => {
        if (removed || added)
          pairToRows(a, i, removed, b, j, added, rows, Math.min(200, deadline - Date.now()));
        i += removed;
        j += added;
        removed = added = 0;
      };
      for (const part of parts) {
        const n = part.count ?? part.value.length;
        if (part.removed) removed += n;
        else if (part.added) added += n;
        else {
          flush();
          for (let k = 0; k < n; k++, i++, j++) rows.push({ kind: 'same', a: i, b: j });
        }
      }
      flush();
    }
  } else {
    for (let i = start; i < endA; i++) rows.push({ kind: 'del', a: i });
    for (let j = start; j < endB; j++) rows.push({ kind: 'add', b: j });
  }
  for (let k = 0; endA + k < a.length; k++) rows.push({ kind: 'same', a: endA + k, b: endB + k });
  return { rows, hunks: findHunks(rows), approximate };
}

// ---- Display list (folding unchanged runs) ----------------------------------------------

interface Fold {
  start: number;
  end: number;
}
export interface Display {
  /** item >= 0: row (item >> 1) and half (item & 1; 1 = the new side of a unified 'mod' row). item < 0: fold -item-1. */
  items: Int32Array;
  /** First row index each item covers (non-decreasing, for binary search). */
  starts: Int32Array;
  folds: Fold[];
}
interface DisplayOptions {
  onlyChanges: boolean;
  context?: number;
  /** Fold start rows the person expanded. */
  expanded?: Set<number>;
  /** Unified layout shows a modified row as two lines (old, then new). */
  unified?: boolean;
}

export function buildDisplay(rows: Row[], options: DisplayOptions): Display {
  const { onlyChanges, context = 3, expanded, unified } = options;
  const items: number[] = [],
    starts: number[] = [],
    folds: Fold[] = [];
  const push = (r: number) => {
    items.push(r * 2);
    starts.push(r);
    if (unified && rows[r].kind === 'mod') {
      items.push(r * 2 + 1);
      starts.push(r);
    }
  };
  for (let i = 0; i < rows.length;) {
    if (!onlyChanges || rows[i].kind !== 'same') {
      push(i++);
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') j++;
    const lead = i === 0 ? 0 : context,
      trail = j === rows.length ? 0 : context;
    const from = i + lead,
      to = j - trail;
    if (to - from >= 2 && !expanded?.has(from)) {
      for (let r = i; r < from; r++) push(r);
      folds.push({ start: from, end: to });
      items.push(-folds.length);
      starts.push(from);
      for (let r = to; r < j; r++) push(r);
    } else for (let r = i; r < j; r++) push(r);
    i = j;
  }
  return { items: Int32Array.from(items), starts: Int32Array.from(starts), folds };
}

/** Display index of the item that contains `row` (a row or the fold hiding it). */
export function displayIndexOf(display: Display, row: number): number {
  const { starts } = display;
  let lo = 0,
    hi = starts.length - 1,
    found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= row) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // With two items for one unified 'mod' row, prefer the first.
  while (found > 0 && starts[found - 1] === row && display.items[found - 1] >= 0) found--;
  return found;
}

// ---- Whole-document comparison ----------------------------------------------------------

export interface CompareRequest {
  left: string;
  right: string;
  sortKeys: boolean;
  ignoreOrder: boolean;
}
interface StructuralChange extends Change {
  /** Row to jump to: the path's line in the original (or modified, for additions). */
  row: number;
}
export interface CompareResult extends Alignment {
  left: string[];
  right: string[];
  changes: StructuralChange[];
  truncated: boolean;
  structural: Record<ChangeKind, number>;
  counts: { added: number; removed: number; changed: number };
  /** No line differences, but the raw key order differs (only possible with sortKeys). */
  keyOrderOnly: boolean;
}

function lineMap(text: string) {
  const map = new Map<string, number>();
  for (const entry of processJSON(text, 2).entries) map.set(entry.path, entry.line);
  return map;
}
function lookup(map: Map<string, number>, parts: Part[]) {
  for (let n = parts.length; n >= 0; n--) {
    const line = map.get(pointer(parts.slice(0, n)));
    if (line !== undefined) return line;
  }
  return 0;
}

/** Normalizes both documents, aligns their lines, and attaches structural changes to rows. */
export function compareDocuments(
  request: CompareRequest,
  options: AlignOptions = {},
): CompareResult {
  const parse = (text: string, side: string) => {
    try {
      return parseTree(text);
    } catch (error) {
      throw new Error(`The ${side} document isn’t valid JSON.`, { cause: error });
    }
  };
  const rawA = parse(request.left, 'original'),
    rawB = parse(request.right, 'modified');
  const treeA = request.sortKeys ? sortTreeKeys(rawA) : rawA;
  const treeB = request.sortKeys ? sortTreeKeys(rawB) : rawB;
  const textA = serialize(treeA, 2),
    textB = serialize(treeB, 2);
  const left = textA.split('\n'),
    right = textB.split('\n');
  const alignment = alignLines(left, right, options);
  const diff = diffTrees(treeA, treeB, { ignoreOrder: request.ignoreOrder });
  const counts = { added: 0, removed: 0, changed: 0 };
  const rowOfA = new Int32Array(left.length),
    rowOfB = new Int32Array(right.length);
  alignment.rows.forEach((row, index) => {
    if (row.kind === 'add') counts.added++;
    else if (row.kind === 'del') counts.removed++;
    else if (row.kind === 'mod') counts.changed++;
    if (row.a !== undefined) rowOfA[row.a] = index;
    if (row.b !== undefined) rowOfB[row.b] = index;
  });
  let changes: StructuralChange[] = [];
  if (diff.changes.length) {
    const linesA = lineMap(textA),
      linesB = lineMap(textB);
    changes = diff.changes.map((change) => ({
      ...change,
      row:
        change.kind === 'added'
          ? rowOfB[lookup(linesB, change.parts)]
          : rowOfA[lookup(linesA, change.parts)],
    }));
  }
  const keyOrderOnly =
    request.sortKeys && !alignment.hunks.length && serialize(rawA, 2) !== serialize(rawB, 2);
  return {
    ...alignment,
    left,
    right,
    changes,
    truncated: diff.truncated,
    structural: diff.summary,
    counts,
    keyOrderOnly,
  };
}

// ---- Sample pair --------------------------------------------------------------------------

/** Original sample for Compare. */
export const SAMPLE_ORIGINAL = `{
  "project": "Orbital",
  "version": 2,
  "status": "ready",
  "budget": 120000,
  "settings": {
    "theme": "#b5d68b",
    "notifications": true,
    "refreshInterval": 30
  },
  "crew": [
    { "name": "Alex", "role": "Engineer" },
    { "name": "Sam", "role": "Designer" }
  ],
  "launchSite": {
    "name": "Kourou",
    "country": "French Guiana",
    "latitude": 5.236,
    "longitude": -52.775,
    "elevationMeters": 14
  },
  "nextLaunch": null
}`;

/** Modified sample: changed values, a removed key, type changes, an inserted crew member, and a new array. */
export const SAMPLE_MODIFIED = `{
  "project": "Orbital",
  "version": 3,
  "status": "launched",
  "settings": {
    "theme": "#b5d68b",
    "notifications": "weekly",
    "refreshInterval": 30
  },
  "crew": [
    { "name": "Alex", "role": "Engineer" },
    { "name": "Riley", "role": "Pilot" },
    { "name": "Sam", "role": "Designer" }
  ],
  "launchSite": {
    "name": "Kourou",
    "country": "French Guiana",
    "latitude": 5.236,
    "longitude": -52.775,
    "elevationMeters": 14
  },
  "nextLaunch": "2026-11-04",
  "tags": ["mars", "cargo"]
}`;
