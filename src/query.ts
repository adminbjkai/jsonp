/** JSONPath (RFC 9535-flavoured practical subset) evaluated against the lossless tree. */
import { compareNumbers, toValue, type Node, type Part } from './tree';

export interface QueryMatch {
  parts: Part[];
  node: Node;
}

type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'slice'; start?: number; end?: number; step?: number }
  | { kind: 'filter'; expr: Expr };
interface Segment {
  descendant: boolean;
  selectors: Selector[];
}
type Operand =
  { kind: 'path'; absolute: boolean; segments: Segment[] } | { kind: 'literal'; value: unknown };
type Expr =
  | { kind: 'or' | 'and'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  | { kind: 'exists'; path: Operand & { kind: 'path' } }
  | { kind: 'compare'; op: string; left: Operand; right: Operand }
  | { kind: 'regex'; left: Operand; regex: RegExp };

const MAX_NESTING = 64;
const MAX_WORK = 2_000_000;
const NAME_START = /[A-Za-z_$\u0080-\uffff]/;
const NAME_CHAR = /[A-Za-z0-9_$\-\u0080-\uffff]/;

/** True when the trimmed text looks like a JSONPath query. */
export const isQuery = (text: string) => text.trim().startsWith('$');

class Parser {
  pos = 0;
  private depth = 0;
  private filters = 0;
  private brackets = 0;
  constructor(private src: string) {}

  fail(message?: string): never {
    if (message) throw new Error(message);
    if (this.pos >= this.src.length) {
      if (this.filters) throw new Error('Unclosed filter');
      if (this.brackets) throw new Error('Unclosed bracket');
      throw new Error('Unexpected end of query');
    }
    throw new Error(`Unexpected character '${this.src[this.pos]}' at ${this.pos}`);
  }
  private peek(offset = 0) {
    return this.src[this.pos + offset];
  }
  private ws() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
  private eat(text: string) {
    if (!this.src.startsWith(text, this.pos)) return false;
    this.pos += text.length;
    return true;
  }
  private expect(text: string) {
    if (!this.eat(text)) this.fail();
  }
  private enter() {
    if (++this.depth > MAX_NESTING) this.fail('Query is nested too deeply');
  }

  parseQuery(): Segment[] {
    this.ws();
    this.expect('$');
    const segments = this.segments();
    this.ws();
    if (this.pos < this.src.length) this.fail();
    return segments;
  }

  private segments(): Segment[] {
    const segments: Segment[] = [];
    for (;;) {
      const save = this.pos;
      this.ws();
      const c = this.peek();
      if (c === '.' && this.peek(1) === '.') {
        this.pos += 2;
        if (this.peek() === '[') segments.push({ descendant: true, selectors: this.bracket() });
        else segments.push({ descendant: true, selectors: [this.dotSelector()] });
      } else if (c === '.') {
        this.pos++;
        segments.push({ descendant: false, selectors: [this.dotSelector()] });
      } else if (c === '[') {
        segments.push({ descendant: false, selectors: this.bracket() });
      } else {
        this.pos = save;
        return segments;
      }
    }
  }

  private dotSelector(): Selector {
    if (this.eat('*')) return { kind: 'wildcard' };
    const start = this.pos;
    if (!NAME_START.test(this.peek() ?? '')) this.fail();
    while (this.pos < this.src.length && NAME_CHAR.test(this.src[this.pos])) this.pos++;
    return { kind: 'name', name: this.src.slice(start, this.pos) };
  }

  private bracket(): Selector[] {
    this.enter();
    this.pos++; // [
    this.brackets++;
    const selectors: Selector[] = [];
    for (;;) {
      this.ws();
      selectors.push(this.selector());
      this.ws();
      if (this.eat(',')) continue;
      if (this.eat(']')) break;
      this.fail();
    }
    this.brackets--;
    this.depth--;
    return selectors;
  }

  private selector(): Selector {
    const c = this.peek();
    if (c === "'" || c === '"') return { kind: 'name', name: this.string() };
    if (this.eat('*')) return { kind: 'wildcard' };
    if (c === '?') {
      this.pos++;
      this.filters++;
      const expr = this.or();
      this.filters--;
      return { kind: 'filter', expr };
    }
    if (c === ':' || c === '-' || /\d/.test(c ?? '')) {
      const start = this.integer();
      this.ws();
      if (!this.eat(':')) {
        if (start === undefined) this.fail();
        return { kind: 'index', index: start };
      }
      this.ws();
      const end = this.integer();
      this.ws();
      let step: number | undefined;
      if (this.eat(':')) {
        this.ws();
        step = this.integer();
      }
      return { kind: 'slice', start, end, step };
    }
    return this.fail();
  }

  private integer(): number | undefined {
    const match = /^-?\d+/.exec(this.src.slice(this.pos));
    if (!match) {
      if (this.peek() === '-') this.fail();
      return undefined;
    }
    this.pos += match[0].length;
    return Number(match[0]);
  }

  private string(): string {
    const quote = this.src[this.pos++];
    let out = '';
    for (;;) {
      if (this.pos >= this.src.length) this.fail('Unclosed string');
      const c = this.src[this.pos++];
      if (c === quote) return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.src[this.pos++];
      const simple: Record<string, string> = {
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
        '/': '/',
        '\\': '\\',
        "'": "'",
        '"': '"',
      };
      if (e in simple) out += simple[e];
      else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(this.src.slice(this.pos, this.pos + 4))) {
        out += String.fromCharCode(parseInt(this.src.slice(this.pos, this.pos + 4), 16));
        this.pos += 4;
      } else this.fail(`Invalid escape at ${this.pos - 2}`);
    }
  }

  // ---- Filter expressions ----

  private or(): Expr {
    let left = this.and();
    for (;;) {
      this.ws();
      if (!this.eat('||')) return left;
      left = { kind: 'or', left, right: this.and() };
    }
  }

  private and(): Expr {
    let left = this.unary();
    for (;;) {
      this.ws();
      if (!this.eat('&&')) return left;
      left = { kind: 'and', left, right: this.unary() };
    }
  }

  private unary(): Expr {
    this.enter();
    this.ws();
    let expr: Expr;
    if (this.peek() === '!' && this.peek(1) !== '=') {
      this.pos++;
      expr = { kind: 'not', expr: this.unary() };
    } else if (this.eat('(')) {
      expr = this.or();
      this.ws();
      this.expect(')');
    } else expr = this.comparison();
    this.depth--;
    return expr;
  }

  private comparison(): Expr {
    const at = this.pos;
    const left = this.operand();
    this.ws();
    if (this.eat('=~')) {
      this.ws();
      return { kind: 'regex', left, regex: this.regex() };
    }
    const op = ['==', '!=', '<=', '>=', '<', '>'].find((o) => this.eat(o));
    if (op) {
      this.ws();
      return { kind: 'compare', op, left, right: this.operand() };
    }
    if (left.kind === 'path') return { kind: 'exists', path: left };
    return this.fail(`Expected a comparison after the literal at ${at}`);
  }

  private operand(): Operand {
    const c = this.peek();
    if (c === '@' || c === '$') {
      this.pos++;
      return { kind: 'path', absolute: c === '$', segments: this.segments() };
    }
    if (c === "'" || c === '"') return { kind: 'literal', value: this.string() };
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (number) {
      this.pos += number[0].length;
      return { kind: 'literal', value: new Exact(number[0]) };
    }
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.src.startsWith(word, this.pos) && !NAME_CHAR.test(this.peek(word.length) ?? '')) {
        this.pos += word.length;
        return { kind: 'literal', value };
      }
    }
    return this.fail();
  }

  private regex(): RegExp {
    const at = this.pos;
    let pattern: string;
    if (this.peek() === "'" || this.peek() === '"') pattern = this.string();
    else {
      this.expect('/');
      let inClass = false;
      const start = this.pos;
      for (;;) {
        if (this.pos >= this.src.length) this.fail('Unclosed regular expression');
        const c = this.src[this.pos];
        if (c === '\\') this.pos += 2;
        else {
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) break;
          this.pos++;
        }
      }
      pattern = this.src.slice(start, this.pos);
      this.pos++;
    }
    const flags = /^[a-z]*/.exec(this.src.slice(this.pos))![0];
    this.pos += flags.length;
    try {
      return new RegExp(pattern, flags.replace(/[gy]/g, ''));
    } catch {
      return this.fail(`Invalid regular expression at ${at}`);
    }
  }
}

// ---- Evaluation ----

interface Context {
  root: Node;
  work: number;
  absolute: Map<Segment[], Node[]>;
}

const childCount = (node: Node) =>
  node.type === 'object' ? node.members.length : node.type === 'array' ? node.items.length : 0;
const childAt = (node: Node, i: number): Node =>
  node.type === 'object' ? node.members[i].value : (node as { items: Node[] }).items[i];
const partAt = (node: Node, i: number): Part => (node.type === 'object' ? node.members[i].key : i);

function tick(ctx: Context, amount = 1) {
  ctx.work += amount;
  if (ctx.work > MAX_WORK) throw new Error('Query is too expensive for this document');
}

function sliceIndexes(len: number, s: Extract<Selector, { kind: 'slice' }>): number[] {
  const step = s.step ?? 1;
  const out: number[] = [];
  if (step === 0) return out;
  const norm = (n: number) => (n < 0 ? len + n : n);
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
  if (step > 0) {
    const lower = clamp(norm(s.start ?? 0), 0, len);
    const upper = clamp(norm(s.end ?? len), 0, len);
    for (let i = lower; i < upper; i += step) out.push(i);
  } else {
    const upper = clamp(norm(s.start ?? len - 1), -1, len - 1);
    const lower = clamp(s.end === undefined ? -1 : norm(s.end), -1, len - 1);
    for (let i = upper; i > lower; i += step) out.push(i);
  }
  return out;
}

/** Child indexes (member or item positions) of `node` selected by `sel`, in selector order. */
function select(node: Node, sel: Selector, ctx: Context): number[] {
  const count = childCount(node);
  tick(ctx, count || 1);
  switch (sel.kind) {
    case 'name':
      if (node.type !== 'object') return [];
      return node.members.flatMap((m, i) => (m.key === sel.name ? [i] : []));
    case 'index': {
      if (node.type !== 'array') return [];
      const i = sel.index < 0 ? count + sel.index : sel.index;
      return i >= 0 && i < count ? [i] : [];
    }
    case 'wildcard':
      return Array.from({ length: count }, (_, i) => i);
    case 'slice':
      return node.type === 'array' ? sliceIndexes(count, sel) : [];
    case 'filter': {
      const out: number[] = [];
      for (let i = 0; i < count; i++) if (test(sel.expr, childAt(node, i), ctx)) out.push(i);
      return out;
    }
  }
}

/** A located node; parts are materialised lazily from the parent chain. */
interface Loc {
  node: Node;
  parent: Loc | null;
  part: Part;
}

const partsOf = (loc: Loc): Part[] => {
  const parts: Part[] = [];
  for (let at: Loc | null = loc; at?.parent; at = at.parent) parts.push(at.part);
  return parts.reverse();
};

function evaluate(segments: Segment[], start: Loc, ctx: Context, limit: number): Loc[] {
  let current = [start];
  segments.forEach((segment, index) => {
    const cap = index === segments.length - 1 ? limit : Infinity;
    const out: Loc[] = [];
    const child = (from: Loc, i: number): Loc => ({
      node: childAt(from.node, i),
      parent: from,
      part: partAt(from.node, i),
    });
    const emit = (loc: Loc) => {
      tick(ctx);
      out.push(loc);
    };
    const descend = (from: Loc, depth: number) => {
      if (depth > 1024) throw new Error('Document is nested too deeply');
      const count = childCount(from.node);
      if (!count) return;
      const hits = new Uint32Array(count);
      for (const sel of segment.selectors) for (const i of select(from.node, sel, ctx)) hits[i]++;
      for (let i = 0; i < count && out.length < cap; i++) {
        const loc = child(from, i);
        for (let n = 0; n < hits[i] && out.length < cap; n++) emit(loc);
        descend(loc, depth + 1);
      }
    };
    for (const loc of current) {
      if (out.length >= cap) break;
      if (segment.descendant) descend(loc, 0);
      else
        for (const sel of segment.selectors)
          for (const i of select(loc.node, sel, ctx)) {
            if (out.length >= cap) break;
            emit(child(loc, i));
          }
    }
    current = out;
  });
  return current.length > limit ? current.slice(0, limit) : current;
}

const NOTHING = Symbol('nothing');
/** A number kept as its source token, so comparisons beyond 2^53 stay exact. */
class Exact {
  constructor(readonly raw: string) {}
}

function operandValue(operand: Operand, current: Node, ctx: Context): unknown {
  if (operand.kind === 'literal') return operand.value;
  const nodes = pathNodes(operand, current, ctx);
  if (nodes.length !== 1) return NOTHING;
  return nodes[0].type === 'number' ? new Exact(nodes[0].raw) : toValue(nodes[0]);
}

function pathNodes(path: Operand & { kind: 'path' }, current: Node, ctx: Context): Node[] {
  if (!path.absolute)
    return evaluate(path.segments, { node: current, parent: null, part: 0 }, ctx, Infinity).map(
      (m) => m.node,
    );
  let cached = ctx.absolute.get(path.segments);
  if (!cached) {
    cached = evaluate(path.segments, { node: ctx.root, parent: null, part: 0 }, ctx, Infinity).map(
      (m) => m.node,
    );
    ctx.absolute.set(path.segments, cached);
  }
  return cached;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Exact || b instanceof Exact) {
    if (a instanceof Exact && b instanceof Exact) return compareNumbers(a.raw, b.raw) === 0;
    const [exact, other] = a instanceof Exact ? [a, b] : [b as Exact, a];
    return typeof other === 'number' && Number(exact.raw) === other;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((v, i) => deepEqual(v, other[i]));
  }
  const ka = Object.keys(a);
  const ob = b as Record<string, unknown>;
  return (
    ka.length === Object.keys(ob).length &&
    ka.every((k) => Object.hasOwn(ob, k) && deepEqual((a as Record<string, unknown>)[k], ob[k]))
  );
}

function less(a: unknown, b: unknown) {
  if (a instanceof Exact && b instanceof Exact) return compareNumbers(a.raw, b.raw) < 0;
  return (typeof a === 'number' && typeof b === 'number') ||
    (typeof a === 'string' && typeof b === 'string')
    ? (a as number) < (b as number)
    : false;
}

function test(expr: Expr, current: Node, ctx: Context): boolean {
  tick(ctx);
  switch (expr.kind) {
    case 'or':
      return test(expr.left, current, ctx) || test(expr.right, current, ctx);
    case 'and':
      return test(expr.left, current, ctx) && test(expr.right, current, ctx);
    case 'not':
      return !test(expr.expr, current, ctx);
    case 'exists':
      return pathNodes(expr.path, current, ctx).length > 0;
    case 'regex': {
      const value = operandValue(expr.left, current, ctx);
      return typeof value === 'string' && expr.regex.test(value);
    }
    case 'compare': {
      const a = operandValue(expr.left, current, ctx);
      const b = operandValue(expr.right, current, ctx);
      switch (expr.op) {
        case '==':
          return deepEqual(a, b);
        case '!=':
          return !deepEqual(a, b);
        case '<':
          return less(a, b);
        case '>':
          return less(b, a);
        case '<=':
          return less(a, b) || deepEqual(a, b);
        default:
          return less(b, a) || deepEqual(a, b);
      }
    }
  }
}

/** Runs a JSONPath query. Throws Error with a short user-facing message on syntax errors. */
export function runQuery(root: Node, expression: string, limit = 10_000): QueryMatch[] {
  const segments = new Parser(expression).parseQuery();
  const ctx: Context = { root, work: 0, absolute: new Map() };
  return evaluate(segments, { node: root, parent: null, part: 0 }, ctx, limit).map((loc) => ({
    parts: partsOf(loc),
    node: loc.node,
  }));
}
