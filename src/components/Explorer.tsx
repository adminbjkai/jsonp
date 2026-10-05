import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Braces,
  Brackets,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileJson,
  Hash,
  List,
  ListTree,
  Minus,
  Quote,
  ToggleLeft,
} from 'lucide-react';
import { isContainer, type Entry, jsonPath, jsPath, pointer, type ValueType } from '../lib/json';
import { isColorValue } from '../lib/colors';
import { childPreview, highlightRanges } from '../lib/treeview';
import { save, saved } from '../state/prefs';
import type { SearchState } from '../state/useSearch';

interface Props {
  entries: Entry[];
  active: string | null;
  select: (path: string) => void;
  copy: (text: string, label?: string) => void;
  /** The document text, for copying a value exactly as written. */
  source: string;
  /** The search shared with the find bar; while it has results they replace the tree. */
  search: SearchState;
}

/** Tree rows are one line; search results and Show paths add the path underneath. */
const ROW_TREE = 30;
const ROW_FLAT = 50;
const INDENT = 16;
const MAX_DEPTH = 14;
const TYPE_ICON: Record<ValueType, typeof Braces> = {
  object: Braces,
  array: Brackets,
  string: Quote,
  number: Hash,
  boolean: ToggleLeft,
  null: Minus,
};
type PathFormat = 'jsonpath' | 'pointer' | 'js';
const PATH_LABEL: Record<PathFormat, string> = {
  jsonpath: 'JSONPath',
  pointer: 'JSON Pointer',
  js: 'JavaScript path',
};
const displayPath = (entry: Entry, format: PathFormat) =>
  format === 'jsonpath'
    ? jsonPath(entry.parts)
    : format === 'pointer'
      ? entry.path
      : jsPath(entry.parts);
const keyOf = (entry: Entry) => {
  const key = entry.parts.at(-1);
  return key === undefined ? 'document' : key === '' ? '""' : String(key);
};

/** Text with the search's matches marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query);
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let from = 0;
  ranges.forEach(([start, end], index) => {
    parts.push(<Fragment key={`t${index}`}>{text.slice(from, start)}</Fragment>);
    parts.push(<mark key={`m${index}`}>{text.slice(start, end)}</mark>);
    from = end;
  });
  parts.push(<Fragment key="rest">{text.slice(from)}</Fragment>);
  return <>{parts}</>;
}

/**
 * The document as an accessible tree (WAI-ARIA tree pattern): one tab stop, arrow keys to move,
 * ←/→ to collapse, expand, or step to the parent, Home/End, `*` to expand a branch, and type-ahead.
 * Rows are virtualized, so only the visible ones exist in the page.
 */
export default function Explorer({ entries, active, select, copy, source, search }: Props) {
  const baseId = useId();
  const [pathFormat, setPathFormat] = useState<PathFormat>('jsonpath');
  const [tree, setTree] = useState(true);
  const [showPaths, setShowPaths] = useState(
    () => saved<boolean>('jsonp.showPaths', false) === true,
  );
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const viewport = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const nested = tree && !search.results;
  const inline = !nested || showPaths;
  const rowHeight = inline ? ROW_FLAT : ROW_TREE;
  const matchText = search.results && !search.query.trim().startsWith('$') ? search.query : '';
  const selected = useMemo(
    () => entries.findLast((entry) => entry.path === active),
    [entries, active],
  );
  const visible = useMemo(() => {
    if (search.results) return search.results;
    let hiddenDepth = Infinity;
    return entries.filter((entry) => {
      if (!tree) return true;
      if (entry.parts.length > hiddenDepth) return false;
      hiddenDepth = collapsed.has(entry.path) ? entry.parts.length : Infinity;
      return true;
    });
  }, [entries, search.results, tree, collapsed]);
  const activeIndex = visible.findLastIndex((entry) => entry.path === active);

  useEffect(() => {
    setScrollTop(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [search.query, tree]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  // Keep the selected row in view, centred when it has to scroll.
  useEffect(() => {
    const el = viewport.current;
    if (el && activeIndex >= 0) {
      const top = activeIndex * rowHeight;
      if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight)
        el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    }
  }, [active, visible, height, activeIndex, rowHeight]);
  // Selecting a value from elsewhere opens the branches above it.
  useEffect(() => {
    if (!selected) return;
    setCollapsed((prev) => {
      const parents = selected.parts.map((_, index) => pointer(selected.parts.slice(0, index)));
      if (!parents.some((path) => prev.has(path))) return prev;
      const next = new Set(prev);
      parents.forEach((path) => next.delete(path));
      return next;
    });
  }, [selected]);

  const toggle = (path: string, open?: boolean) =>
    setCollapsed((prev) => {
      const isOpen = !prev.has(path);
      if (open === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(path);
      else next.delete(path);
      return next;
    });
  /** Opens a branch and everything below it. */
  const expandBelow = (entry: Entry) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const other of entries)
        if (other.path === entry.path || other.path.startsWith(`${entry.path}/`))
          next.delete(other.path);
      return next;
    });
  const move = (index: number) => {
    const entry = visible[Math.max(0, Math.min(visible.length - 1, index))];
    if (entry) select(entry.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'c' && selected) {
      event.preventDefault();
      return copy(displayPath(selected, pathFormat), 'Path copied');
    }
    if (mod) return;
    const fold = nested && selected && isContainer(selected) ? selected : null;
    switch (event.key) {
      case 'ArrowDown':
        move(activeIndex + 1);
        break;
      case 'ArrowUp':
        move(activeIndex < 0 ? visible.length - 1 : activeIndex - 1);
        break;
      case 'PageDown':
        move(activeIndex + Math.floor(height / rowHeight));
        break;
      case 'PageUp':
        move(activeIndex - Math.floor(height / rowHeight));
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(visible.length - 1);
        break;
      case 'ArrowRight':
        if (!fold) return;
        if (collapsed.has(fold.path)) toggle(fold.path, true);
        else move(activeIndex + 1);
        break;
      case 'ArrowLeft':
        if (!selected) return;
        if (fold && !collapsed.has(fold.path)) toggle(fold.path, false);
        else if (nested && selected.parent !== null) select(selected.parent);
        break;
      case 'Enter':
      case ' ':
        if (!fold) return;
        toggle(fold.path);
        break;
      case '*':
        if (!fold) return;
        expandBelow(fold);
        break;
      default: {
        // Type-ahead: jump to the next row whose key starts with what was typed.
        if (event.key.length !== 1) return;
        const now = Date.now();
        const state = typed.current;
        state.text = (now - state.at > 700 ? '' : state.text) + event.key.toLowerCase();
        state.at = now;
        const from = activeIndex + (state.text.length === 1 ? 1 : 0);
        for (let step = 0; step < visible.length; step++) {
          const index = (from + step) % visible.length;
          if (keyOf(visible[index]).toLowerCase().startsWith(state.text)) {
            move(index);
            break;
          }
        }
      }
    }
    event.preventDefault();
  };

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 6);
  const end = Math.min(visible.length, Math.ceil((scrollTop + height) / rowHeight) + 6);
  const rowId = (index: number) => `${baseId}-${index}`;

  return (
    <>
      <div className="pane-toolbar explorer-toolbar">
        <span className="toolbar-spacer" />
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
      </div>
      <div className="explorer-meta">
        <span>
          {search.results
            ? `Showing ${visible.length.toLocaleString()} results`
            : `${visible.length.toLocaleString()} visible`}
        </span>
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
          <span>Paths</span>
          <select
            aria-label="Path display format"
            value={pathFormat}
            onChange={(event) => setPathFormat(event.target.value as PathFormat)}
          >
            {(Object.keys(PATH_LABEL) as PathFormat[]).map((format) => (
              <option key={format} value={format}>
                {PATH_LABEL[format].replace(' path', '')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="explorer-scroll"
        // A tree must contain items, so the role only exists while there are rows to show. The
        // region stays focusable either way so a short pane can still be scrolled with the keyboard.
        tabIndex={0}
        {...(visible.length
          ? {
              role: 'tree',
              'aria-label': 'JSON values',
              'aria-activedescendant':
                activeIndex >= start && activeIndex < end ? rowId(activeIndex) : undefined,
              onKeyDown,
            }
          : {})}
        ref={viewport}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {visible.length ? (
          <div style={{ height: visible.length * rowHeight, position: 'relative' }}>
            {visible.slice(start, end).map((entry, offset) => {
              const index = start + offset;
              const depth = nested ? Math.min(entry.parts.length, MAX_DEPTH) : 0;
              const container = isContainer(entry);
              const open = container && !collapsed.has(entry.path);
              const Icon = TYPE_ICON[entry.type];
              const name = nested ? keyOf(entry) : entry.path || 'document';
              const path = displayPath(entry, pathFormat);
              const numeric = typeof entry.parts.at(-1) === 'number';
              return (
                <div
                  key={`${entry.path}-${index}`}
                  id={rowId(index)}
                  role="treeitem"
                  aria-level={nested ? entry.parts.length + 1 : 1}
                  aria-expanded={nested && container ? open : undefined}
                  aria-selected={entry.path === active}
                  aria-label={`${nested ? (entry.parts.at(-1) === '' ? '""' : (entry.parts.at(-1) ?? 'document')) : entry.path || 'document'} ${entry.value}`}
                  className={`path-row tree-row ${entry.path === active ? 'selected' : ''}`}
                  style={{
                    position: 'absolute',
                    top: index * rowHeight,
                    height: rowHeight,
                    paddingLeft: 8 + depth * INDENT,
                    ['--depth' as string]: depth,
                  }}
                  title={entry.path || 'Root (empty pointer)'}
                  onClick={() => {
                    select(entry.path);
                    viewport.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={() =>
                    container && nested
                      ? toggle(entry.path)
                      : copy(path, `${PATH_LABEL[pathFormat]} copied`)
                  }
                >
                  {container && nested ? (
                    <button
                      className="tree-toggle"
                      tabIndex={-1}
                      aria-hidden="true"
                      data-open={open}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(entry.path);
                      }}
                    >
                      <ChevronRight size={14} />
                    </button>
                  ) : (
                    nested && <span className="tree-toggle" aria-hidden="true" />
                  )}
                  <span className="tree-badge" data-type={entry.type} aria-hidden="true">
                    <Icon size={12} />
                  </span>
                  <span className="tree-main">
                    <span className="tree-line">
                      <span className={`tree-key ${numeric && nested ? 'tree-index' : ''}`}>
                        {numeric && nested ? `[${name}]` : <Marked text={name} query={matchText} />}
                      </span>
                      {container ? (
                        <span className="tree-summary">
                          {entry.type === 'object'
                            ? `${entry.count} ${entry.count === 1 ? 'key' : 'keys'}`
                            : `${entry.count} ${entry.count === 1 ? 'item' : 'items'}`}
                          {!open && entry.count > 0 && nested && (
                            <span className="tree-preview">
                              {entry.type === 'object' ? ' { ' : ' [ '}
                              {childPreview(entries, entry)}
                              {entry.type === 'object' ? ' }' : ' ]'}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className={`tree-value value-${entry.type}`}>
                          {entry.type === 'string' && isColorValue(entry.value) && (
                            <span className="tree-swatch" style={{ background: entry.value }} />
                          )}
                          {entry.type === 'string' ? '“' : ''}
                          <Marked text={entry.value} query={matchText} />
                          {entry.type === 'string' ? '”' : ''}
                        </span>
                      )}
                    </span>
                    {inline && (
                      <code className="inline-path" title={path}>
                        <Marked text={path || '(empty string)'} query={matchText} />
                      </code>
                    )}
                  </span>
                  <span className="tree-actions">
                    <button
                      className="row-copy"
                      tabIndex={-1}
                      aria-label={`Copy ${pathFormat} ${entry.path || 'root'}`}
                      title={`Copy ${PATH_LABEL[pathFormat]}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        copy(path, `${PATH_LABEL[pathFormat]} copied`);
                      }}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      className="row-copy"
                      tabIndex={-1}
                      aria-label={`Copy value of ${entry.path || 'root'}`}
                      title="Copy value"
                      onClick={(event) => {
                        event.stopPropagation();
                        copy(source.slice(entry.start, entry.end), 'Value copied');
                      }}
                    >
                      <FileJson size={13} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <ListTree size={28} />
            <strong>{search.query ? 'No matching values' : 'Explore every detail'}</strong>
            <p>
              {search.query
                ? 'Try another key, value, or path fragment.'
                : 'Keys, values, and paths appear here when your JSON is valid.'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
