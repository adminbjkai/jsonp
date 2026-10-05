import type { Entry } from './json';

/** Where an entry sits in source order. Entries are sorted by the offset of their key. */
export function indexOfEntry(entries: Entry[], entry: Entry): number {
  let low = 0,
    high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid].keyStart < entry.keyStart) low = mid + 1;
    else high = mid;
  }
  return entries[low] === entry ? low : -1;
}

const SCAN_LIMIT = 200;

/**
 * A short look inside a container for its collapsed row: the first few keys of an object, or the
 * first few values of an array, ending with an ellipsis when there is more.
 */
export function childPreview(entries: Entry[], entry: Entry, show = 4): string {
  const start = indexOfEntry(entries, entry);
  if (start < 0 || !entry.count) return '';
  const depth = entry.parts.length;
  const items: string[] = [];
  let more = false;
  let i = start + 1;
  for (; i < entries.length && i <= start + SCAN_LIMIT; i++) {
    const child = entries[i];
    if (child.parts.length <= depth) break;
    if (child.parts.length !== depth + 1) continue;
    if (items.length === show) {
      more = true;
      break;
    }
    items.push(
      entry.type === 'object'
        ? String(child.parts[depth])
        : child.type === 'object'
          ? '{…}'
          : child.type === 'array'
            ? '[…]'
            : child.type === 'string'
              ? `"${child.value}"`
              : child.value,
    );
  }
  if (i > start + SCAN_LIMIT && i < entries.length && entries[i].parts.length > depth) more = true;
  return items.join(', ') + (more ? ', …' : '');
}

/** Case-insensitive occurrences of a query in a text, as [start, end) pairs (at most eight). */
export function highlightRanges(text: string, query: string): [number, number][] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const haystack = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (
    let at = haystack.indexOf(q);
    at !== -1 && ranges.length < 8;
    at = haystack.indexOf(q, at + q.length)
  )
    ranges.push([at, at + q.length]);
  return ranges;
}
