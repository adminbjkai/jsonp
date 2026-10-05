import { ChevronRight, Copy, CornerUpLeft } from 'lucide-react';
import Menu from './Menu';
import { jsonPath, jsPath, pointer, type Entry } from '../lib/json';

interface Props {
  entry?: Entry;
  /** The selected value as it appears in the source. */
  value: string;
  select: (path: string) => void;
  reveal: (path: string) => void;
  copy: (value: string, label?: string) => void;
}

/**
 * The selected value: its ancestors (click to step up), its exact path and value, and ways to copy
 * either. It follows whatever is selected, whether from a click or from stepping through matches.
 */
export default function PathBar({ entry, value, select, reveal, copy }: Props) {
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
          <span className={`path-value value-${entry.type}`} title={value}>
            {entry.value}
          </span>
          <button
            className="selected-path-copy"
            title={jsonPath(entry.parts)}
            aria-label="Copy current JSONPath"
            onClick={() => copy(jsonPath(entry.parts), 'JSONPath copied')}
          >
            <code>{jsonPath(entry.parts)}</code>
            <Copy size={13} />
          </button>
          <Menu
            label="Copy as"
            icon={<Copy size={14} />}
            items={[
              {
                label: 'JSONPath',
                run: () => copy(jsonPath(entry.parts), 'JSONPath copied'),
              },
              {
                label: 'JSON Pointer',
                run: () => copy(entry.path, 'JSON Pointer copied'),
              },
              {
                label: 'JavaScript path',
                run: () => copy(jsPath(entry.parts), 'JavaScript path copied'),
              },
              { label: 'Value', separator: true, run: () => copy(value, 'Value copied') },
              {
                label: 'Path and value',
                run: () => copy(`${jsonPath(entry.parts)} = ${value}`, 'Path and value copied'),
              },
            ]}
          />
          <button
            className="source-jump"
            aria-label="Go to source"
            onClick={() => reveal(entry.path)}
            title="Go to selected value in source"
          >
            <CornerUpLeft size={13} />
            <span>Go to source</span>
          </button>
        </>
      ) : (
        <span className="selection-hint">
          Select a value, or search above and press Enter, to see its path and copy it.
        </span>
      )}
    </div>
  );
}
