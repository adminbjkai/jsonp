import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import ReactFlow, {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  getRectOfNodes,
  getTransformForBounds,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import {
  ArrowDownUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Download,
  GitBranch,
  Grid3x3,
  Map as MapIcon,
  Maximize,
  Minus,
  Plus,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import 'reactflow/dist/style.css';
import './styles/graph.css';
import { isContainer, type Entry } from './json';

/* ------------------------------------------------------------------ */
/* Pure layout helpers (unit tested in tests/graph.test.ts)            */
/* ------------------------------------------------------------------ */

export type GraphDirection = 'LR' | 'TB';
/** Documents with more containers than this start with deeper branches collapsed. */
export const LARGE_GRAPH = 300;
/** Hard limit of cards drawn at once. */
export const MAX_VISIBLE_CARDS = 1500;
export const CARD_WIDTH = 260;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 28;
const MAX_ROWS = 7;
const EMPTY_HEIGHT = 32;
const BORDER = 2;
const GAPS = { LR: { depth: 100, breadth: 28 }, TB: { depth: 90, breadth: 36 } } as const;

export const cardHeight = (rows: number) =>
  BORDER + HEADER_HEIGHT + (rows ? Math.min(rows, MAX_ROWS) * ROW_HEIGHT : EMPTY_HEIGHT);

export interface GraphIndex {
  byPath: Map<string, Entry>;
  /** All direct children of each container, in document order. */
  children: Map<string, Entry[]>;
  /** Direct child containers of each container. */
  kids: Map<string, Entry[]>;
  containers: Entry[];
}

export function graphIndex(entries: Entry[]): GraphIndex {
  const byPath = new Map<string, Entry>();
  const children = new Map<string, Entry[]>();
  const kids = new Map<string, Entry[]>();
  const containers: Entry[] = [];
  for (const entry of entries) {
    byPath.set(entry.path, entry);
    const container = isContainer(entry);
    if (container) containers.push(entry);
    if (entry.parent === null) continue;
    let list = children.get(entry.parent);
    if (!list) children.set(entry.parent, (list = []));
    list.push(entry);
    if (container) {
      let kidList = kids.get(entry.parent);
      if (!kidList) kids.set(entry.parent, (kidList = []));
      kidList.push(entry);
    }
  }
  return { byPath, children, kids, containers };
}

const asIndex = (source: Entry[] | GraphIndex) =>
  Array.isArray(source) ? graphIndex(source) : source;
export const inBranch = (path: string, root: string) =>
  root === '' || path === root || path.startsWith(root + '/');

/** Cards visible from `root` when the containers in `hidden` (and their subtrees) are hidden. Stops counting past `limit`. */
export function countVisible(
  source: Entry[] | GraphIndex,
  hidden: ReadonlySet<string>,
  root = '',
  limit = Infinity,
) {
  const index = asIndex(source);
  const start = index.byPath.get(root);
  if (!start || !isContainer(start)) return 0;
  let count = 0;
  const stack = [start];
  while (stack.length) {
    const entry = stack.pop()!;
    if (++count > limit) return count;
    for (const kid of index.kids.get(entry.path) ?? []) if (!hidden.has(kid.path)) stack.push(kid);
  }
  return count;
}

/**
 * Hidden containers for a first view of a large document: keeps every level down to the
 * deepest one that fits within `budget` cards and hides all deeper containers.
 */
export function initialCollapse(source: Entry[] | GraphIndex, budget = LARGE_GRAPH, root = '') {
  const index = asIndex(source);
  const hidden = new Set<string>();
  const start = index.byPath.get(root);
  if (!start || !isContainer(start)) return hidden;
  const base = start.parts.length;
  const perDepth: number[] = [];
  let total = 0;
  for (const entry of index.containers)
    if (inBranch(entry.path, root)) {
      const depth = entry.parts.length - base;
      perDepth[depth] = (perDepth[depth] ?? 0) + 1;
      total++;
    }
  if (total <= budget) return hidden;
  let depth = 0;
  let sum = perDepth[0];
  while (depth + 1 < perDepth.length && sum + perDepth[depth + 1] <= budget)
    sum += perDepth[++depth];
  for (const entry of index.containers)
    if (inBranch(entry.path, root) && entry.parts.length - base > depth) hidden.add(entry.path);
  return hidden;
}

/** The card showing `path` (itself for containers, else its parent) and every ancestor container up to the document root. */
export function cardChain(source: Entry[] | GraphIndex, path: string) {
  const index = asIndex(source);
  const chain: string[] = [];
  let entry = index.byPath.get(path);
  if (entry && !isContainer(entry))
    entry = entry.parent === null ? undefined : index.byPath.get(entry.parent);
  while (entry) {
    chain.push(entry.path);
    entry = entry.parent === null ? undefined : index.byPath.get(entry.parent);
  }
  return chain;
}

export interface CardLayout {
  entry: Entry;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}
export interface GraphLayoutOptions {
  /** Containers whose cards (and subtrees) are hidden. */
  hidden?: ReadonlySet<string>;
  direction?: GraphDirection;
  /** JSON Pointer of the branch to draw; '' for the whole document. */
  root?: string;
  /** Maximum number of cards; above it the layout is empty and `overflow` is true. */
  cap?: number;
}
export interface GraphLayout {
  cards: CardLayout[];
  positions: Map<string, CardLayout>;
  /** Cards in view (capped at cap + 1 when overflowing). */
  visible: number;
  /** Containers in the drawn branch. */
  total: number;
  overflow: boolean;
}

/** Tidy tree layout in O(visible cards): siblings occupy disjoint spans and parents centre on their children. */
export function graphLayout(
  source: Entry[] | GraphIndex,
  {
    hidden = new Set(),
    direction = 'LR',
    root = '',
    cap = MAX_VISIBLE_CARDS,
  }: GraphLayoutOptions = {},
): GraphLayout {
  const index = asIndex(source);
  const cards: CardLayout[] = [];
  const positions = new Map<string, CardLayout>();
  const start = index.byPath.get(root);
  if (!start || !isContainer(start))
    return { cards, positions, visible: 0, total: 0, overflow: false };
  const total =
    root === ''
      ? index.containers.length
      : index.containers.filter((c) => inBranch(c.path, root)).length;
  const visible = countVisible(index, hidden, root, cap);
  if (visible > cap) return { cards, positions, visible, total, overflow: true };
  const lr = direction === 'LR';
  const gap = GAPS[direction];
  const extent: number[] = [];
  let cursor = 0;
  const visit = (entry: Entry, depth: number) => {
    const height = cardHeight(index.children.get(entry.path)?.length ?? 0);
    const card: CardLayout = { entry, x: 0, y: 0, width: CARD_WIDTH, height, depth };
    cards.push(card);
    positions.set(entry.path, card);
    extent[depth] = Math.max(extent[depth] ?? 0, lr ? CARD_WIDTH : height);
    const breadth = lr ? height : CARD_WIDTH;
    const begin = cursor;
    let position = begin;
    const kids = (index.kids.get(entry.path) ?? []).filter((kid) => !hidden.has(kid.path));
    if (kids.length) {
      for (const kid of kids) visit(kid, depth + 1);
      position = Math.max(begin, (begin + cursor - gap.breadth) / 2 - breadth / 2);
    }
    cursor = Math.max(cursor, position + breadth + gap.breadth);
    if (lr) card.y = position;
    else card.x = position;
  };
  visit(start, 0);
  const offsets: number[] = [];
  for (let depth = 0, offset = 0; depth < extent.length; depth++) {
    offsets[depth] = offset;
    offset += extent[depth] + gap.depth;
  }
  for (const card of cards) {
    if (lr) card.x = offsets[card.depth];
    else card.y = offsets[card.depth];
  }
  return { cards, positions, visible, total, overflow: false };
}

/** Pixel ratio that keeps an exported canvas within common browser limits. */
export function exportPixelRatio(width: number, height: number, preferred = 2) {
  const MAX_SIDE = 16_384;
  const MAX_AREA = 16_000_000;
  return Math.max(
    0.05,
    Math.min(
      preferred,
      MAX_SIDE / width,
      MAX_SIDE / height,
      Math.sqrt(MAX_AREA / (width * height)),
    ),
  );
}

const HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const FUNCTIONAL = /^(?:rgba?|hsla?)\(\s*-?[\d.]+(?:deg|%)?(?:\s*[,\s/]\s*-?[\d.]+%?){2,3}\s*\)$/i;
export const isColorValue = (value: string) => HEX.test(value) || FUNCTIONAL.test(value);
export const isUrlValue = (value: string) => /^https?:\/\/[^\s"<>]+$/i.test(value);

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface GraphProps {
  entries: Entry[];
  active: string | null;
  select: (path: string) => void;
  /** JSON Pointers matched by the Explorer search/query; matching cards are highlighted and others dimmed. */
  matches?: ReadonlySet<string> | null;
}

interface CardActions {
  select: (path: string) => void;
  toggleCard: (path: string) => void;
  toggleRow: (parent: string, child: string) => void;
}
interface CardData {
  entry: Entry;
  rows: Entry[];
  hidden: ReadonlySet<string>;
  active: string | null;
  matches: ReadonlySet<string> | null;
  match: boolean;
  dim: boolean;
  actions: CardActions;
}

const nodeId = (path: string) => path || 'root';
const pathOf = (id: string) => (id === 'root' ? '' : id);
const describe = (path: string) => path || 'document';
const keyOf = (entry: Entry) => (entry.parts.length ? String(entry.parts.at(-1)) : 'document');
const summary = (entry: Entry) =>
  entry.type === 'array'
    ? `[${entry.count} ${entry.count === 1 ? 'item' : 'items'}]`
    : `{${entry.count} ${entry.count === 1 ? 'key' : 'keys'}}`;

function Row({ row, parent, data }: { row: Entry; parent: string; data: CardData }) {
  const { actions, hidden, active, matches } = data;
  const container = isContainer(row);
  const url = row.type === 'string' && isUrlValue(row.value);
  const shown = container && !hidden.has(row.path);
  const value = container ? summary(row) : row.value;
  return (
    <div
      className={`graph-row${active === row.path ? ' active' : ''}${matches?.has(row.path) ? ' match' : ''}`}
    >
      <button
        className="graph-row-select"
        title={`${keyOf(row)}: ${value}`}
        onClick={() => actions.select(row.path)}
      >
        <span className="graph-row-key">{keyOf(row)}</span>
        {!url && <span className={`graph-row-value value-${row.type}`}>{value}</span>}
      </button>
      {url && (
        <a
          className="graph-row-value graph-link value-string"
          href={row.value}
          target="_blank"
          rel="noopener noreferrer"
          title={row.value}
          onClick={(event) => event.stopPropagation()}
        >
          {row.value}
        </a>
      )}
      {row.type === 'string' && isColorValue(row.value) && (
        <i className="color-swatch" style={{ background: row.value }} aria-hidden="true" />
      )}
      {container && (
        <button
          className="graph-toggle"
          aria-expanded={shown}
          aria-label={`${shown ? 'Hide' : 'Show'} graph card ${describe(row.path)}`}
          title={shown ? 'Hide card' : 'Show card'}
          onClick={() => actions.toggleRow(parent, row.path)}
        >
          {shown ? <Minus size={11} /> : <Plus size={11} />}
        </button>
      )}
    </div>
  );
}

const Card = memo(({ data, sourcePosition, targetPosition }: NodeProps<CardData>) => {
  const { entry, rows, hidden, actions } = data;
  const kids = rows.filter(isContainer);
  const expanded = kids.some((kid) => !hidden.has(kid.path));
  return (
    <div
      className={`graph-card${data.active === entry.path ? ' selected' : ''}${data.match ? ' match' : ''}${data.dim ? ' dim' : ''}`}
    >
      <div className="graph-card-header">
        <button className="graph-card-title" onClick={() => actions.select(entry.path)}>
          <span aria-hidden="true">{entry.type === 'array' ? '[ ]' : '{ }'}</span>
          <strong>{keyOf(entry)}</strong>
          <small>{entry.count}</small>
        </button>
        {kids.length > 0 && (
          <button
            className="graph-toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} graph branch ${describe(entry.path)}`}
            title={expanded ? 'Collapse branch' : 'Expand branch'}
            onClick={() => actions.toggleCard(entry.path)}
          >
            {expanded ? <Minus size={12} /> : <Plus size={12} />}
          </button>
        )}
      </div>
      <div className="graph-properties nodrag nowheel">
        {rows.map((row, i) => (
          <Row key={`${row.path}-${i}`} row={row} parent={entry.path} data={data} />
        ))}
        {!rows.length && <p>Empty {entry.type}</p>}
      </div>
      <Handle type="target" position={targetPosition ?? Position.Left} isConnectable={false} />
      <Handle type="source" position={sourcePosition ?? Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { json: Card };

function readPref<T>(key: string, fallback: T, valid: (value: unknown) => boolean): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    return valid(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferences are optional in private browsing. */
  }
}
const isBoolean = (value: unknown) => typeof value === 'boolean';

interface DocState {
  index: GraphIndex;
  hidden: ReadonlySet<string>;
  root: string;
  note: boolean;
}
const EMPTY = new Set<string>();

function initialState(index: GraphIndex): DocState {
  const large = index.containers.length > LARGE_GRAPH;
  return { index, hidden: large ? initialCollapse(index) : EMPTY, root: '', note: large };
}
function reconcile(previous: DocState, index: GraphIndex): DocState {
  const large = index.containers.length > LARGE_GRAPH;
  const wasLarge = previous.index.containers.length > LARGE_GRAPH;
  if (large && !wasLarge) return initialState(index);
  const rootEntry = index.byPath.get(previous.root);
  const root = rootEntry && isContainer(rootEntry) ? previous.root : '';
  if (countVisible(index, previous.hidden, root, MAX_VISIBLE_CARDS) > MAX_VISIBLE_CARDS)
    return { index, hidden: initialCollapse(index, LARGE_GRAPH, root), root, note: true };
  return { index, hidden: previous.hidden, root, note: previous.note && large };
}
function reveal(hidden: ReadonlySet<string>, paths: Iterable<string>) {
  let next: Set<string> | null = null;
  for (const path of paths)
    if (hidden.has(path)) {
      next ??= new Set(hidden);
      next.delete(path);
    }
  return next ?? hidden;
}

async function frames(count: number) {
  for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Canvas({ entries, active, select, matches }: GraphProps) {
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const index = useMemo(() => graphIndex(entries), [entries]);
  const [stored, setDoc] = useState(() => initialState(index));
  let doc = stored;
  if (doc.index !== index) {
    doc = reconcile(stored, index);
    setDoc(doc);
  }
  const [direction, setDirection] = useState<GraphDirection>(() =>
    readPref('jsonp.graphDirection', 'LR', (v) => v === 'LR' || v === 'TB'),
  );
  const [minimap, setMinimap] = useState(() => readPref('jsonp.graphMinimap', false, isBoolean));
  const [grid, setGrid] = useState(() => readPref('jsonp.graphGrid', true, isBoolean));
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState('');
  const [renderAll, setRenderAll] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const matchSet = matches && matches.size ? matches : null;

  const layout = useMemo(
    () => graphLayout(doc.index, { hidden: doc.hidden, direction, root: doc.root }),
    [doc.index, doc.hidden, doc.root, direction],
  );
  const docRef = useRef(doc);
  const layoutRef = useRef(layout);
  const selectRef = useRef(select);
  docRef.current = doc;
  layoutRef.current = layout;
  selectRef.current = select;
  const internal = useRef<string | null>(null);
  const anchor = useRef<{ path: string; x: number; y: number } | null>(null);
  const pendingCenter = useRef<string | null>(null);

  const centerOn = useCallback(
    (path: string) => {
      const card = layoutRef.current.positions.get(path);
      if (!card) return;
      const zoom = Math.min(Math.max(flow.getZoom(), 0.55), 1.2);
      flow.setCenter(card.x + card.width / 2, card.y + card.height / 2, { zoom, duration: 400 });
    },
    [flow],
  );
  const fit = useCallback(
    () => flow.fitView({ padding: 0.2, maxZoom: 0.9, minZoom: 0.02, duration: 0 }),
    [flow],
  );
  const keepAnchored = (path: string) => {
    const card = layoutRef.current.positions.get(path);
    anchor.current = card ? { path, x: card.x, y: card.y } : null;
  };
  const actions = useMemo<CardActions>(
    () => ({
      select: (path) => {
        internal.current = path;
        selectRef.current(path);
      },
      toggleCard: (path) => {
        keepAnchored(path);
        setDoc((d) => {
          const kids = d.index.kids.get(path) ?? [];
          const expanded = kids.some((kid) => !d.hidden.has(kid.path));
          const hidden = new Set(d.hidden);
          for (const kid of kids) {
            if (expanded) hidden.add(kid.path);
            else hidden.delete(kid.path);
          }
          return { ...d, hidden };
        });
      },
      toggleRow: (parent, child) => {
        keepAnchored(parent);
        setDoc((d) => {
          const hidden = new Set(d.hidden);
          if (!hidden.delete(child)) hidden.add(child);
          return { ...d, hidden };
        });
      },
    }),
    [],
  );

  // Keep a toggled card where it was on screen, then honour a pending centre request.
  useEffect(() => {
    const previous = anchor.current;
    anchor.current = null;
    const card = previous && layout.positions.get(previous.path);
    if (previous && card) {
      const { x, y, zoom } = flow.getViewport();
      flow.setViewport({
        x: x - (card.x - previous.x) * zoom,
        y: y - (card.y - previous.y) * zoom,
        zoom,
      });
    }
    if (pendingCenter.current) {
      const path = pendingCenter.current;
      pendingCenter.current = null;
      centerOn(path);
    }
  }, [layout, flow, centerOn]);

  // Selection from outside the graph: reveal its card and centre on it.
  useEffect(() => {
    if (active === null) return;
    if (internal.current === active) {
      internal.current = null;
      return;
    }
    internal.current = null;
    const d = docRef.current;
    const chain = cardChain(d.index, active);
    if (!chain.length) return;
    const root = inBranch(chain[0], d.root) ? d.root : '';
    const hidden = reveal(d.hidden, chain);
    if (hidden === d.hidden && root === d.root) centerOn(chain[0]);
    else {
      pendingCenter.current = chain[0];
      setDoc({ ...d, hidden, root });
    }
  }, [active, centerOn]);

  // Search matches: expand their ancestors within the card budget and bring the first into view.
  useEffect(() => {
    if (!matchSet) return;
    const d = docRef.current;
    let budget = MAX_VISIBLE_CARDS - countVisible(d.index, d.hidden, d.root, MAX_VISIBLE_CARDS);
    const seen = new Set<string>();
    let next: Set<string> | null = null;
    let first: string | null = null;
    for (const path of matchSet) {
      if (budget <= 0) break;
      const chain = cardChain(d.index, path);
      if (!chain.length || !inBranch(chain[0], d.root)) continue;
      first ??= chain[0];
      for (const container of chain) {
        if (seen.has(container)) break;
        seen.add(container);
        if (d.hidden.has(container) && inBranch(container, d.root) && container !== d.root) {
          next ??= new Set(d.hidden);
          next.delete(container);
          budget--;
        }
      }
    }
    if (!first) return;
    if (next) {
      pendingCenter.current = first;
      setDoc({ ...d, hidden: next });
    } else if (!layoutRef.current.positions.has(first)) return;
    else centerOn(first);
  }, [matchSet, centerOn]);

  // Fit when the document, direction or branch changes, on request, and on resize.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(fit, 120);
    };
    const observer = new ResizeObserver(schedule);
    if (canvas.current) observer.observe(canvas.current);
    schedule();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [index, direction, doc.root, fitRequest, fit]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('.graph-export, .graph-export-menu')) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  const nodes: Node<CardData>[] = useMemo(() => {
    const lr = direction === 'LR';
    return layout.cards.map((card) => {
      const rows = doc.index.children.get(card.entry.path) ?? [];
      const match =
        !!matchSet && (matchSet.has(card.entry.path) || rows.some((row) => matchSet.has(row.path)));
      return {
        id: nodeId(card.entry.path),
        type: 'json',
        position: { x: card.x, y: card.y },
        sourcePosition: lr ? Position.Right : Position.Bottom,
        targetPosition: lr ? Position.Left : Position.Top,
        data: {
          entry: card.entry,
          rows,
          hidden: doc.hidden,
          active,
          matches: matchSet,
          match,
          dim: !!matchSet && !match,
          actions,
        },
      };
    });
  }, [layout, doc.index, doc.hidden, direction, active, matchSet, actions]);

  const edges: Edge[] = useMemo(
    () =>
      layout.cards
        .filter((card) => card.entry.path !== doc.root && card.entry.parent !== null)
        .map(({ entry }) => {
          const onPath = active === entry.path || !!active?.startsWith(entry.path + '/');
          const label = keyOf(entry);
          return {
            id: `edge:${entry.path}`,
            source: nodeId(entry.parent!),
            target: nodeId(entry.path),
            type: 'smoothstep',
            label: label.length > 24 ? label.slice(0, 23) + '…' : label,
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 3,
            className: onPath ? 'graph-edge-active' : undefined,
          };
        }),
    [layout, doc.root, active],
  );

  const activeEntry = active === null ? undefined : doc.index.byPath.get(active);
  const branch =
    activeEntry === undefined
      ? null
      : isContainer(activeEntry)
        ? activeEntry.path
        : activeEntry.parent;
  const canFocusBranch =
    branch !== null &&
    branch !== doc.root &&
    inBranch(branch, doc.root) &&
    layout.positions.has(branch);

  const setHidden = (hidden: ReadonlySet<string>) => {
    setDoc((d) => ({ ...d, hidden }));
    setFitRequest((n) => n + 1);
  };
  const collapseAll = () =>
    setHidden(new Set(doc.index.containers.filter((c) => c.path !== doc.root).map((c) => c.path)));
  const expandAll = () => setHidden(EMPTY);
  const collapseDeeper = () => setHidden(initialCollapse(doc.index, LARGE_GRAPH, doc.root));
  const showBranch = (root: string) => setDoc((d) => ({ ...d, root }));
  const changeDirection = () => {
    const next = direction === 'LR' ? 'TB' : 'LR';
    setDirection(next);
    writePref('jsonp.graphDirection', next);
  };
  const toggleMinimap = () => {
    setMinimap(!minimap);
    writePref('jsonp.graphMinimap', !minimap);
  };
  const toggleGrid = () => {
    setGrid(!grid);
    writePref('jsonp.graphGrid', !grid);
  };

  async function capture(kind: 'png' | 'svg'): Promise<Blob> {
    setRenderAll(true);
    try {
      await frames(3);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const viewport = canvas.current?.querySelector<HTMLElement>('.react-flow__viewport');
      if (!viewport) throw new Error('Graph is not ready');
      const bounds = getRectOfNodes(flow.getNodes());
      const pad = 32;
      const width = Math.ceil(bounds.width + pad * 2);
      const height = Math.ceil(bounds.height + pad * 2);
      const [x, y, zoom] = getTransformForBounds(bounds, width, height, 1, 1, 0);
      const background =
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#111714';
      const { toBlob, toSvg } = await import('html-to-image');
      const options = {
        backgroundColor: background,
        width,
        height,
        pixelRatio: exportPixelRatio(width, height),
        skipFonts: true,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        },
      };
      if (kind === 'svg') {
        const url = await toSvg(viewport, options);
        return new Blob([decodeURIComponent(url.slice(url.indexOf(',') + 1))], {
          type: 'image/svg+xml',
        });
      }
      const blob = await toBlob(viewport, options);
      if (!blob) throw new Error('Image could not be created');
      return blob;
    } finally {
      setRenderAll(false);
    }
  }
  const exportImage = async (kind: 'png' | 'svg' | 'copy') => {
    setMenu(false);
    if (!layout.cards.length) return;
    try {
      if (kind === 'copy') {
        if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
          setStatus('Copying images is not available in this browser. Use Download PNG instead.');
          return;
        }
        // Create the clipboard item synchronously so the user gesture is kept.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': capture('png') })]);
        setStatus('Graph image copied');
      } else {
        downloadBlob(await capture(kind), `json-graph.${kind}`);
        setStatus(`Graph downloaded as ${kind.toUpperCase()}`);
      }
    } catch {
      setStatus(
        kind === 'copy'
          ? 'The browser blocked copying the image. Use Download PNG instead.'
          : 'The image could not be created. Collapse some branches and try again.',
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.shiftKey && event.code === 'Digit2') fit();
    else if (event.shiftKey && event.code === 'Digit1') centerOn(doc.root);
    else if (event.key === '+' || event.key === '=') flow.zoomIn({ duration: 150 });
    else if (event.key === '-') flow.zoomOut({ duration: 150 });
    else if (event.key === 'Escape' && menu) setMenu(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const hiddenCards = layout.overflow ? 0 : layout.total - layout.visible;
  return (
    <div
      ref={canvas}
      className="graph-canvas"
      tabIndex={0}
      role="group"
      aria-label="Graph"
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onEdgeClick={(_, edge) => centerOn(pathOf(edge.target))}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        minZoom={0.02}
        maxZoom={2}
        onlyRenderVisibleElements={!renderAll && nodes.length > 120}
      >
        {grid && <Background gap={24} />}
        {minimap && <MiniMap pannable zoomable ariaLabel="Graph minimap" />}
      </ReactFlow>
      <div className="graph-top">
        <div className="graph-caption">
          {layout.overflow
            ? `More than ${MAX_VISIBLE_CARDS.toLocaleString()} cards`
            : `${layout.visible} ${layout.visible === 1 ? 'card' : 'cards'}`}
          {hiddenCards > 0 && ` · ${hiddenCards} collapsed`}
          {matchSet && (
            <b>
              {' '}
              · {matchSet.size} {matchSet.size === 1 ? 'match' : 'matches'}
            </b>
          )}
          <span>Scroll to zoom · drag to pan</span>
        </div>
        {(doc.root !== '' || doc.note) && (
          <div className="graph-notices">
            {doc.root !== '' && (
              <div className="graph-chip">
                <GitBranch size={13} aria-hidden="true" />
                <span title={doc.root}>{doc.root}</span>
                <button onClick={() => showBranch('')}>Show full graph</button>
              </div>
            )}
            {doc.note && (
              <div className="graph-note" role="status">
                Large document: deeper branches start collapsed
                <button
                  aria-label="Dismiss note"
                  title="Dismiss"
                  onClick={() => setDoc((d) => ({ ...d, note: false }))}
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {layout.overflow && (
        <div className="graph-overflow empty-state" role="alert">
          <strong>Too many cards to draw at once</strong>
          <p>
            This view would show more than {MAX_VISIBLE_CARDS.toLocaleString()} cards. Collapse
            deeper levels, or select a container and use “Show only this branch”.
          </p>
          <button className="button" onClick={collapseDeeper}>
            Collapse deeper levels
          </button>
        </div>
      )}
      {status && (
        <div className="graph-status" role="status">
          {status}
        </div>
      )}
      <div className="graph-dock" role="toolbar" aria-label="Graph controls">
        <button aria-label="Fit graph" title="Fit graph (Shift+2)" onClick={fit}>
          <Maximize size={15} />
        </button>
        <button
          aria-label="Focus root"
          title="Focus root (Shift+1)"
          onClick={() => centerOn(doc.root)}
        >
          <Crosshair size={15} />
        </button>
        <button
          aria-label="Zoom out"
          title="Zoom out (-)"
          onClick={() => flow.zoomOut({ duration: 150 })}
        >
          <ZoomOut size={15} />
        </button>
        <button
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => flow.zoomIn({ duration: 150 })}
        >
          <ZoomIn size={15} />
        </button>
        <i className="graph-dock-divider" aria-hidden="true" />
        <button
          aria-label="Vertical layout"
          aria-pressed={direction === 'TB'}
          title={
            direction === 'TB' ? 'Switch to left-to-right layout' : 'Switch to top-to-bottom layout'
          }
          onClick={changeDirection}
        >
          <ArrowDownUp size={15} />
        </button>
        <button
          aria-label="Collapse all branches"
          title="Collapse all branches"
          onClick={collapseAll}
        >
          <ChevronsDownUp size={15} />
        </button>
        <button aria-label="Expand all branches" title="Expand all branches" onClick={expandAll}>
          <ChevronsUpDown size={15} />
        </button>
        <button
          aria-label="Show only this branch"
          title="Show only the selected branch"
          disabled={!canFocusBranch}
          onClick={() => branch !== null && showBranch(branch)}
        >
          <GitBranch size={15} />
        </button>
        <i className="graph-dock-divider" aria-hidden="true" />
        <button aria-label="Minimap" aria-pressed={minimap} title="Minimap" onClick={toggleMinimap}>
          <MapIcon size={15} />
        </button>
        <button aria-label="Grid" aria-pressed={grid} title="Grid" onClick={toggleGrid}>
          <Grid3x3 size={15} />
        </button>
        <button
          className="graph-export"
          aria-label="Export image"
          title="Export image"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <Download size={15} /> <span className="graph-dock-caret">▾</span>
        </button>
      </div>
      {menu && (
        <div className="graph-export-menu" role="menu" aria-label="Export image">
          <button role="menuitem" onClick={() => void exportImage('png')}>
            Download PNG
          </button>
          <button role="menuitem" onClick={() => void exportImage('svg')}>
            Download SVG
          </button>
          <button role="menuitem" onClick={() => void exportImage('copy')}>
            Copy PNG
          </button>
        </div>
      )}
    </div>
  );
}

export default function Graph(props: GraphProps) {
  const { entries } = props;
  const shape = useMemo(
    () => ({
      containers: entries.some(isContainer),
      unique: new Set(entries.map((entry) => entry.path)).size === entries.length,
    }),
    [entries],
  );
  if (!shape.containers)
    return (
      <div className="empty-state">
        <strong>{entries.length ? 'A single value' : 'Your structure, at a glance'}</strong>
        <p>
          {entries.length
            ? 'Select the root value in the explorer. Objects and arrays appear here as connected cards.'
            : 'Add an object or array to see its connections.'}
        </p>
      </div>
    );
  if (!shape.unique)
    return (
      <div className="empty-state">
        <strong>Duplicate keys need a closer look</strong>
        <p>Use the explorer to inspect this document. The graph requires unique paths.</p>
      </div>
    );
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
