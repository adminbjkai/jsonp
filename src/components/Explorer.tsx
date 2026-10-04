import { useMemo, useState, useRef, useEffect, useDeferredValue } from 'react';
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
  ArrowUp,
  ArrowDown,
  Crosshair,
  CornerUpLeft,
  Braces,
  X,
} from 'lucide-react';
import { isContainer, type Entry, jsonPath, jsPath, pointer } from '../lib/json';
import { isQuery } from '../lib/query';
import type { QueryReply } from '../workers/query.worker';
import { save, saved } from '../state/prefs';
interface Props {
  entries: Entry[];
  active: string | null;
  section: 'key' | 'value';
  select: (path: string) => void;
  copy: (text: string, label?: string) => void;
  reveal: (path: string) => void;
  value: string;
  query: string;
  setQuery: (query: string) => void;
  source: string;
  /** Reports the paths matched by the current search or query (null when not searching). */
  onMatches?: (paths: ReadonlySet<string> | null) => void;
}
/** Tree rows are one line; search results add the path underneath. */
const ROW_TREE = 30;
const ROW_FLAT = 48;
type PathFormat = 'jsonpath' | 'pointer' | 'js';
const displayPath = (entry: Entry, format: PathFormat) =>
  format === 'jsonpath'
    ? jsonPath(entry.parts)
    : format === 'pointer'
      ? entry.path
      : jsPath(entry.parts);
export default function Explorer({
  entries,
  active,
  section,
  select,
  copy,
  reveal,
  value,
  query,
  setQuery,
  source,
  onMatches,
}: Props) {
  const deferredQuery = useDeferredValue(query);
  const queryMode = isQuery(deferredQuery);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  // A search that starts with $ runs as a JSONPath query in a worker, stopped if it runs long.
  const [reply, setReply] = useState<(QueryReply & { expression: string }) | null>(null);
  const expression = deferredQuery.trim();
  useEffect(() => {
    if (!queryMode || !entries.length) return setReply(null);
    let worker: Worker | undefined;
    const finish = (result: QueryReply) => {
      clearTimeout(limit);
      worker?.terminate();
      setReply({ ...result, expression });
    };
    const start = setTimeout(() => {
      worker = new Worker(new URL('../workers/query.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<QueryReply>) => finish(event.data);
      worker.onerror = () => finish({ error: 'The query could not run.', paths: [], json: '' });
      worker.postMessage({ source, expression });
    }, 120);
    const limit = setTimeout(
      () =>
        finish({
          error: 'The query took too long and was stopped. Simplify the filter or pattern.',
          paths: [],
          json: '',
        }),
      5000,
    );
    return () => {
      clearTimeout(start);
      clearTimeout(limit);
      worker?.terminate();
    };
  }, [queryMode, expression, source, entries]);
  const queried = queryMode ? reply : null;
  const queryPending = queryMode && reply?.expression !== expression;
  const [pathFormat, setPathFormat] = useState<PathFormat>('jsonpath');
  const [tree, setTree] = useState(true);
  const nested = tree && !query;
  // Search results always show each path; the tree can too, at the cost of taller rows.
  const [showPaths, setShowPaths] = useState(
    () => saved<boolean>('jsonp.showPaths', false) === true,
  );
  const inline = !nested || showPaths;
  const ROW_HEIGHT = inline ? ROW_FLAT : ROW_TREE;
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [details, setDetails] = useState(() => window.matchMedia('(min-width: 801px)').matches);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const viewport = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => entries.findLast((entry) => entry.path === active),
    [entries, active],
  );
  const visible = useMemo(() => {
    if (queryMode)
      return (queried?.paths ?? [])
        .map((path) => byPath.get(path))
        .filter((entry) => entry !== undefined);
    const q = deferredQuery.toLowerCase().trim();
    let hiddenDepth = Infinity;
    return entries.filter((entry) => {
      if (q)
        return `${entry.path} ${jsonPath(entry.parts)} ${entry.value} ${entry.type}`
          .toLowerCase()
          .includes(q);
      if (!tree) return true;
      if (entry.parts.length > hiddenDepth) return false;
      hiddenDepth = collapsed.has(entry.path) ? entry.parts.length : Infinity;
      return true;
    });
  }, [entries, deferredQuery, tree, collapsed, queryMode, queried, byPath]);
  const searching = deferredQuery.trim() !== '';
  useEffect(() => {
    onMatches?.(searching ? new Set(visible.map((entry) => entry.path)) : null);
  }, [searching, visible, onMatches]);
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
  }, [active, visible, height]);
  const openParents = () => {
    if (!selected) return;
    setCollapsed((prev) => {
      const parents = selected.parts.map((_, index) => pointer(selected.parts.slice(0, index)));
      if (!parents.some((path) => prev.has(path))) return prev;
      const next = new Set(prev);
      parents.forEach((path) => next.delete(path));
      return next;
    });
  };
  useEffect(openParents, [selected]);
  const activeIndex = visible.findLastIndex((entry) => entry.path === active);
  const move = (index: number) => {
    const entry = visible[index];
    if (entry) {
      select(entry.path);
      viewport.current?.focus({ preventScroll: true });
    }
  };
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6);
  const end = Math.min(visible.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 6);
  return (
    <>
      <div className="pane-toolbar explorer-toolbar">
        <label className="search">
          <Search size={14} />
          <input
            id="explorer-search"
            aria-label="Search paths and values"
            placeholder="Find a key or value, or type $ to query…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {query && (
          <button aria-label="Clear path search" title="Clear search" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
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
      <div className="explorer-meta">
        <span className={queried?.error ? 'query-error' : undefined} role="status">
          {deferredQuery !== query
            ? 'Searching…'
            : queryPending
              ? 'Running query…'
              : queried?.error
                ? queried.error
                : `${visible.length.toLocaleString()} ${queried ? 'query results' : query ? 'matches' : 'visible'}`}
        </span>
        {queried && !queryPending && !queried.error && queried.paths.length > 0 && (
          <button
            aria-label="Copy query results as JSON"
            title="Copy results as a JSON array"
            onClick={() => copy(queried.json, 'Query results copied')}
          >
            <Braces size={12} /> Copy
          </button>
        )}
        {nested && (
          <button
            aria-pressed={showPaths}
            title="Show each value's path under its name"
            onClick={() => {
              setShowPaths(!showPaths);
              save('jsonp.showPaths', !showPaths);
            }}
          >
            Show paths
          </button>
        )}
        <label>
          Paths
          <select
            aria-label="Path display format"
            value={pathFormat}
            onChange={(event) => setPathFormat(event.target.value as PathFormat)}
          >
            <option value="jsonpath">JSONPath</option>
            <option value="pointer">JSON Pointer</option>
            <option value="js">JavaScript</option>
          </select>
        </label>
      </div>
      <div
        className="explorer-scroll"
        role="region"
        aria-label="Path navigation"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.shiftKey &&
            event.key.toLowerCase() === 'c' &&
            selected
          ) {
            event.preventDefault();
            copy(displayPath(selected, pathFormat), 'Path copied');
            return;
          }
          const next =
            event.key === 'ArrowDown'
              ? Math.min(visible.length - 1, activeIndex + 1)
              : event.key === 'ArrowUp'
                ? Math.max(0, activeIndex < 0 ? visible.length - 1 : activeIndex - 1)
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? visible.length - 1
                    : null;
          if (next !== null && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            move(next);
          }
        }}
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
                  paddingLeft: 10 + (nested ? Math.min(entry.parts.length, 12) * 14 : 0),
                }}
              >
                {isContainer(entry) && nested ? (
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
                  onDoubleClick={() => copy(displayPath(entry, pathFormat), 'Path copied')}
                  aria-label={`${nested ? (entry.parts.at(-1) ?? 'document') : entry.path || 'document'} ${entry.value}`}
                  title={entry.path || 'Root (empty pointer)'}
                >
                  <span className="path-row-content">
                    <span className="path-row-main">
                      <span>
                        {nested
                          ? entry.parts.at(-1) === ''
                            ? '\"\"'
                            : (entry.parts.at(-1) ?? 'document')
                          : entry.path || 'document'}
                      </span>
                      <small className={`value-${entry.type}`}>{entry.value}</small>
                    </span>
                    {inline && (
                      <code className="inline-path" title={displayPath(entry, pathFormat)}>
                        {displayPath(entry, pathFormat) || '(empty string)'}
                      </code>
                    )}
                  </span>
                </button>
                <button
                  className="row-copy"
                  aria-label={`Copy ${pathFormat} ${entry.path || 'root'}`}
                  title={`Copy ${pathFormat === 'jsonpath' ? 'JSONPath' : pathFormat === 'pointer' ? 'JSON Pointer' : 'JavaScript path'}`}
                  onClick={() => copy(displayPath(entry, pathFormat), 'Path copied')}
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
            <span>Selected value</span>
            <div className="path-step-controls">
              {selected && <b>{selected.type}</b>}
              <button
                aria-label="Previous value"
                title="Previous value (↑)"
                disabled={activeIndex <= 0}
                onClick={() => move(activeIndex - 1)}
              >
                <ArrowUp size={13} />
              </button>
              <button
                aria-label="Next value"
                title="Next value (↓)"
                disabled={!visible.length || activeIndex >= visible.length - 1}
                onClick={() => move(activeIndex + 1)}
              >
                <ArrowDown size={13} />
              </button>
            </div>
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
            <p>Select a value to copy its references. Use ↑ / ↓ to move through results.</p>
          )}
          {selected && (
            <div className="inspector-actions">
              <button
                title="Copy selected value as JSON"
                onClick={() => copy(value, 'Value copied')}
              >
                <Copy size={13} /> Copy value
              </button>
              <button onClick={() => reveal(selected.path)}>
                <CornerUpLeft size={13} /> Source
              </button>
              {activeIndex < 0 && (
                <button
                  aria-label="Reveal selected path"
                  title="Clear search and expand parents"
                  onClick={() => {
                    setQuery('');
                    openParents();
                  }}
                >
                  <Crosshair size={13} /> Reveal
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
