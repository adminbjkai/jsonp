import { forwardRef, useEffect, useMemo, useRef, useState, type ReactEventHandler } from 'react';
const LINE = 22;
interface Props {
  value: string;
  wrap: boolean;
  errorLine?: number;
  onChange: (value: string) => void;
  onCursor: ReactEventHandler<HTMLTextAreaElement>;
  id?: string;
  label?: string;
  placeholder?: string;
}
/** Plain textarea with a line-number gutter, error-line marker, and Tab indentation. */
const SourceEditor = forwardRef<HTMLTextAreaElement, Props>(function SourceEditor(
  { value, wrap, errorLine, onChange, onCursor, id, label, placeholder },
  ref,
) {
  const lines = useMemo(() => {
    let count = 1;
    for (let i = value.indexOf('\n'); i !== -1; i = value.indexOf('\n', i + 1)) count++;
    return count;
  }, [value]);
  const gutter = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    if (!gutter.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(gutter.current);
    return () => observer.disconnect();
  }, []);
  const start = Math.max(0, Math.floor((scroll - 16) / LINE) - 4);
  const end = Math.min(lines, Math.ceil((scroll + height) / LINE) + 4);
  const numbers = [];
  for (let i = start; i < end; i++)
    numbers.push(
      <span
        key={i}
        className={i === errorLine ? 'error-line' : undefined}
        style={{ top: 16 + i * LINE - scroll }}
      >
        {i + 1}
      </span>,
    );
  return (
    <div className={`source-frame ${wrap ? 'wrapped' : ''}`}>
      {!wrap && (
        <div className="source-gutter" ref={gutter} aria-hidden="true">
          {numbers}
        </div>
      )}
      <textarea
        ref={ref}
        id={id ?? 'input-textarea'}
        className="source-editor"
        aria-label={label ?? 'JSON source'}
        aria-invalid={errorLine !== undefined || undefined}
        placeholder={
          placeholder ??
          'Paste JSON here, or drop a file.\n\nBroken JSON? Comments, trailing commas, and single quotes can be repaired in one click.\n\nEverything stays on your device.'
        }
        value={value}
        wrap={wrap ? 'soft' : 'off'}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
        onSelect={onCursor}
        onClick={onCursor}
        onKeyUp={onCursor}
        onKeyDown={(event) => {
          // Tab indents (Shift+Tab outdents) the current line(s); Escape then Tab leaves the editor.
          const el = event.currentTarget;
          if (event.key === 'Escape') return void (el.dataset.escaped = '1');
          const escaped = el.dataset.escaped;
          delete el.dataset.escaped;
          if (event.key !== 'Tab' || escaped || event.altKey || event.ctrlKey || event.metaKey)
            return;
          event.preventDefault();
          const { selectionStart: from, selectionEnd: to } = el;
          const lineStart = value.lastIndexOf('\n', from - 1) + 1;
          if (!event.shiftKey && from === to) {
            el.setRangeText('  ', from, to, 'end');
          } else {
            const block = value.slice(lineStart, to);
            const next = event.shiftKey
              ? block.replace(/^ {1,2}/gm, '')
              : block.replace(/^/gm, '  ');
            el.setRangeText(next, lineStart, to, 'select');
          }
          onChange(el.value);
        }}
      />
    </div>
  );
});
export default SourceEditor;
