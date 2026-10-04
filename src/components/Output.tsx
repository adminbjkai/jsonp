import { useMemo, useRef, useState, useEffect } from 'react';
import type { Entry } from '../lib/json';
const HEIGHT = 22;
/** Leading whitespace is drawn one indent level at a time so each level gets a guide line. */
function Indent({ text, unit }: { text: string; unit: string }) {
  if (!unit) return <>{text}</>;
  const levels = Math.floor(text.length / unit.length);
  return (
    <>
      {Array.from({ length: levels }, (_, level) => (
        <span className="guide" key={level}>
          {unit}
        </span>
      ))}
      {text.slice(levels * unit.length)}
    </>
  );
}
function Line({ text, unit }: { text: string; unit: string }) {
  if (text.length > 10_000) return <>{text}</>;
  const lead = text.length - text.trimStart().length;
  const tokens = text
    .slice(lead)
    .split(
      /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g,
    );
  return (
    <>
      <Indent text={text.slice(0, lead)} unit={unit} />
      {tokens.map((token, index) => (
        <span
          key={index}
          className={
            token.startsWith('"')
              ? token.endsWith(':')
                ? 'token-key'
                : 'token-string'
              : /^(true|false)$/.test(token)
                ? 'token-boolean'
                : token === 'null'
                  ? 'token-null'
                  : /^-?\d/.test(token)
                    ? 'token-number'
                    : ''
          }
        >
          {token}
        </span>
      ))}
    </>
  );
}
export default function Output({ output, selected }: { output: string; selected?: Entry }) {
  const lines = useMemo(() => output.split('\n'), [output]);
  const columns = useMemo(
    () =>
      Math.min(
        1_000_000,
        lines.reduce((max, line) => Math.max(max, line.length), 0),
      ),
    [lines],
  );
  // One indent level, taken from the first indented line (a tab, or a run of spaces).
  const unit = useMemo(() => {
    const first = lines.find((line) => /^\s/.test(line));
    return first
      ? first[0] === '\t'
        ? '\t'
        : ' '.repeat(first.length - first.trimStart().length)
      : '';
  }, [lines]);
  const [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(600);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && selected) {
      const top = selected.line * HEIGHT;
      if (top < el.scrollTop || top + HEIGHT > el.scrollTop + el.clientHeight)
        el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }, [selected]);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScroll(0);
  }, [output]);
  const start = Math.max(0, Math.floor(scroll / HEIGHT) - 6),
    end = Math.min(lines.length, Math.ceil((scroll + height) / HEIGHT) + 6);
  return (
    <div
      id="output-pre"
      className="output-scroll"
      ref={ref}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      role="region"
      aria-label="Formatted JSON"
      tabIndex={0}
    >
      <div
        className="code-lines"
        style={{ height: lines.length * HEIGHT + 32, minWidth: `calc(${columns}ch + 100px)` }}
      >
        {lines.slice(start, end).map((text, i) => (
          <div
            className={`code-line ${selected && start + i >= selected.line && start + i <= selected.endLine ? 'highlighted' : ''}`}
            key={start + i}
            style={{ top: 16 + (start + i) * HEIGHT }}
          >
            <span className="line-number" aria-hidden="true">
              {start + i + 1}
            </span>
            <code>
              <Line text={text} unit={unit} />
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
