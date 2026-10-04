import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { diffChars } from 'diff';
import {
  AlignLeft,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  ClipboardPaste,
  Copy,
  Eraser,
  FlaskConical,
  GitCompareArrows,
  ListTree,
  LoaderCircle,
  Pencil,
  SquareArrowOutUpRight,
  TriangleAlert,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import SourceEditor from './SourceEditor';
import type { ChangeKind } from '../lib/diff';
import { jsonPath, MAX_INPUT } from '../lib/json';
import { locateError, type SyntaxProblem } from '../lib/locate';
import { repairJSON } from '../lib/repair';
import { importFile, formatFromName } from '../lib/importFile';
import { parseTree, serialize } from '../lib/tree';
import {
  buildDisplay,
  displayIndexOf,
  SAMPLE_MODIFIED,
  SAMPLE_ORIGINAL,
  type CompareResult,
  type Row,
} from '../lib/linediff';
import type { CompareReply } from '../workers/compare.worker';
import '../styles/compare.css';

export interface CompareViewProps {
  /** Current Source document (may be empty or invalid). */
  initialLeft: string;
  notify: (message: string) => void;
  copy: (text: string, message?: string) => void;
  /** Loads one side into the main editor. */
  onOpenInWorkspace: (text: string) => void;
}

const ROW = 22;
const CHAR = 7.8;
const NUMBER_WIDTH = 52;
const NUMBER_WIDTH_NARROW = 40;
const SIGN_WIDTH = 16;
const OVERVIEW_WIDTH = 14;
const GUARD_MS = 15_000;
const MAX_LIST = 1000;
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const KIND_LABEL: Record<ChangeKind, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  type: 'Type changed',
};
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

type Status =
  { state: 'empty' } | { state: 'valid' } | { state: 'invalid'; problem: SyntaxProblem };
function check(text: string): Status {
  if (!text.trim()) return { state: 'empty' };
  try {
    JSON.parse(text);
    return { state: 'valid' };
  } catch {
    return { state: 'invalid', problem: locateError(text) };
  }
}
const describe = (problem: SyntaxProblem) =>
  `Line ${problem.line + 1}, column ${problem.column}: ${problem.message}`;

// ---- Line rendering -----------------------------------------------------------------------

const TOKEN =
  /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g;
function Highlighted({ text }: { text: string }) {
  if (text.length > 10_000) return <>{text}</>;
  return (
    <>
      {text.split(TOKEN).map((token, index) => (
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
                    : undefined
          }
        >
          {token}
        </span>
      ))}
    </>
  );
}

type Segment = [text: string, changed: boolean];
interface CharDiff {
  left: Segment[];
  right: Segment[];
}
/** Character-level highlights. Tiny shared fragments inside a change are merged into it. */
function charDiff(x: string, y: string): CharDiff | null {
  if (x.length + y.length > 4000) return null;
  const parts = diffChars(x, y);
  const left: Segment[] = [],
    right: Segment[] = [];
  const push = (list: Segment[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last[1] === changed) last[0] += text;
    else list.push([text, changed]);
  };
  parts.forEach((part, index) => {
    if (part.added) push(right, part.value, true);
    else if (part.removed) push(left, part.value, true);
    else {
      const tiny = part.value.length < 3 && index > 0 && index < parts.length - 1;
      push(left, part.value, tiny);
      push(right, part.value, tiny);
    }
  });
  return { left, right };
}
function Segments({ segments, kind }: { segments: Segment[]; kind: 'del' | 'add' }) {
  return (
    <>
      {segments.map(([text, changed], index) =>
        changed ? (
          <mark key={index} className={`cmp-char-${kind}`}>
            {text}
          </mark>
        ) : (
          <span key={index}>{text}</span>
        ),
      )}
    </>
  );
}
const clip = (line: string) => {
  const text = line.trim();
  return text.length > 300 ? text.slice(0, 300) + '…' : text;
};

// ---- Editors ------------------------------------------------------------------------------

interface SideProps {
  id: 'original' | 'modified';
  label: string;
  text: string;
  status: Status;
  sample: string;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  setText: (text: string) => void;
  notify: (message: string) => void;
  onOpenInWorkspace: (text: string) => void;
}
function Side({
  id,
  label,
  text,
  status,
  sample,
  editorRef,
  setText,
  notify,
  onOpenInWorkspace,
}: SideProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const repair = useMemo(
    () => (status.state === 'invalid' ? repairJSON(text) : null),
    [status, text],
  );
  const open = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_INPUT) return notify('Choose a JSON file smaller than 5 MiB.');
    try {
      const format = formatFromName(file.name);
      setText(
        format && format !== 'json'
          ? (await importFile(file)).text
          : (await file.text()).replace(/^\uFEFF/, ''),
      );
      notify(`Opened ${file.name} as ${label}`);
    } catch {
      notify('The file could not be read. Try opening it again.');
    }
  };
  const paste = async () => {
    try {
      const pasted = await navigator.clipboard.readText();
      if (!pasted.trim()) return notify('The clipboard is empty.');
      setText(pasted.replace(/^\uFEFF/, ''));
      notify(`Pasted into ${label}`);
    } catch {
      editorRef.current?.focus();
      notify(`Clipboard access was blocked. Press ${MOD} + V in the ${label} editor instead.`);
    }
  };
  const tool = (name: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <button title={name} aria-label={name} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
  return (
    <section
      className="pane cmp-side"
      aria-labelledby={`compare-${id}-title`}
      data-invalid={status.state === 'invalid' || undefined}
    >
      <div className="pane-heading">
        <h2 id={`compare-${id}-title`}>{label}</h2>
        <span
          className="status cmp-badge"
          data-state={status.state === 'invalid' ? 'error' : status.state}
        >
          <span />
          <b>
            {status.state === 'valid' ? 'Valid' : status.state === 'invalid' ? 'Invalid' : 'Empty'}
          </b>
        </span>
      </div>
      <div className="pane-toolbar cmp-side-tools">
        {tool('Open file', <Upload size={15} />, () => fileRef.current?.click())}
        {tool('Paste', <ClipboardPaste size={15} />, () => void paste())}
        {tool('Load sample', <FlaskConical size={15} />, () => setText(sample))}
        {tool(
          'Format',
          <AlignLeft size={15} />,
          () => setText(serialize(parseTree(text), 2)),
          status.state !== 'valid',
        )}
        {tool(
          'Clear',
          <Eraser size={15} />,
          () => {
            setText('');
            editorRef.current?.focus();
          },
          !text,
        )}
        {repair && (
          <button
            className="repair-button"
            title={repair.fixes.join('\n')}
            onClick={() => {
              setText(repair.output);
              notify(`Repaired ${label}: ${repair.fixes.join(', ')}`);
            }}
          >
            <Wrench size={13} /> Repair
          </button>
        )}
        <span className="cmp-spacer" />
        {tool(
          'Use in workspace',
          <SquareArrowOutUpRight size={15} />,
          () => onOpenInWorkspace(text),
          !text.trim(),
        )}
        <input
          type="file"
          hidden
          ref={fileRef}
          aria-label={`Open a file as ${label}`}
          accept=".json,.txt,.yaml,.yml,.xml,.csv,.tsv,.xlsx,.xls,.ods,application/json,text/plain"
          onChange={(event) => {
            void open(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <SourceEditor
        ref={editorRef}
        value={text}
        wrap={false}
        errorLine={status.state === 'invalid' ? status.problem.line : undefined}
        onChange={setText}
        onCursor={() => {}}
        id={`compare-${id}-input`}
        label={`${label} JSON`}
        placeholder={`Paste the ${id} JSON here, or open a JSON, YAML, XML, CSV, or Excel file.`}
      />
      {status.state === 'invalid' && (
        <p className="cmp-side-error" role="alert">
          {describe(status.problem)}
        </p>
      )}
    </section>
  );
}

// ---- Overview strip ----------------------------------------------------------------------

function Overview({
  result,
  items,
  scroll,
  viewport,
  onJump,
}: {
  result: CompareResult;
  items: Int32Array;
  scroll: number;
  viewport: number;
  onJump: (fraction: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(0);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    resize.observe(el);
    const themes = new MutationObserver(() => setTheme(document.documentElement.dataset.theme));
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      resize.disconnect();
      themes.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = canvas.current;
    const context = el?.getContext('2d');
    if (!el || !context || !height) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = OVERVIEW_WIDTH * ratio;
    el.height = Math.round(height * ratio);
    context.clearRect(0, 0, el.width, el.height);
    const style = getComputedStyle(el);
    const colors = {
      add: style.getPropertyValue('--cmp-add-mark'),
      del: style.getPropertyValue('--cmp-del-mark'),
      mod: style.getPropertyValue('--cmp-mod-mark'),
    };
    const total = items.length;
    const mark = Math.max(2 * ratio, (el.height / total) | 0);
    let lastY = -1,
      lastKind = '';
    for (let i = 0; i < total; i++) {
      const item = items[i];
      if (item < 0) continue;
      const kind = result.rows[item >> 1].kind;
      if (kind === 'same') continue;
      const y = Math.floor((i / total) * el.height);
      if (y === lastY && kind === lastKind) continue;
      lastY = y;
      lastKind = kind;
      context.fillStyle = colors[kind];
      context.fillRect(2 * ratio, y, el.width - 4 * ratio, mark);
    }
  }, [result, items, height, theme]);
  const total = items.length * ROW;
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onJump(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
  };
  return (
    <div
      className="cmp-overview"
      aria-hidden="true"
      title="Overview of changes. Click to jump."
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) drag(event);
      }}
    >
      <canvas ref={canvas} />
      {total > 0 && height > 0 && (
        <span
          className="cmp-overview-view"
          style={{
            top: (scroll / total) * height,
            height: Math.max(6, Math.min(1, viewport / total) * height),
          }}
        />
      )}
    </div>
  );
}

// ---- Compare view ------------------------------------------------------------------------

/** Full-screen side-by-side comparison with a line-aligned, synced-scrolling difference view. */
export default function CompareView({
  initialLeft,
  notify,
  copy,
  onOpenInWorkspace,
}: CompareViewProps): JSX.Element {
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState('');
  const [mode, setMode] = useState<'edit' | 'diff'>('edit');
  const [sortOn, setSortOn] = useState(true);
  const [ignoreOrder, setIgnoreOrder] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [current, setCurrent] = useState(-1);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [pending, setPending] = useState<{ row: number; flash: boolean } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [changesOpen, setChangesOpen] = useState(() => !matchMedia('(max-width: 1100px)').matches);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 800px)').matches);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState(0);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [sx, setSx] = useState(0);
  const leftRef = useRef<HTMLTextAreaElement>(null),
    rightRef = useRef<HTMLTextAreaElement>(null);
  const workerRef = useRef<Worker | undefined>(undefined);
  const guardRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchRef = useRef<{ x: number; y: number; sx: number } | null>(null);

  const deferredLeft = useDeferredValue(left),
    deferredRight = useDeferredValue(right);
  const leftStatus = useMemo(() => check(deferredLeft), [deferredLeft]);
  const rightStatus = useMemo(() => check(deferredRight), [deferredRight]);

  useEffect(() => {
    const query = matchMedia('(max-width: 800px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const stop = () => {
    workerRef.current?.terminate();
    workerRef.current = undefined;
    clearTimeout(guardRef.current);
  };
  useEffect(
    () => () => {
      stop();
      clearTimeout(flashRef.current);
    },
    [],
  );

  const why = (text: string, label: string) => {
    const status = check(text);
    if (status.state === 'empty') return `Add JSON to the ${label} side to compare.`;
    if (status.state === 'invalid')
      return `Fix the ${label} side first. ${describe(status.problem)}`;
    return '';
  };
  const run = (l = left, r = right, sortKeys = sortOn, ignore = ignoreOrder) => {
    stop();
    const problem = why(l, 'Original') || why(r, 'Modified');
    if (problem) {
      setRunning(false);
      setMode('edit');
      setMessage(problem);
      return;
    }
    setMessage('');
    setRunning(true);
    const worker = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    const fail = (text: string) => {
      stop();
      setRunning(false);
      setMode('edit');
      setMessage(text);
    };
    guardRef.current = setTimeout(
      () => fail('The comparison stopped after 15 seconds. Try smaller documents.'),
      GUARD_MS,
    );
    worker.onmessage = (event: MessageEvent<CompareReply>) => {
      if (workerRef.current !== worker) return;
      if (event.data.error !== undefined) return fail(event.data.error);
      stop();
      const next = event.data.result;
      setRunning(false);
      setResult(next);
      setMode('diff');
      setExpanded(new Set());
      setSx(0);
      setCurrent(next.hunks.length ? 0 : -1);
      setPending(next.hunks.length ? { row: next.hunks[0], flash: false } : null);
      if (scrollEl) scrollEl.scrollTop = 0;
      setScroll(0);
    };
    worker.onerror = () => fail('The comparison failed. Reload the page and try again.');
    worker.postMessage({ left: l, right: r, sortKeys, ignoreOrder: ignore });
  };
  // Ctrl/⌘+Enter anywhere in Compare mode runs the comparison (relayed by the app shell).
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onCompare = () => runRef.current();
    window.addEventListener('jsonp:compare', onCompare);
    return () => window.removeEventListener('jsonp:compare', onCompare);
  }, []);
  const cancel = () => {
    stop();
    setRunning(false);
    notify('Comparison cancelled');
  };

  // ---- Diff view state ----
  const display = useMemo(
    () => (result ? buildDisplay(result.rows, { onlyChanges, expanded, unified: narrow }) : null),
    [result, onlyChanges, expanded, narrow],
  );
  const hunkEnds = useMemo(
    () =>
      result?.hunks.map((start) => {
        let end = start;
        while (end < result.rows.length && result.rows[end].kind !== 'same') end++;
        return end;
      }) ?? [],
    [result],
  );
  const chars = useMemo(() => new Map<number, CharDiff | null>(), [result]);
  const charsFor = (index: number, row: Row) => {
    let value = chars.get(index);
    if (value === undefined) {
      value = charDiff(result!.left[row.a!], result!.right[row.b!]);
      chars.set(index, value);
    }
    return value;
  };
  const longest = useMemo(() => {
    let max = 0;
    for (const line of result?.left ?? []) if (line.length > max) max = line.length;
    for (const line of result?.right ?? []) if (line.length > max) max = line.length;
    return max;
  }, [result]);
  const textWidth = narrow
    ? size.width - 2 * NUMBER_WIDTH_NARROW - SIGN_WIDTH
    : (size.width - 2 * NUMBER_WIDTH) / 2;
  const maxSx = Math.max(0, Math.ceil(longest * CHAR + 24 - textWidth));
  useEffect(() => setSx((value) => Math.min(value, maxSx)), [maxSx]);

  useEffect(() => {
    if (!scrollEl) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(scrollEl);
    return () => observer.disconnect();
  }, [scrollEl]);

  // Scroll to a pending row, expanding the fold that hides it first.
  useEffect(() => {
    if (!pending || !display || !scrollEl) return;
    const index = displayIndexOf(display, pending.row);
    const item = display.items[index];
    if (item < 0) {
      const fold = display.folds[-item - 1];
      setExpanded((prev) => new Set(prev).add(fold.start));
      return;
    }
    scrollEl.scrollTop = Math.max(0, index * ROW - scrollEl.clientHeight / 3);
    setScroll(scrollEl.scrollTop);
    if (pending.flash) {
      setFlash(pending.row);
      clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setFlash(null), 1400);
    }
    setPending(null);
  }, [pending, display, scrollEl]);

  const hunkCount = result?.hunks.length ?? 0;
  const go = (index: number) => {
    if (!result || index < 0 || index >= hunkCount) return;
    setCurrent(index);
    setPending({ row: result.hunks[index], flash: false });
  };
  const rerun = (next: { l?: string; r?: string; sortKeys?: boolean; ignore?: boolean }) => {
    if (mode === 'diff' || running)
      run(next.l ?? left, next.r ?? right, next.sortKeys ?? sortOn, next.ignore ?? ignoreOrder);
  };

  const identical = !!result && hunkCount === 0;
  const structuralText = result
    ? [
        result.structural.changed && plural(result.structural.changed, 'changed value'),
        result.structural.added && `${result.structural.added.toLocaleString()} added`,
        result.structural.removed && `${result.structural.removed.toLocaleString()} removed`,
        result.structural.type && `${result.structural.type.toLocaleString()} type changed`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  // ---- Rendering rows ----
  const renderRows = () => {
    if (!result || !display) return null;
    const { items, folds } = display;
    const first = Math.max(0, Math.floor(scroll / ROW) - 8);
    const last = Math.min(items.length, Math.ceil((scroll + size.height) / ROW) + 8);
    const currentStart = current >= 0 ? result.hunks[current] : -1,
      currentEnd = current >= 0 ? hunkEnds[current] : -1;
    const out: ReactNode[] = [];
    for (let i = first; i < last; i++) {
      const item = items[i];
      const top = i * ROW;
      if (item < 0) {
        const fold = folds[-item - 1];
        const count = fold.end - fold.start;
        out.push(
          <div role="listitem" key={`f${fold.start}`} className="cmp-row cmp-fold" style={{ top }}>
            <button
              title="Show these lines"
              onClick={() => setExpanded((prev) => new Set(prev).add(fold.start))}
            >
              <span aria-hidden="true">⋯</span> {plural(count, 'unchanged line')}
            </button>
          </div>,
        );
        continue;
      }
      const index = item >> 1,
        half = item & 1;
      const row = result.rows[index];
      const a = row.a !== undefined ? result.left[row.a] : undefined;
      const b = row.b !== undefined ? result.right[row.b] : undefined;
      const lineA = row.a !== undefined ? row.a + 1 : undefined;
      const lineB = row.b !== undefined ? row.b + 1 : undefined;
      const diff = row.kind === 'mod' ? charsFor(index, row) : null;
      const textA =
        a === undefined ? null : diff ? (
          <Segments segments={diff.left} kind="del" />
        ) : row.kind === 'mod' ? (
          <mark className="cmp-char-del">{a}</mark>
        ) : (
          <Highlighted text={a} />
        );
      const textB =
        b === undefined ? null : diff ? (
          <Segments segments={diff.right} kind="add" />
        ) : row.kind === 'mod' ? (
          <mark className="cmp-char-add">{b}</mark>
        ) : (
          <Highlighted text={b} />
        );
      const label =
        row.kind === 'same'
          ? `line ${lineA} unchanged: ${clip(a!)}`
          : row.kind === 'del'
            ? `line ${lineA} removed: ${clip(a!)}`
            : row.kind === 'add'
              ? `line ${lineB} added: ${clip(b!)}`
              : narrow
                ? half
                  ? `now line ${lineB}: ${clip(b!)}`
                  : `line ${lineA} changed: ${clip(a!)}`
                : `line ${lineA} changed: ${clip(a!)} — now line ${lineB}: ${clip(b!)}`;
      const classes = [
        'cmp-row',
        `k-${row.kind}`,
        index >= currentStart && index < currentEnd ? 'is-current' : '',
        flash === index ? 'is-flash' : '',
      ].join(' ');
      let cells: ReactNode;
      if (narrow) {
        const old = row.kind === 'del' || (row.kind === 'mod' && !half);
        const sign = row.kind === 'same' ? ' ' : old ? '−' : '+';
        cells = (
          <>
            <span className="cmp-num">{row.kind === 'add' || half ? '' : lineA}</span>
            <span className="cmp-num">{old ? '' : lineB}</span>
            <span className="cmp-sign">{sign}</span>
            <span className={`cmp-cell ${old ? 'side-a' : 'side-b'}`}>
              <code>{old || row.kind === 'same' ? textA : textB}</code>
            </span>
          </>
        );
      } else
        cells = (
          <>
            <span className="cmp-num">{lineA}</span>
            <span className={`cmp-cell side-a ${a === undefined ? 'cmp-filler' : ''}`}>
              {textA !== null && <code>{textA}</code>}
            </span>
            <span className="cmp-num">{lineB}</span>
            <span className={`cmp-cell side-b ${b === undefined ? 'cmp-filler' : ''}`}>
              {textB !== null && <code>{textB}</code>}
            </span>
          </>
        );
      out.push(
        <div
          role="listitem"
          key={item}
          className={`${classes} ${narrow && row.kind === 'mod' ? (half ? 'half-new' : 'half-old') : ''}`}
          style={{ top }}
        >
          <span className="sr-only">{label}</span>
          <div className="cmp-cells" aria-hidden="true">
            {cells}
          </div>
        </div>,
      );
    }
    return out;
  };

  const jumpFraction = (fraction: number) => {
    if (!scrollEl || !display) return;
    scrollEl.scrollTop = fraction * display.items.length * ROW - scrollEl.clientHeight / 2;
  };
  const report = () => {
    if (!result) return;
    copy(
      JSON.stringify(
        {
          summary: result.structural,
          truncated: result.truncated,
          changes: result.changes.map((change) => ({
            kind: change.kind,
            path: jsonPath(change.parts),
            before: change.before,
            after: change.after,
          })),
        },
        null,
        2,
      ),
      'Comparison report copied',
    );
  };

  return (
    <div
      className={`compare-view ${narrow ? 'is-narrow' : ''}`}
      data-mode={mode}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          run();
          return;
        }
        if (mode !== 'diff' || !result) return;
        const back =
          (event.altKey && event.key === 'ArrowUp') || (event.shiftKey && event.key === 'F7');
        const forward =
          (event.altKey && event.key === 'ArrowDown') || (!event.shiftKey && event.key === 'F7');
        if (back || forward) {
          event.preventDefault();
          event.stopPropagation();
          go(current + (back ? -1 : 1));
        }
      }}
    >
      <div className="cmp-toolbar">
        {mode === 'edit' ? (
          <button
            className="button primary-button"
            onClick={() => run()}
            title={`Compare (${MOD} + Enter)`}
            disabled={running}
          >
            {running ? (
              <LoaderCircle size={15} className="cmp-spin" />
            ) : (
              <GitCompareArrows size={15} />
            )}
            {running ? 'Comparing…' : 'Compare'}
          </button>
        ) : (
          <button className="button" onClick={() => setMode('edit')}>
            <Pencil size={15} /> Edit
          </button>
        )}
        {running && (
          <button className="button" onClick={cancel}>
            <X size={15} /> Cancel
          </button>
        )}
        <button
          className="button"
          title="Swap the original and modified documents"
          onClick={() => {
            setLeft(right);
            setRight(left);
            rerun({ l: right, r: left });
          }}
        >
          <ArrowLeftRight size={15} />
          <span className="cmp-label">Swap sides</span>
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button
          className="button"
          aria-pressed={sortOn}
          title="Sort object keys before comparing, so key order never counts as a difference"
          onClick={() => {
            setSortOn(!sortOn);
            rerun({ sortKeys: !sortOn });
          }}
        >
          Sort keys
        </button>
        <button
          className="button"
          aria-pressed={ignoreOrder}
          title="Match array items regardless of position in the list of changes"
          onClick={() => {
            setIgnoreOrder(!ignoreOrder);
            rerun({ ignore: !ignoreOrder });
          }}
        >
          Ignore array order
        </button>
        {mode === 'diff' && result && !identical && (
          <>
            <button
              className="button"
              aria-pressed={onlyChanges}
              title="Hide unchanged lines, keeping 3 lines of context"
              onClick={() => {
                setOnlyChanges(!onlyChanges);
                setExpanded(new Set());
                if (current >= 0) setPending({ row: result.hunks[current], flash: false });
              }}
            >
              Only changes
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <div className="cmp-nav">
              <button
                className="icon-button"
                aria-label="Previous difference"
                title="Previous difference (Alt + ↑, Shift + F7)"
                disabled={current <= 0}
                onClick={() => go(current - 1)}
              >
                <ChevronUp size={16} />
              </button>
              <span className="cmp-position" aria-live="polite">
                {Math.max(0, current + 1).toLocaleString()} of {hunkCount.toLocaleString()}
              </span>
              <button
                className="icon-button"
                aria-label="Next difference"
                title="Next difference (Alt + ↓, F7)"
                disabled={current >= hunkCount - 1}
                onClick={() => go(current + 1)}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </>
        )}
        {mode === 'diff' && result && result.changes.length > 0 && (
          <>
            <button className="button" onClick={report}>
              <Copy size={15} />
              <span className="cmp-label">Copy report</span>
            </button>
            <button
              className="button"
              aria-expanded={changesOpen}
              aria-controls="compare-changes"
              onClick={() => setChangesOpen(!changesOpen)}
            >
              <ListTree size={15} />
              <span className="cmp-label">Changes</span>
            </button>
          </>
        )}
      </div>
      {message && (
        <p className="cmp-message" role="alert">
          <TriangleAlert size={15} /> {message}
        </p>
      )}
      {mode === 'edit' ? (
        <div className="cmp-editors">
          <Side
            id="original"
            label="Original"
            text={left}
            status={leftStatus}
            sample={SAMPLE_ORIGINAL}
            editorRef={leftRef}
            setText={setLeft}
            notify={notify}
            onOpenInWorkspace={onOpenInWorkspace}
          />
          <Side
            id="modified"
            label="Modified"
            text={right}
            status={rightStatus}
            sample={SAMPLE_MODIFIED}
            editorRef={rightRef}
            setText={setRight}
            notify={notify}
            onOpenInWorkspace={onOpenInWorkspace}
          />
        </div>
      ) : (
        result &&
        display && (
          <div className="cmp-body">
            <div className="cmp-diff">
              <div className="cmp-summary" role="status">
                {identical ? (
                  <span>No differences</span>
                ) : (
                  <>
                    <span className="cmp-counts">
                      <span className="cmp-chip k-add" title="Added lines">
                        +{result.counts.added.toLocaleString()}
                        <span className="sr-only"> added lines</span>
                      </span>
                      <span className="cmp-chip k-del" title="Removed lines">
                        −{result.counts.removed.toLocaleString()}
                        <span className="sr-only"> removed lines</span>
                      </span>
                      <span className="cmp-chip k-mod" title="Changed lines">
                        ~{result.counts.changed.toLocaleString()}
                        <span className="sr-only"> changed lines</span>
                      </span>
                    </span>
                    <span className="cmp-structural">
                      {structuralText ||
                        `The values are equivalent; the lines differ only in notation${ignoreOrder ? ' or array order' : ''}.`}
                      {result.truncated &&
                        ` · showing the first ${result.changes.length.toLocaleString()}`}
                    </span>
                  </>
                )}
                {running && (
                  <span className="cmp-running">
                    <LoaderCircle size={13} className="cmp-spin" /> Comparing…
                  </span>
                )}
              </div>
              {result.approximate && (
                <p className="cmp-banner">
                  <TriangleAlert size={14} /> These documents differ too much for a fast exact
                  alignment, so lines are paired by position.
                </p>
              )}
              {identical ? (
                <div className="empty-state cmp-identical">
                  <CircleCheck size={34} />
                  <strong>No differences — the documents are equivalent</strong>
                  <p>
                    {result.keyOrderOnly
                      ? 'Only the order of object keys differs. Sort keys is on, so key order never counts as a difference.'
                      : 'Both documents format to exactly the same lines.'}
                  </p>
                  <button className="button" onClick={() => setMode('edit')}>
                    <Pencil size={15} /> Edit documents
                  </button>
                </div>
              ) : (
                <>
                  {!narrow && (
                    <div className="cmp-columns" aria-hidden="true">
                      <span>Original</span>
                      <span>Modified</span>
                    </div>
                  )}
                  <div className="cmp-frame">
                    <div
                      ref={setScrollEl}
                      className="cmp-scroll"
                      role="region"
                      aria-label="Differences"
                      tabIndex={0}
                      onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
                      onWheel={(event) => {
                        const dx = event.shiftKey ? event.deltaX || event.deltaY : event.deltaX;
                        if (
                          maxSx &&
                          dx &&
                          (event.shiftKey || Math.abs(dx) > Math.abs(event.deltaY))
                        )
                          setSx((value) => Math.min(maxSx, Math.max(0, value + dx)));
                      }}
                      onTouchStart={(event) => {
                        const touch = event.touches[0];
                        touchRef.current = { x: touch.clientX, y: touch.clientY, sx };
                      }}
                      onTouchMove={(event) => {
                        const start = touchRef.current,
                          touch = event.touches[0];
                        if (!start || !maxSx) return;
                        const dx = start.x - touch.clientX;
                        if (Math.abs(dx) > Math.abs(start.y - touch.clientY))
                          setSx(Math.min(maxSx, Math.max(0, start.sx + dx)));
                      }}
                      onKeyDown={(event) => {
                        if (event.altKey || event.ctrlKey || event.metaKey || !maxSx) return;
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          event.preventDefault();
                          const step = event.key === 'ArrowLeft' ? -48 : 48;
                          setSx((value) => Math.min(maxSx, Math.max(0, value + step)));
                        }
                      }}
                    >
                      <div
                        role="list"
                        aria-label={`${display.items.length.toLocaleString()} aligned lines`}
                        className="cmp-lines"
                        style={
                          {
                            height: display.items.length * ROW,
                            '--sx': `${-sx}px`,
                          } as CSSProperties
                        }
                      >
                        {renderRows()}
                      </div>
                    </div>
                    <Overview
                      result={result}
                      items={display.items}
                      scroll={scroll}
                      viewport={size.height}
                      onJump={jumpFraction}
                    />
                  </div>
                  {maxSx > 0 && (
                    <input
                      className="cmp-sideways"
                      type="range"
                      aria-label="Scroll lines sideways"
                      min={0}
                      max={maxSx}
                      value={sx}
                      onChange={(event) => setSx(Number(event.target.value))}
                    />
                  )}
                </>
              )}
            </div>
            {changesOpen && result.changes.length > 0 && (
              <aside
                className="cmp-changes"
                id="compare-changes"
                aria-labelledby="compare-changes-title"
              >
                <div className="pane-heading">
                  <h2 id="compare-changes-title">
                    Changes{' '}
                    <span className="cmp-count">{result.changes.length.toLocaleString()}</span>
                  </h2>
                  <button
                    className="icon-button"
                    aria-label="Hide changes"
                    onClick={() => setChangesOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <ol>
                  {result.changes.slice(0, MAX_LIST).map((change, index) => (
                    <li key={index} data-kind={change.kind}>
                      <button onClick={() => setPending({ row: change.row, flash: true })}>
                        <span className="cmp-change-head">
                          <b>{KIND_LABEL[change.kind]}</b>
                          <code>{jsonPath(change.parts)}</code>
                        </span>
                        {(change.before !== undefined || change.after !== undefined) && (
                          <span className="cmp-change-values">
                            {change.before !== undefined && <del>{change.before}</del>}
                            {change.after !== undefined && <ins>{change.after}</ins>}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
                {result.changes.length > MAX_LIST && (
                  <p className="cmp-more">
                    Showing the first {MAX_LIST.toLocaleString()}. Copy the report for all of them.
                  </p>
                )}
              </aside>
            )}
          </div>
        )
      )}
    </div>
  );
}
