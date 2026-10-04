/** Finds the first syntax error in invalid JSON with a plain-language message (browser-independent). */
export interface SyntaxProblem {
  offset: number;
  line: number;
  column: number;
  message: string;
}
export function locateError(source: string): SyntaxProblem {
  let i = 0;
  const fail = (message: string): never => {
    throw { offset: i, message };
  };
  const describe = () =>
    i >= source.length
      ? 'the document ended'
      : `found “${/[\x21-\x7e]/.test(source[i]) ? source[i] : `U+${source.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`}”`;
  const space = () => {
    while (i < source.length && ' \t\n\r'.includes(source[i])) i++;
  };
  const string = () => {
    i++;
    while (i < source.length) {
      const c = source[i];
      if (c === '"') return void i++;
      if (c === '\\') {
        const next = source[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i + 2, i + 6)))
            fail('A \\u escape needs four hex digits.');
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) i += 2;
        else fail('Invalid escape in a string. Use \\\\ for a backslash.');
      } else if (c < ' ') fail('Strings can’t contain raw line breaks or tabs. Use \\n or \\t.');
      else i++;
    }
    fail('A string is missing its closing double quote.');
  };
  const value = (depth: number): void => {
    space();
    const c = source[i];
    if (depth > 1000) fail('Nesting is deeper than 1,000 levels.');
    if (c === '{') {
      i++;
      space();
      if (source[i] === '}') return void i++;
      for (;;) {
        space();
        if (source[i] !== '"')
          fail(
            source[i] === "'"
              ? 'Property names need double quotes, not single quotes.'
              : source[i] === '}'
                ? 'Remove the trailing comma before }.'
                : `Expected a property name in double quotes, but ${describe()}.`,
          );
        string();
        space();
        if (source[i] !== ':') fail(`Expected ':' after the property name, but ${describe()}.`);
        i++;
        value(depth + 1);
        space();
        if (source[i] === ',') {
          i++;
          continue;
        }
        if (source[i] === '}') return void i++;
        fail(`Expected ',' or '}' after a property value, but ${describe()}.`);
      }
    }
    if (c === '[') {
      i++;
      space();
      if (source[i] === ']') return void i++;
      for (;;) {
        space();
        if (source[i] === ']') fail('Remove the trailing comma before ].');
        value(depth + 1);
        space();
        if (source[i] === ',') {
          i++;
          continue;
        }
        if (source[i] === ']') return void i++;
        fail(`Expected ',' or ']' after an array item, but ${describe()}.`);
      }
    }
    if (c === '"') return string();
    if (c === "'") fail('Strings need double quotes, not single quotes.');
    const literal = /^(true|false|null)/.exec(source.slice(i, i + 5));
    if (literal) return void (i += literal[0].length);
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(source.slice(i, i + 400));
    if (number && number[0] !== '-') {
      i += number[0].length;
      if (/[\d.eE]/.test(source[i] || '')) fail('This number isn’t valid JSON.');
      return;
    }
    if (c === '/' || c === '#') fail('JSON doesn’t allow comments.');
    if (/^(True|False|None|NaN|-?Infinity|undefined)\b/.test(source.slice(i, i + 10)))
      fail('Use true, false, or null. NaN, Infinity, and undefined aren’t JSON.');
    fail(
      i >= source.length
        ? 'The document ended before a value.'
        : `Expected a value, but ${describe()}.`,
    );
  };
  try {
    value(0);
    space();
    if (i < source.length) fail('Unexpected text after the end of the JSON value.');
    i = source.length;
    fail('The document isn’t valid JSON.');
  } catch (problem) {
    const { offset = i, message = 'The document isn’t valid JSON.' } =
      typeof problem === 'object' && problem && 'offset' in problem
        ? (problem as { offset: number; message: string })
        : {};
    const before = source.slice(0, offset);
    const line = before.split('\n').length - 1;
    return { offset, line, column: offset - before.lastIndexOf('\n'), message };
  }
  return { offset: 0, line: 0, column: 1, message: 'Invalid JSON.' };
}
