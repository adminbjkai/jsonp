import { useMemo, useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  ListTree,
  List,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  SlidersHorizontal,
} from 'lucide-react';
import { isContainer, type Entry, jsonPath, jsPath } from './json';
interface Props {
  entries: Entry[];
  active: string | null;
  section: 'key' | 'value';
  select: (path: string) => void;
  copy: (text: string, label?: string) => void;
}
const ROW_HEIGHT = 38;
export default function Explorer({ entries, active, section, select, copy }: Props) {
  const [query, setQuery] = useState('');
  const [tree, setTree] = useState(true);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [details, setDetails] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const viewport = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => entries.findLast((entry) => entry.path === active),
    [entries, active],
  );
  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    let hiddenDepth = Infinity;
    return entries.filter((entry) => {
      if (q) return `${entry.path} ${entry.value} ${entry.type}`.toLowerCase().includes(q);
      if (!tree) return true;
      if (entry.parts.length > hiddenDepth) return false;
      hiddenDepth = collapsed.has(entry.path) ? entry.parts.length : Infinity;
      return true;
    });
  }, [entries, query, tree, collapsed]);
  useEffect(() => {
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [query, tree, collapsed, entries]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const index = visible.findLastIndex((entry) => entry.path === active);
    const el = viewport.current;
    if (el && index >= 0) {
      const top = index * ROW_HEIGHT;
      if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
        el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    }
  }, [active, visible]);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6);
  const end = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 6);
  return (
    <>
      <div className="pane-toolbar explorer-toolbar">
        <label className="search">
          <Search size={14} />
          <input
            aria-label="Search paths and values"
            placeholder="Find a key or value…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          title={tree ? 'Switch to list view' : 'Switch to tree view'}
          aria-label={tree ? 'Switch to list view' : 'Switch to tree view'}
          onClick={() => setTree(!tree)}
        >
          {tree ? <List size={16} /> : <ListTree size={16} />}
        </button>
        <button
          title="Collapse all"
          aria-label="Collapse all"
          onClick={() => setCollapsed(new Set(entries.filter(isContainer).map((e) => e.path)))}
        >
          <ChevronsDownUp size={16} />
        </button>
        <button title="Expand all" aria-label="Expand all" onClick={() => setCollapsed(new Set())}>
          <ChevronsUpDown size={16} />
        </button>
        <button
          title="Toggle path details"
          aria-label="Toggle path details"
          aria-pressed={details}
          onClick={() => setDetails(!details)}
        >
          <SlidersHorizontal size={16} />
        </button>
      </div>
      <div
        className="explorer-scroll"
        ref={viewport}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {visible.length ? (
          <div
            style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}
            role="list"
            aria-label="JSON values"
          >
            {visible.slice(start, end).map((entry, index) => (
              <div
                key={`${entry.path}-${start + index}`}
                role="listitem"
                className={`path-row ${entry.path === active ? `selected ${section}-selection` : ''}`}
                style={{
                  position: 'absolute',
                  top: (start + index) * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: 10 + (tree && !query ? Math.min(entry.parts.length, 12) * 14 : 0),
                }}
              >
                {isContainer(entry) && tree && !query ? (
                  <button
                    className="tree-toggle"
                    aria-label={`${collapsed.has(entry.path) ? 'Expand' : 'Collapse'} ${entry.path || 'root'}`}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.path)) next.delete(entry.path);
                        else next.add(entry.path);
                        return next;
                      })
                    }
                  >
                    {collapsed.has(entry.path) ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </button>
                ) : (
                  <span className="type-dot" data-type={entry.type} />
                )}
                <button
                  className="path-select"
                  onClick={() => select(entry.path)}
                  onDoubleClick={() => copy(entry.path, 'Pointer copied')}
                  title={entry.path || 'Root (empty pointer)'}
                >
                  <span>
                    {tree && !query ? (entry.parts.at(-1) ?? 'document') : entry.path || 'document'}
                  </span>
                  <small className={`value-${entry.type}`}>{entry.value}</small>
                </button>
                <button
                  className="row-copy"
                  aria-label={`Copy pointer ${entry.path || 'root'}`}
                  title="Copy JSON Pointer"
                  onClick={() => copy(entry.path, 'Pointer copied')}
                >
                  <Copy size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <ListTree size={28} />
            <strong>{query ? 'No matching values' : 'Explore every detail'}</strong>
            <p>
              {query
                ? 'Try another key, value, or type.'
                : 'Keys, values, and paths appear here when your JSON is valid.'}
            </p>
          </div>
        )}
      </div>
      {details && (
        <div className="path-inspector">
          <div className="inspector-heading">
            <span>SELECTED VALUE</span>
            <b>{selected?.type ?? '—'}</b>
          </div>
          {selected ? (
            [
              ['Pointer', selected.path],
              ['JSONPath', jsonPath(selected.parts)],
              ['JavaScript', jsPath(selected.parts)],
            ].map(([label, value]) => (
              <div className="path-format" key={label}>
                <label>{label}</label>
                <code title={value}>{value === '' ? '(empty string)' : value}</code>
                <button
                  aria-label={`Copy ${label}`}
                  title={`Copy ${label}`}
                  onClick={() => copy(value, `${label} copied`)}
                >
                  <Copy size={13} />
                </button>
              </div>
            ))
          ) : (
            <p>Select a value to copy its references.</p>
          )}
        </div>
      )}
    </>
  );
}
