import { useMemo, type RefObject } from 'react';
import { BarChart3, X } from 'lucide-react';
import { jsonPath, type Entry, type ValueType } from '../lib/json';
const TYPES: ValueType[] = ['object', 'array', 'string', 'number', 'boolean', 'null'];
/** A quick profile of the document: shape, types, common keys, and the largest arrays. */
export default function Insights({
  dialogRef,
  entries,
  bytes,
  select,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  entries: Entry[];
  bytes: number;
  select: (path: string) => void;
}) {
  const stats = useMemo(() => {
    const types = Object.fromEntries(TYPES.map((t) => [t, 0])) as Record<ValueType, number>;
    const keys = new Map<string, number>();
    let depth = 0,
      longest: Entry | undefined;
    for (const entry of entries) {
      types[entry.type]++;
      depth = Math.max(depth, entry.parts.length);
      const key = entry.parts.at(-1);
      if (typeof key === 'string') keys.set(key, (keys.get(key) || 0) + 1);
      if (entry.type === 'string' && entry.value.length > (longest?.value.length ?? -1))
        longest = entry;
    }
    return {
      types,
      depth,
      longest,
      keys: [...keys].sort((a, b) => b[1] - a[1]).slice(0, 8),
      arrays: entries
        .filter((e) => e.type === 'array')
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }, [entries]);
  const go = (path: string) => {
    dialogRef.current?.close();
    select(path);
  };
  const max = Math.max(1, ...Object.values(stats.types));
  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-dialog"
      aria-labelledby="insights-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="insights-title">
          <BarChart3 size={19} /> Document insights
        </h2>
        <button aria-label="Close insights" onClick={() => dialogRef.current?.close()}>
          <X size={18} />
        </button>
      </div>
      {entries.length ? (
        <>
          <div className="insight-cards">
            <div>
              <b>{entries.length.toLocaleString()}</b>
              <span>values</span>
            </div>
            <div>
              <b>{stats.depth}</b>
              <span>levels deep</span>
            </div>
            <div>
              <b>{(bytes / 1024).toFixed(1)}</b>
              <span>KB</span>
            </div>
          </div>
          <h3>Types</h3>
          {TYPES.map((type) => (
            <div className="insight-bar" key={type}>
              <span className={`value-${type}`}>{type}</span>
              <i style={{ width: `${(stats.types[type] / max) * 100}%` }} />
              <b>{stats.types[type].toLocaleString()}</b>
            </div>
          ))}
          {stats.keys.length > 0 && (
            <>
              <h3>Most common keys</h3>
              <div className="insight-chips">
                {stats.keys.map(([key, count]) => (
                  <span key={key}>
                    {key || '""'} <b>×{count.toLocaleString()}</b>
                  </span>
                ))}
              </div>
            </>
          )}
          {stats.arrays.length > 0 && (
            <>
              <h3>Largest arrays</h3>
              {stats.arrays.map((entry) => (
                <button className="insight-link" key={entry.path} onClick={() => go(entry.path)}>
                  <code>{jsonPath(entry.parts)}</code>
                  <span>{entry.count.toLocaleString()} items</span>
                </button>
              ))}
            </>
          )}
          {stats.longest && (
            <>
              <h3>Longest string</h3>
              <button className="insight-link" onClick={() => go(stats.longest!.path)}>
                <code>{jsonPath(stats.longest.parts)}</code>
                <span>{stats.longest.value.length.toLocaleString()} characters</span>
              </button>
            </>
          )}
        </>
      ) : (
        <p>Insights appear once Source contains valid JSON.</p>
      )}
    </dialog>
  );
}
