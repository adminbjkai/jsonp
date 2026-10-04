/** Lossless JSON tree. Numbers keep their exact source token; duplicate keys keep their order. */
export type Node =
  | { type: 'object'; members: Member[] }
  | { type: 'array'; items: Node[] }
  | { type: 'string'; value: string; raw?: string }
  | { type: 'number'; raw: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' };
/** `raw` keeps the key's original token (escapes included) when it came from source. */
export interface Member {
  key: string;
  value: Node;
  raw?: string;
}
export type Part = string | number;
const TOKEN =
  /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g;

/** Parses strict JSON (validated by JSON.parse) into a lossless tree. Throws on invalid input. */
export function parseTree(source: string): Node {
  JSON.parse(source);
  const tokens = source.match(TOKEN) || [];
  let i = 0;
  const read = (depth: number): Node => {
    if (depth > 256) throw new Error('Nesting exceeds 256 levels.');
    const token = tokens[i++];
    if (token === '{') {
      const members: Member[] = [];
      while (tokens[i] !== '}') {
        const raw = tokens[i];
        i += 2; // key and colon
        members.push({ key: JSON.parse(raw) as string, raw, value: read(depth + 1) });
        if (tokens[i] === ',') i++;
      }
      i++;
      return { type: 'object', members };
    }
    if (token === '[') {
      const items: Node[] = [];
      while (tokens[i] !== ']') {
        items.push(read(depth + 1));
        if (tokens[i] === ',') i++;
      }
      i++;
      return { type: 'array', items };
    }
    if (token.startsWith('"')) return { type: 'string', value: JSON.parse(token), raw: token };
    if (token === 'true' || token === 'false') return { type: 'boolean', value: token === 'true' };
    if (token === 'null') return { type: 'null' };
    return { type: 'number', raw: token };
  };
  return read(0);
}

/** Serializes a tree. indent 0 produces compact output; '\t' indents with tabs. */
export function serialize(node: Node, indent: number | '\t' = 2): string {
  const out: string[] = [];
  const unit = typeof indent === 'string' ? indent : ' '.repeat(indent);
  const write = (n: Node, depth: number) => {
    const pad = unit ? '\n' + unit.repeat(depth + 1) : '';
    const close = unit ? '\n' + unit.repeat(depth) : '';
    if (n.type === 'object') {
      if (!n.members.length) return void out.push('{}');
      out.push('{');
      n.members.forEach((member, index) => {
        out.push(
          index ? ',' + pad : pad,
          member.raw ?? JSON.stringify(member.key),
          unit ? ': ' : ':',
        );
        write(member.value, depth + 1);
      });
      out.push(close + '}');
    } else if (n.type === 'array') {
      if (!n.items.length) return void out.push('[]');
      out.push('[');
      n.items.forEach((item, index) => {
        out.push(index ? ',' + pad : pad);
        write(item, depth + 1);
      });
      out.push(close + ']');
    } else if (n.type === 'string') out.push(n.raw ?? JSON.stringify(n.value));
    else if (n.type === 'number') out.push(n.raw);
    else if (n.type === 'boolean') out.push(String(n.value));
    else out.push('null');
  };
  write(node, 0);
  return out.join('');
}

/** Finds a node by path parts. Duplicate keys resolve to the last occurrence, like JSON.parse. */
export function nodeAt(root: Node, parts: Part[]): Node | undefined {
  let node: Node | undefined = root;
  for (const part of parts) {
    if (node?.type === 'array' && typeof part === 'number') node = node.items[part];
    else if (node?.type === 'object')
      node = node.members.findLast((m) => m.key === String(part))?.value;
    else return undefined;
  }
  return node;
}

/** Converts to a plain JS value for comparisons and inference. Numbers become JS numbers. */
export function toValue(node: Node): unknown {
  switch (node.type) {
    case 'object': {
      const value: Record<string, unknown> = Object.create(null);
      for (const member of node.members) value[member.key] = toValue(member.value);
      return value;
    }
    case 'array':
      return node.items.map(toValue);
    case 'number':
      return Number(node.raw);
    case 'null':
      return null;
    default:
      return node.value;
  }
}

/** Builds a tree from a plain JS value (used by importers such as CSV). */
export function fromValue(value: unknown): Node {
  if (value === null || value === undefined) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', items: value.map(fromValue) };
  if (typeof value === 'object')
    return {
      type: 'object',
      members: Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
        key,
        value: fromValue(v),
      })),
    };
  if (typeof value === 'number')
    return Number.isFinite(value) ? { type: 'number', raw: String(value) } : { type: 'null' };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  return { type: 'string', value: String(value) };
}

// ---- Transforms -------------------------------------------------------------------------

export function sortKeys(node: Node, deep = true): Node {
  if (node.type === 'object')
    return {
      type: 'object',
      members: [...node.members]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((m) => ({ ...m, value: deep ? sortKeys(m.value, deep) : m.value })),
    };
  if (node.type === 'array' && deep)
    return { type: 'array', items: node.items.map((n) => sortKeys(n, deep)) };
  return node;
}

const isEmpty = (node: Node) =>
  node.type === 'null' ||
  (node.type === 'string' && node.value === '') ||
  (node.type === 'object' && !node.members.length) ||
  (node.type === 'array' && !node.items.length);

/** Removes nulls (and, with `empty`, empty strings/objects/arrays) from objects and arrays, recursively. */
export function prune(node: Node, empty = false): Node {
  const drop = (n: Node) => (empty ? isEmpty(n) : n.type === 'null');
  if (node.type === 'object')
    return {
      type: 'object',
      members: node.members
        .map((m) => ({ ...m, value: prune(m.value, empty) }))
        .filter((m) => !drop(m.value)),
    };
  if (node.type === 'array')
    return { type: 'array', items: node.items.map((n) => prune(n, empty)).filter((n) => !drop(n)) };
  return node;
}

/** Returns the JSON document as one escaped JSON string literal. */
export const escapeJSON = (node: Node) => JSON.stringify(serialize(node, 0));

/** If the root is a string that contains JSON, returns that JSON parsed losslessly. */
export function unescapeJSON(node: Node): Node | null {
  if (node.type !== 'string') return null;
  try {
    return parseTree(node.value);
  } catch {
    return null;
  }
}

// ---- Exact numbers ----------------------------------------------------------------------

/** Exact canonical form of a JSON number token, so `1.0`, `1`, and `10e-1` compare equal. */
export function canonicalNumber(raw: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return raw;
  const [, sign, int, frac = '', exp = '0'] = match;
  let digits = (int + frac).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(exp) - BigInt(frac.length);
  const trimmed = digits.replace(/0+$/, '');
  exponent += BigInt(digits.length - trimmed.length);
  digits = trimmed;
  return `${sign}${digits}e${exponent}`;
}

/** Compares two JSON number tokens exactly, without rounding to doubles. */
export function compareNumbers(a: string, b: string): number {
  const parse = (raw: string) => {
    const canonical = canonicalNumber(raw);
    if (canonical === '0') return { sign: 0, digits: '', magnitude: 0n };
    const [, sign, digits, exponent] = /^(-?)(\d+)e(-?\d+)$/.exec(canonical)!;
    return {
      sign: sign ? -1 : 1,
      digits,
      magnitude: BigInt(exponent) + BigInt(digits.length),
    };
  };
  const x = parse(a),
    y = parse(b);
  if (x.sign !== y.sign) return Math.sign(x.sign - y.sign);
  if (!x.sign) return 0;
  const order =
    x.magnitude !== y.magnitude
      ? x.magnitude > y.magnitude
        ? 1
        : -1
      : (() => {
          const width = Math.max(x.digits.length, y.digits.length);
          const dx = x.digits.padEnd(width, '0'),
            dy = y.digits.padEnd(width, '0');
          return dx === dy ? 0 : dx > dy ? 1 : -1;
        })();
  return order * x.sign;
}
