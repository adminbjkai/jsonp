import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search, Sheet, Table2 } from 'lucide-react';
import { isContainer, jsonPath, type Entry } from './json';
import { compareNumbers } from './tree';
const ROW = 34;
const MAX_COLUMNS = 60;
interface Props {
  entries: Entry[];
  active: string | null;
  select: (path: string) => void;
  onConvert: (path: string) => void;
}
/** Arrays of records as a sortable, filterable, virtualized grid. */
export default function TableView({ entries, active, select, onConvert }: Props) {
  const children = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of entries)
      if (entry.parent !== null) {
        const list = map.get(entry.parent);
        if (list) list.push(entry);
        else map.set(entry.parent, [entry]);
      }
    return map;
  }, [entries]);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  // Arrays worth tabulating: nonempty, listed with record arrays first.
  const arrays = useMemo(() => {
    const list = entries.filter((e) => e.type === 'array' && e.count > 0);
    const records = (e: Entry) => (children.get(e.path) || []).some((c) => c.type === 'object');
    return [...list.filter(records), ...list.filter((e) => !records(e))].slice(0, 500);
  }, [entries, children]);
  const [chosen, setChosen] = useState<string | null>(null);
  // Clicks inside the table select values without switching to a nested array.
  const internal = useRef<string | null>(null);
  const pick = (path: string) => {
    internal.current = path;
    select(path);
  };
  // Follow the selection: the selected array, or the nearest array containing it.
  useEffect(() => {
    if (internal.current !== null && internal.current === active) {
      internal.current = null;
      return;
    }
    let entry = active !== null ? byPath.get(active) : undefined;
    while (entry && entry.type !== 'array')
      entry = entry.parent !== null ? byPath.get(entry.parent) : undefined;
    if (entry && entry.count) setChosen(entry.path);
  }, [active, byPath]);
  const table =
    (chosen !== null && byPath.get(chosen)?.type === 'array' ? byPath.get(chosen) : undefined) ??
    arrays[0];
  const rows = useMemo(() => (table ? children.get(table.path) || [] : []), [table, children]);
  const { columns, cells, extra } = useMemo(() => {
    const columns: string[] = [];
    const seen = new Set<string>();
    const cells = new Map<string, Map<string, Entry>>();
    let records = false;
    for (const row of rows) {
      const map = new Map<string, Entry>();
      if (row.type === 'object') {
        records = true;
        for (const cell of children.get(row.path) || []) {
          const key = String(cell.parts.at(-1));
          map.set(key, cell);
          if (!seen.has(key)) {
            seen.add(key);
            columns.push(key);
          }
        }
      } else map.set('value', row);
      cells.set(row.path, map);
    }
    if (!records || rows.some((row) => row.type !== 'object')) columns.unshift('value');
    const unique = [...new Set(columns)];
    return {
      columns: unique.slice(0, MAX_COLUMNS),
      cells,
      extra: Math.max(0, unique.length - MAX_COLUMNS),
    };
  }, [rows, children]);
  const [sort, setSort] = useState<{ column: string; descending: boolean } | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => setSort(null), [table?.path]);
  const shown = useMemo(() => {
    const q = filter.toLowerCase().trim();
    let list = q
      ? rows.filter((row) =>
          [...(cells.get(row.path)?.values() || [])].some((cell) =>
            cell.value.toLowerCase().includes(q),
          ),
        )
      : rows;
    if (sort) {
      const value = (row: Entry) => cells.get(row.path)?.get(sort.column);
      list = [...list].sort((a, b) => {
        const x = value(a),
          y = value(b);
        if (!x || !y) return x ? -1 : y ? 1 : 0;
        const order =
          x.type === 'number' && y.type === 'number'
            ? compareNumbers(x.value, y.value)
            : x.value.localeCompare(y.value, undefined, { numeric: true });
        return sort.descending ? -order : order;
      });
    }
    return list;
  }, [rows, cells, filter, sort]);
  const viewport = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setScroll(0);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [table?.path, filter, sort]);
  if (!table)
    return (
      <div className="empty-state">
        <Table2 size={28} />
        <strong>No arrays to tabulate</strong>
        <p>Arrays of objects appear here as rows and columns. Select an array to show it.</p>
      </div>
    );
  const start = Math.max(0, Math.floor(scroll / ROW) - 6);
  const end = Math.min(shown.length, Math.ceil((scroll + height) / ROW) + 6);
  const template = `56px repeat(${columns.length}, minmax(120px, 1fr))`;
  return (
    <>
      <div className="pane-toolbar table-toolbar">
        <select
          aria-label="Array to show"
          value={table.path}
          onChange={(event) => {
            setChosen(event.target.value);
            select(event.target.value);
          }}
        >
          {!arrays.includes(table) && <option value={table.path}>{jsonPath(table.parts)}</option>}
          {arrays.map((entry) => (
            <option key={entry.path} value={entry.path}>
              {jsonPath(entry.parts)} ({entry.count})
            </option>
          ))}
        </select>
        <label className="search table-filter">
          <Search size={14} />
          <input
            aria-label="Filter rows"
            placeholder="Filter rows…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <button
          title="Convert this array to CSV"
          aria-label="Convert this array to CSV"
          onClick={() => onConvert(table.path)}
        >
          <Sheet size={15} />
        </button>
      </div>
      <div
        className="table-scroll"
        ref={viewport}
        role="region"
        aria-label="Table"
        tabIndex={0}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      >
        <div
          role="table"
          aria-label={`${jsonPath(table.parts)} as a table`}
          aria-rowcount={shown.length + 1}
          style={{ minWidth: 56 + columns.length * 120 }}
        >
          <div
            role="row"
            className="table-row table-head"
            style={{ gridTemplateColumns: template }}
          >
            <span role="columnheader">#</span>
            {columns.map((column) => (
              <button
                role="columnheader"
                key={column}
                aria-sort={
                  sort?.column === column ? (sort.descending ? 'descending' : 'ascending') : 'none'
                }
                title={`Sort by ${column}`}
                onClick={() =>
                  setSort((prev) =>
                    prev?.column !== column
                      ? { column, descending: false }
                      : prev.descending
                        ? null
                        : { column, descending: true },
                  )
                }
              >
                <span>{column}</span>
                {sort?.column === column &&
                  (sort.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
              </button>
            ))}
          </div>
          <div style={{ height: shown.length * ROW, position: 'relative' }} role="rowgroup">
            {shown.slice(start, end).map((row, i) => (
              <div
                role="row"
                key={row.path}
                className={`table-row ${active === row.path ? 'selected' : ''}`}
                style={{ gridTemplateColumns: template, top: (start + i) * ROW, height: ROW }}
              >
                <button role="rowheader" className="row-index" onClick={() => pick(row.path)}>
                  {String(row.parts.at(-1))}
                </button>
                {columns.map((column) => {
                  const cell = cells.get(row.path)?.get(column);
                  return cell ? (
                    <button
                      role="cell"
                      key={column}
                      className={`value-${cell.type} ${active === cell.path ? 'selected' : ''}`}
                      title={cell.value}
                      onClick={() => pick(cell.path)}
                    >
                      {cell.value}
                    </button>
                  ) : (
                    <span role="cell" key={column} className="table-missing" aria-label="missing">
                      –
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="pane-footnote">
        {shown.length.toLocaleString()} of {rows.length.toLocaleString()} rows · {columns.length}{' '}
        columns
        {extra ? ` (+${extra} hidden)` : ''}
        <span>Click a heading to sort</span>
      </div>
    </>
  );
}
