/** Structural comparison of two lossless trees. */
import { diffArrays } from 'diff';
import { serialize, type Node, type Part, canonicalNumber } from './tree';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'type';
export interface Change {
  kind: ChangeKind;
  parts: Part[];
  before?: string;
  after?: string;
}
interface DiffResult {
  changes: Change[];
  truncated: boolean;
  summary: Record<ChangeKind, number>;
}

const MAX_TEXT = 200;
const compact = (node: Node) => {
  const text = serialize(node, 0);
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + '…' : text;
};

/** Last occurrence wins for duplicate keys, matching JSON.parse; order is first appearance. */
function lastWins(node: Node & { type: 'object' }): Map<string, Node> {
  const map = new Map<string, Node>();
  for (const member of node.members) map.set(member.key, member.value);
  return map;
}

export function diffTrees(
  a: Node,
  b: Node,
  options: { ignoreOrder?: boolean; limit?: number } = {},
): DiffResult {
  const limit = options.limit ?? 5000;
  const ignoreOrder = !!options.ignoreOrder;
  const changes: Change[] = [];
  const summary: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0, type: 0 };
  let truncated = false;
  const canonCache = new WeakMap<Node, string>();

  const canonical = (node: Node): string => {
    const cached = canonCache.get(node);
    if (cached !== undefined) return cached;
    let text: string;
    if (node.type === 'object')
      text =
        '{' +
        [...lastWins(node)]
          .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
          .map(([key, value]) => JSON.stringify(key) + ':' + canonical(value))
          .join(',') +
        '}';
    else if (node.type === 'array') {
      const items = node.items.map(canonical);
      if (ignoreOrder) items.sort();
      text = '[' + items.join(',') + ']';
    } else if (node.type === 'number') text = canonicalNumber(node.raw);
    else text = serialize(node, 0);
    canonCache.set(node, text);
    return text;
  };

  const push = (kind: ChangeKind, parts: Part[], before?: Node, after?: Node) => {
    if (changes.length >= limit) {
      truncated = true;
      return;
    }
    const change: Change = { kind, parts };
    if (before) change.before = compact(before);
    if (after) change.after = compact(after);
    changes.push(change);
    summary[kind]++;
  };

  const walk = (x: Node, y: Node, parts: Part[]) => {
    if (truncated) return;
    if (x.type !== y.type) return push('type', parts, x, y);
    if (x.type === 'object' && y.type === 'object') {
      const left = lastWins(x);
      const right = lastWins(y);
      // b-only keys are reported right after the nearest preceding shared key in b.
      const additions = new Map<string | null, string[]>();
      let anchor: string | null = null;
      for (const key of right.keys()) {
        if (left.has(key)) anchor = key;
        else {
          const list = additions.get(anchor);
          if (list) list.push(key);
          else additions.set(anchor, [key]);
        }
      }
      const add = (anchorKey: string | null) => {
        for (const key of additions.get(anchorKey) ?? [])
          push('added', [...parts, key], undefined, right.get(key));
      };
      add(null);
      for (const [key, value] of left) {
        const other = right.get(key);
        if (other) walk(value, other, [...parts, key]);
        else push('removed', [...parts, key], value);
        add(key);
      }
      return;
    }
    if (x.type === 'array' && y.type === 'array') {
      if (ignoreOrder) {
        const pool = new Map<string, number[]>();
        y.items.forEach((item, i) => {
          const key = canonical(item);
          const list = pool.get(key);
          if (list) list.push(i);
          else pool.set(key, [i]);
        });
        // A read cursor per key keeps matching linear (no Array.shift).
        const cursor = new Map<string, number>();
        const matched = new Set<number>();
        x.items.forEach((item, i) => {
          const key = canonical(item);
          const queue = pool.get(key);
          const at = cursor.get(key) ?? 0;
          const j = queue?.[at];
          if (j !== undefined) cursor.set(key, at + 1);
          if (j === undefined) push('removed', [...parts, i], item);
          else matched.add(j);
        });
        y.items.forEach((item, j) => {
          if (!matched.has(j)) push('added', [...parts, j], undefined, item);
        });
        return;
      }
      // Arrays of different lengths are aligned on equal items first, so one inserted item is
      // one addition instead of a cascade of positional changes. Falls back to positions.
      const ops =
        x.items.length !== y.items.length
          ? diffArrays(x.items.map(canonical), y.items.map(canonical), { timeout: 1000 })
          : undefined;
      if (ops) {
        let i = 0,
          j = 0;
        for (let k = 0; k < ops.length && !truncated; k++) {
          const op = ops[k];
          if (!op.added && !op.removed) {
            i += op.count;
            j += op.count;
          } else if (op.removed) {
            const added = ops[k + 1]?.added ? ops[++k].count : 0;
            const pairs = Math.min(op.count, added);
            for (let n = 0; n < pairs; n++) walk(x.items[i + n], y.items[j + n], [...parts, i + n]);
            for (let n = pairs; n < op.count; n++)
              push('removed', [...parts, i + n], x.items[i + n]);
            for (let n = pairs; n < added; n++)
              push('added', [...parts, j + n], undefined, y.items[j + n]);
            i += op.count;
            j += added;
          } else {
            for (let n = 0; n < op.count; n++)
              push('added', [...parts, j + n], undefined, y.items[j + n]);
            j += op.count;
          }
        }
        return;
      }
      const shared = Math.min(x.items.length, y.items.length);
      for (let i = 0; i < shared; i++) walk(x.items[i], y.items[i], [...parts, i]);
      for (let i = shared; i < x.items.length; i++) push('removed', [...parts, i], x.items[i]);
      for (let i = shared; i < y.items.length; i++)
        push('added', [...parts, i], undefined, y.items[i]);
      return;
    }
    const same =
      x.type === 'number'
        ? canonicalNumber(x.raw) === canonicalNumber((y as { raw: string }).raw)
        : x.type === 'null' || (x as { value: unknown }).value === (y as { value: unknown }).value;
    if (!same) push('changed', parts, x, y);
  };

  walk(a, b, []);
  return { changes, truncated, summary };
}
