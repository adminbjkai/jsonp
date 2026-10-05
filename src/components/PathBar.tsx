import { ChevronRight, Copy, CornerUpLeft } from 'lucide-react';
import { jsonPath, pointer, type Entry } from '../lib/json';
interface Props {
  entry?: Entry;
  select: (path: string) => void;
  reveal: (path: string) => void;
  copy: (value: string, label?: string) => void;
}
export default function PathBar({ entry, select, reveal, copy }: Props) {
  return (
    <div
      className={`selection-bar ${entry ? '' : 'idle'}`}
      role="region"
      aria-label="Selected value"
    >
      {entry ? (
        <>
          <nav className="path-breadcrumbs" aria-label="Selected value ancestors">
            <button onClick={() => select('')} title="Select document root">
              $
            </button>
            {entry.parts.map((part, index) => (
              <span key={index}>
                <ChevronRight size={12} />
                <button
                  title={jsonPath(entry.parts.slice(0, index + 1))}
                  onClick={() => select(pointer(entry.parts.slice(0, index + 1)))}
                >
                  {typeof part === 'number' ? `[${part}]` : part === '' ? '""' : part}
                </button>
              </span>
            ))}
          </nav>
          <button
            className="selected-path-copy"
            title={jsonPath(entry.parts)}
            aria-label="Copy current JSONPath"
            onClick={() => copy(jsonPath(entry.parts), 'JSONPath copied')}
          >
            <code>{jsonPath(entry.parts)}</code>
            <Copy size={13} />
          </button>
          <button
            className="source-jump"
            onClick={() => reveal(entry.path)}
            title="Go to selected value in source"
          >
            <CornerUpLeft size={13} />
            <span>Go to source</span>
          </button>
        </>
      ) : (
        <span className="selection-hint">
          Select a value to navigate its parents, copy its path, or jump to the source.
        </span>
      )}
    </div>
  );
}
