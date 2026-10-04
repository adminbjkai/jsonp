import { parseTree, serialize } from './tree';

export interface RepairResult {
  output: string;
  fixes: string[];
}

type Count = Record<(typeof ORDER)[number], number>;
const ORDER = [
  'bom',
  'fence',
  'assignment',
  'jsonp',
  'comment',
  'whitespace',
  'smart',
  'single',
  'escape',
  'control',
  'unterminated',
  'key',
  'python',
  'nan',
  'hex',
  'number',
  'extraComma',
  'trailingComma',
  'missingComma',
  'wrap',
  'closed',
] as const;

const p = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MESSAGES: Record<keyof Count, (n: number) => string> = {
  bom: () => 'Removed byte order mark',
  fence: () => 'Removed Markdown code fence',
  assignment: () => 'Removed JavaScript assignment',
  jsonp: () => 'Removed JSONP wrapper',
  comment: (n) => `Removed ${p(n, 'comment')}`,
  whitespace: (n) => `Removed ${p(n, 'non-standard whitespace character')}`,
  smart: () => 'Replaced smart quotes',
  single: (n) => `Converted ${p(n, 'single-quoted string')}`,
  escape: (n) => `Fixed ${p(n, 'invalid escape sequence')}`,
  control: (n) => `Escaped ${p(n, 'control character')} in strings`,
  unterminated: () => 'Closed unterminated string',
  key: (n) => `Quoted ${p(n, 'key')}`,
  python: () => 'Replaced Python literals (True/False/None)',
  nan: () => 'Replaced NaN/Infinity/undefined with null',
  hex: (n) => `Converted ${p(n, 'hex number')}`,
  number: () => 'Normalized number format',
  extraComma: (n) => `Removed ${p(n, 'extra comma')}`,
  trailingComma: (n) => `Removed ${p(n, 'trailing comma')}`,
  missingComma: (n) => `Inserted ${p(n, 'missing comma')}`,
  wrap: (n) => `Wrapped ${n} values in an array`,
  closed: (n) => `Closed ${p(n, 'unclosed bracket')}`,
};

const FENCE = /```[^\n`]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/;
const ASSIGNMENT =
  /^\s*(?:(?:export\s+)?(?:const|let|var)\s+[\p{L}_$][\p{L}\p{N}_$]*\s*=|module\.exports\s*=|export\s+default\b)/u;
const JSONP = /^\s*[A-Za-z_$][\w$.]*\s*\(([\s\S]*)\)\s*;?\s*$/;
const NUMBER = /[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?![\w$.])/y;
const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const SPECIAL_NUMBER = /[+-]?(?:Infinity|NaN)(?![\w$])/y;
const IDENTIFIER = /[\p{L}_$][\p{L}\p{N}_$-]*/uy;
const OTHER_SPACE = /[\v\f\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/;
const HEX4 = /^[0-9a-fA-F]{4}$/;
const HEX2 = /^[0-9a-fA-F]{2}$/;
const NAMED_ESCAPES: Record<number, string> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  12: '\\f',
  13: '\\r',
};
const escapeCode = (c: number) => NAMED_ESCAPES[c] ?? '\\u' + c.toString(16).padStart(4, '0');

// Object states: 'open' expects a key (or '}'), 'colon', 'value', 'after' follows a value.
// Array states: 'open' expects a value (or ']'), 'after' follows a value.
type Ctx = { obj: boolean; state: 'open' | 'colon' | 'value' | 'after'; seen: boolean };

/** Returns null when the source is already valid JSON, blank, or cannot be repaired. */
export function repairJSON(source: string): RepairResult | null {
  try {
    return repair(source);
  } catch {
    return null;
  }
}

function repair(source: string): RepairResult | null {
  if (!source.trim()) return null;
  try {
    JSON.parse(source);
    return null;
  } catch {
    // Needs repair.
  }
  const count = Object.fromEntries(ORDER.map((k) => [k, 0])) as Count;

  let src = source;
  if (src.charCodeAt(0) === 0xfeff) {
    src = src.slice(1);
    count.bom++;
  }
  const fence = src.includes('```') ? FENCE.exec(src) : null;
  if (fence) {
    src = fence[1];
    count.fence++;
  }
  const assignment = ASSIGNMENT.exec(src);
  if (assignment) {
    src = src.slice(assignment[0].length).replace(/;\s*$/, '');
    count.assignment++;
  }
  const jsonp = JSONP.exec(src);
  if (jsonp) {
    src = jsonp[1];
    count.jsonp++;
  }

  const n = src.length;
  const out: string[] = [];
  const stack: Ctx[] = [];
  let values = 0;
  let i = 0;

  const top = () => stack[stack.length - 1] as Ctx | undefined;
  const atKey = () => {
    const t = top();
    return !!t && t.obj && (t.state === 'open' || t.state === 'after');
  };
  const emitKey = (json: string) => {
    const t = top()!;
    if (t.state === 'after') {
      out.push(',');
      count.missingComma++;
    } else if (t.seen) out.push(',');
    out.push(json);
    t.seen = true;
    t.state = 'colon';
  };
  /** Prepares the output for a value; false when a value is not allowed here. */
  const beginValue = (): boolean => {
    const t = top();
    if (!t) {
      if (values++) out.push(',');
      return true;
    }
    if (t.obj) {
      if (t.state !== 'value') return false;
    } else if (t.state === 'after') {
      out.push(',');
      count.missingComma++;
    } else if (t.seen) out.push(',');
    t.seen = true;
    t.state = 'after';
    return true;
  };
  const close = (obj: boolean): boolean => {
    const t = top();
    if (!t || t.obj !== obj || (t.state !== 'open' && t.state !== 'after')) return false;
    if (t.state === 'open' && t.seen) count.trailingComma++;
    stack.pop();
    out.push(obj ? '}' : ']');
    return true;
  };

  const readString = (): string => {
    const open = src[i];
    const single = open === "'";
    const closes = open === '"' ? '"' : single ? "'" : open === '“' || open === '”' ? '“”"' : "‘’'";
    if (single) count.single++;
    else if (open !== '"') count.smart++;
    let s = '"';
    let start = ++i;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 34 || c === 39 || c > 0x2017 ? closes.includes(src[i]) : false) {
        s += src.slice(start, i) + '"';
        i++;
        return s;
      }
      if (c === 92) {
        s += src.slice(start, i);
        const e = src[i + 1];
        if (e === undefined) {
          start = ++i;
          break;
        }
        if ('"\\/bfnrt'.includes(e)) {
          s += '\\' + e;
          i += 2;
        } else if (e === 'u' && HEX4.test(src.slice(i + 2, i + 6))) {
          s += src.slice(i, i + 6);
          i += 6;
        } else {
          if (!(single && e === "'")) count.escape++;
          if (e === 'x' && HEX2.test(src.slice(i + 2, i + 4))) {
            s += '\\u00' + src.slice(i + 2, i + 4);
            i += 4;
          } else if (e === '\n' || e === '\u2028' || e === '\u2029') i += 2;
          else if (e === '\r') i += src[i + 2] === '\n' ? 3 : 2;
          else {
            const ec = e.charCodeAt(0);
            // \' is a JavaScript escape; any other unknown escape keeps its backslash
            // (Windows paths, regular expressions).
            s += e === "'" ? e : ec < 32 ? escapeCode(ec) : '\\\\' + e;
            i += 2;
          }
        }
        start = i;
      } else if (c < 32) {
        s += src.slice(start, i) + escapeCode(c);
        count.control++;
        start = ++i;
      } else if (c === 34) {
        s += src.slice(start, i) + '\\"';
        start = ++i;
      } else i++;
    }
    count.unterminated++;
    return s + src.slice(start, i) + '"';
  };

  const scalar = (json: string): boolean => {
    if (!beginValue()) return false;
    out.push(json);
    return true;
  };

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      const end = src.indexOf('\n', i);
      i = end < 0 ? n : end;
      count.comment++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      count.comment++;
      continue;
    }
    if (c === '{' || c === '[') {
      if (!beginValue()) return null;
      stack.push({ obj: c === '{', state: 'open', seen: false });
      out.push(c);
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      if (!close(c === '}')) return null;
      i++;
      continue;
    }
    if (c === ',') {
      const t = top();
      if (t) {
        if (t.state === 'after') t.state = 'open';
        else if (t.state === 'open') count.extraComma++;
        else return null;
      }
      i++;
      continue;
    }
    if (c === ':') {
      const t = top();
      if (!t || t.state !== 'colon') return null;
      out.push(':');
      t.state = 'value';
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '“' || c === '”' || c === '‘' || c === '’') {
      const json = readString();
      if (atKey()) emitKey(json);
      else if (!scalar(json)) return null;
      continue;
    }
    const numeric = (c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.';
    SPECIAL_NUMBER.lastIndex = i;
    const special = (c === '-' || c === '+') && !atKey() ? SPECIAL_NUMBER.exec(src) : null;
    if (special) {
      count.nan++;
      if (!scalar('null')) return null;
      i += special[0].length;
      continue;
    }
    NUMBER.lastIndex = i;
    const number = numeric ? NUMBER.exec(src) : null;
    if (number) {
      const raw = number[0];
      i += raw.length;
      if (atKey()) {
        count.key++;
        emitKey(JSON.stringify(raw));
        continue;
      }
      const sign = raw[0] === '-' ? '-' : '';
      const body = raw.replace(/^[+-]/, '');
      let json = raw;
      if (STRICT_NUMBER.test(raw)) {
        // Already valid: keep the exact token.
      } else if (/^0x/i.test(body)) {
        json = sign + BigInt(body).toString();
        count.hex++;
      } else {
        const [, int, frac, exp] = /^(\d*)(?:\.(\d*))?(.*)$/.exec(body)!;
        json = sign + (int.replace(/^0+(?=\d)/, '') || '0') + (frac ? '.' + frac : '') + exp;
        if (json !== raw) count.number++;
      }
      if (!scalar(json)) return null;
      continue;
    }
    IDENTIFIER.lastIndex = i;
    const identifier = IDENTIFIER.exec(src);
    if (identifier) {
      const name = identifier[0];
      i += name.length;
      if (atKey()) {
        count.key++;
        emitKey(JSON.stringify(name));
        continue;
      }
      let json: string;
      if (name === 'true' || name === 'false' || name === 'null') json = name;
      else if (name === 'True' || name === 'False' || name === 'None') {
        json = name === 'None' ? 'null' : name.toLowerCase();
        count.python++;
      } else if (name === 'NaN' || name === 'Infinity' || name === 'undefined') {
        json = 'null';
        count.nan++;
      } else return null;
      if (!scalar(json)) return null;
      continue;
    }
    if (OTHER_SPACE.test(c)) {
      i++;
      count.whitespace++;
      continue;
    }
    return null;
  }

  while (stack.length) {
    if (!close(top()!.obj)) return null;
    count.closed++;
  }
  if (!values) return null;
  let strict = out.join('');
  if (values > 1) {
    strict = '[' + strict + ']';
    count.wrap = values;
  }
  const output = serialize(parseTree(strict), 2);
  const fixes = ORDER.filter((k) => count[k]).map((k) => MESSAGES[k](count[k]));
  return { output, fixes: fixes.length ? fixes : ['Fixed JSON syntax'] };
}
