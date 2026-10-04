import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Braces,
  Copy,
  Download,
  Upload,
  Network,
  Sun,
  Moon,
  RotateCcw,
  Trash2,
  X,
  Minimize2,
  Maximize2,
  GripVertical,
  FileSpreadsheet,
  Check,
  ChevronRight,
  WrapText,
  Undo2,
  Redo2,
  ArrowRight,
  AlertCircle,
  Search,
  CircleHelp,
  Wrench,
  Shuffle,
  GitCompareArrows,
  Table2,
  Link2,
  ClipboardPaste,
  FilePlus2,
  ArrowDownAZ,
  Eraser,
  Minimize,
  Quote,
  TextQuote,
  Scissors,
  Sheet,
  BarChart3,
  Save,
  Crosshair,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Wand2,
  LayoutPanelLeft,
  ArrowLeftToLine,
} from 'lucide-react';
import { EXAMPLE, MAX_INPUT, jsonPath, type DocumentResult, type Indent } from './lib/json';
import { download, exportMapping } from './lib/export';
import Explorer from './components/Explorer';
import Output from './components/Output';
import PathBar from './components/PathBar';
import ExportDialog from './components/ExportDialog';
import Menu, { type MenuItem } from './components/Menu';
import CommandPalette, { type Command } from './components/CommandPalette';
import HelpDialog from './components/HelpDialog';
import ConvertDialog, { type ConvertRequest } from './components/ConvertDialog';
import FormatterView, { savedOutputView, type OutputView } from './components/FormatterView';
import SchemaDialog from './components/SchemaDialog';
import Insights from './components/Insights';
import SourceEditor from './components/SourceEditor';
import TableView from './components/TableView';
import { needsSource, type ExportKind } from './lib/ird';
import {
  parseTree,
  serialize,
  sortKeys,
  prune,
  escapeJSON,
  unescapeJSON,
  nodeAt,
  type Node,
} from './lib/tree';
import { FORMATS, type Format } from './lib/convert';
import { importFile, formatFromName, sniffText } from './lib/importFile';
import { shareLink, readShared, MAX_SHARE_LENGTH } from './lib/share';
const Graph = lazy(() => import('./components/Graph'));
const CompareView = lazy(() => import('./components/CompareView'));
type Mode = 'format' | 'workspace' | 'compare';
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'format', label: 'Format', hint: 'Paste, format, validate, and convert' },
  { id: 'workspace', label: 'Workspace', hint: 'Explore paths, tables, and graphs side by side' },
  { id: 'compare', label: 'Compare', hint: 'See two documents side by side' },
];
const modeFromHash = (): Mode | null => {
  const hash = location.hash.slice(1);
  return MODES.some((m) => m.id === hash) ? (hash as Mode) : null;
};
const INDENTS: { value: string; label: string; indent: Indent }[] = [
  { value: '2', label: '2 spaces', indent: 2 },
  { value: '3', label: '3 spaces', indent: 3 },
  { value: '4', label: '4 spaces', indent: 4 },
  { value: 'tab', label: 'Tabs', indent: '\t' },
];
const indentKey = (indent: Indent) => (indent === '\t' ? 'tab' : String(indent));
type Pane = 'input' | 'output' | 'paths' | 'table' | 'graph';
const DEFAULT_ORDER: Pane[] = ['input', 'output', 'paths'];
const LABELS: Record<Pane, string> = {
  input: 'Source',
  output: 'Formatted',
  paths: 'Explorer',
  table: 'Table',
  graph: 'Graph',
};
const EMPTY: DocumentResult = { output: '', entries: [], warnings: [], error: null };
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const DRAFT_LIMIT = 2 * 1024 * 1024;
function saved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function savedOrder(): Pane[] {
  const value = saved<unknown>('jsonp.order', DEFAULT_ORDER);
  return Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 5 &&
    new Set(value).size === value.length &&
    DEFAULT_ORDER.every((p) => value.includes(p)) &&
    value.every((p) => typeof p === 'string' && Object.hasOwn(LABELS, p))
    ? (value as Pane[])
    : DEFAULT_ORDER;
}
function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferences are optional in private browsing. */
  }
}
export default function App() {
  const [remember, setRemember] = useState(() => saved<boolean>('jsonp.remember', false) === true);
  const [input, setInput] = useState(() => {
    const draft = remember ? saved<unknown>('jsonp.draft', null) : null;
    return typeof draft === 'string' ? draft : EXAMPLE;
  });
  const [result, setResult] = useState<DocumentResult>(EMPTY);
  const [processedInput, setProcessedInput] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [indent, setIndentState] = useState<Indent>(() => {
    const value = saved<unknown>('jsonp.indent', 2);
    return value === '\t' || value === 0 || value === 2 || value === 3 || value === 4 ? value : 2;
  });
  /** The last non-compact indentation, restored by Beautify. */
  const [lastIndent, setLastIndent] = useState<Indent>(indent || 2);
  const setIndent = (next: Indent) => {
    setIndentState(next);
    if (next) setLastIndent(next);
    save('jsonp.indent', next);
  };
  const [mode, setModeState] = useState<Mode>(() => {
    const savedMode = saved<unknown>('jsonp.mode', 'format');
    return (
      modeFromHash() ?? (MODES.some((m) => m.id === savedMode) ? (savedMode as Mode) : 'format')
    );
  });
  const [graphMatches, setGraphMatches] = useState<ReadonlySet<string> | null>(null);
  const [formatView, setFormatView] = useState<OutputView>(savedOutputView);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    saved<string>('jsonp.theme', 'dark') === 'light' ? 'light' : 'dark',
  );
  const [order, setOrder] = useState<Pane[]>(savedOrder);
  const [collapsed, setCollapsed] = useState<Pane[]>([]);
  const [focusedPane, setFocusedPane] = useState<Pane | null>(null);
  const [mobilePane, setMobilePane] = useState<Pane>('input');
  const [active, setActive] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'key' | 'value'>('value');
  const [wrap, setWrap] = useState(false);
  const [toast, setToast] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [welcome, setWelcome] = useState(() => !saved<boolean>('jsonp.welcomed', false));
  const [convertRequest, setConvertRequest] = useState<ConvertRequest>({ nonce: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDialogElement>(null),
    paletteRef = useRef<HTMLDialogElement>(null),
    convertRef = useRef<HTMLDialogElement>(null),
    schemaRef = useRef<HTMLDialogElement>(null),
    insightsRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null),
    dragPane = useRef<Pane | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = processedInput === input && !busy;
  const entries = current ? result.entries : [];
  const output = current ? result.output : '';
  const error = current ? result.error : null;
  const problem = current ? result.problem : undefined;
  const repair = current ? result.repair : undefined;
  // Pasted YAML, XML, or CSV is offered a conversion instead of (or alongside) repair.
  const sniffed = useMemo(
    () => (problem && input.length < 5 * 1024 * 1024 ? sniffText(input) : null),
    [problem, input],
  );
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const selected = active !== null ? entryMap.get(active) : undefined;
  /** Lossless tree of the current source, parsed on first use. */
  const getTree = useMemo(() => {
    let cache: Node | null | undefined;
    return () => {
      if (cache === undefined)
        try {
          cache = parseTree(input);
        } catch {
          cache = null;
        }
      return cache;
    };
  }, [input]);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(''), 3500);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      resizeCleanup.current?.();
    },
    [],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save('jsonp.theme', theme);
  }, [theme]);
  useEffect(() => save('jsonp.order', order), [order]);
  // The draft is kept only when the person opts in, and never when it is very large.
  useEffect(() => {
    save('jsonp.remember', remember);
    if (!remember) return save('jsonp.draft', undefined);
    const timer = setTimeout(
      () => save('jsonp.draft', input.length <= DRAFT_LIMIT ? input : undefined),
      400,
    );
    return () => clearTimeout(timer);
  }, [remember, input]);
  useEffect(() => {
    setBusy(true);
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      worker = new Worker(new URL('./workers/json.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<DocumentResult>) => {
        setResult(event.data);
        setProcessedInput(input);
        setBusy(false);
        worker?.terminate();
      };
      worker.onerror = () => {
        setResult({ ...EMPTY, error: 'Processing failed. Reload the page and try again.' });
        setProcessedInput(input);
        setBusy(false);
        worker?.terminate();
      };
      worker.postMessage({ source: input, indent });
    }, 180);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [input, indent]);
  const copy = useCallback(
    async (text: string, message = 'Copied to clipboard') => {
      try {
        await navigator.clipboard.writeText(text);
        notify(message);
      } catch {
        notify('Clipboard unavailable. Select the text and copy it manually.');
      }
    },
    [notify],
  );
  const scrollSource = (offset: number) => {
    const textarea = inputRef.current;
    if (textarea)
      textarea.scrollTop = Math.max(
        0,
        (input.slice(0, offset).match(/\n/g)?.length || 0) * 22 - textarea.clientHeight / 3,
      );
  };
  const select = useCallback(
    (path: string) => {
      const entry = entryMap.get(path);
      if (!entry) return false;
      setActive(path);
      setActiveSection('value');
      inputRef.current?.setSelectionRange(entry.start, entry.end);
      scrollSource(entry.start);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entryMap, input],
  );
  const cursor = () => {
    const position = inputRef.current?.selectionStart;
    if (position === undefined || !current) return;
    let found: string | null = null;
    for (const entry of entries)
      if (position >= entry.keyStart && position < entry.end) {
        found = entry.path;
        setActiveSection(position < entry.start ? 'key' : 'value');
      }
    setActive(found);
  };
  /** Replaces the whole source, keeping the previous text for Undo. */
  const replace = useCallback(
    (text: string) => {
      setUndoStack((prev) => [...prev.slice(-29), input]);
      setRedoStack([]);
      setActive(null);
      setInput(text);
    },
    [input],
  );
  const undo = () => {
    const previous = undoStack.at(-1);
    if (previous === undefined) return;
    // Typing since the last replacement is kept on the redo stack, never lost.
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-29), input]);
    setActive(null);
    setInput(previous);
    notify('Undone. Redo brings it back.');
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (next === undefined) return;
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-29), input]);
    setActive(null);
    setInput(next);
    notify('Redone');
  };
  const showPane = useCallback((pane: Pane) => {
    setOrder((prev) => (prev.includes(pane) ? prev : [...prev, pane]));
    setCollapsed((prev) => prev.filter((p) => p !== pane));
    setFocusedPane((prev) => (prev && prev !== pane ? null : prev));
    setMobilePane(pane);
  }, []);
  const formatSource = () => {
    if (!output) return notify(repair ? 'Repair the JSON first.' : 'Nothing to format yet.');
    replace(output);
    notify('Source formatted');
  };
  const repairSource = () => {
    if (!repair)
      return notify(error ? 'This JSON can’t be repaired automatically.' : 'Already valid');
    replace(repair.output);
    notify(`Repaired JSON: ${repair.fixes.join('; ')}`);
  };
  /** Applies a lossless tree transform to the source. */
  const transform = (message: string, change: (root: Node) => Node | string | null) => {
    const root = getTree();
    if (!root) return notify('Fix the JSON in Source first.');
    const next = change(root);
    if (next === null) return;
    replace(typeof next === 'string' ? next : serialize(next, indent || 2));
    notify(message);
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_INPUT) return notify('Choose a file smaller than 5 MiB.');
    const format = formatFromName(file.name);
    try {
      if (format && format !== 'json') {
        const imported = await importFile(file);
        replace(imported.text);
        return notify(imported.note || `Imported ${file.name} as JSON`);
      }
      replace((await file.text()).replace(/^\uFEFF/, ''));
      notify(`Opened ${file.name}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'The file could not be read. Try opening it again.');
    }
  };
  /** Converts pasted YAML, XML, or CSV in Source into JSON (runs in the import worker). */
  const convertSource = async (kind: 'yaml' | 'xml' | 'csv') => {
    try {
      const imported = await importFile(new File([input], `pasted.${kind}`));
      replace(imported.text);
      notify(`${kind.toUpperCase()} converted to JSON. Undo restores the original.`);
    } catch (e) {
      notify(e instanceof Error ? e.message : `The ${kind.toUpperCase()} could not be read.`);
    }
  };
  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return notify('The clipboard is empty.');
      replace(text);
      notify('Pasted from clipboard');
    } catch {
      inputRef.current?.focus();
      notify(`Clipboard access was blocked. Press ${MOD} + V in Source instead.`);
    }
  };
  const reveal = useCallback(
    (path: string) => {
      select(path);
      setMobilePane('input');
      setFocusedPane(null);
      setCollapsed((prev) => prev.filter((pane) => pane !== 'input'));
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    },
    [select],
  );
  const goToError = () => {
    if (!problem) return;
    setMobilePane('input');
    setFocusedPane(null);
    setCollapsed((prev) => prev.filter((pane) => pane !== 'input'));
    requestAnimationFrame(() => {
      const textarea = inputRef.current;
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(problem.offset, Math.min(input.length, problem.offset + 1));
      scrollSource(problem.offset);
    });
  };
  const exportExcel = async (kind: ExportKind) => {
    if ((needsSource(kind) && !entries.length) || exporting) return false;
    setExporting(true);
    try {
      await exportMapping(entries, kind);
      notify(
        kind === 'example-target'
          ? 'Example target downloaded'
          : kind === 'example-mapping'
            ? 'Completed example IRD downloaded'
            : kind === 'samples'
              ? 'Sample mapping downloaded'
              : 'IRD template downloaded',
      );
      return true;
    } catch {
      return false;
    } finally {
      setExporting(false);
    }
  };
  const share = async () => {
    if (!input.trim()) return notify('Add some JSON to share.');
    try {
      const link = await shareLink(output || input);
      if (link.length > MAX_SHARE_LENGTH)
        return notify('Too large for a link. Download the JSON and share the file instead.');
      await copy(link, 'Share link copied. The data travels inside the link only.');
    } catch {
      notify('This browser can’t create share links.');
    }
  };
  // Open a document shared through the URL fragment, then remove it from the address bar.
  const openShared = () => {
    if (!location.hash.startsWith('#json=')) return;
    readShared(location.hash)
      .then((text) => {
        if (text === null) return;
        replace(text);
        notify('Opened shared document. Undo returns to your previous text.');
      })
      .catch(() => notify('This share link is damaged or too large.'))
      .finally(() => window.history.replaceState(null, '', `${location.pathname}#${mode}`));
  };
  const openSharedRef = useRef(openShared);
  openSharedRef.current = openShared;
  useEffect(() => openSharedRef.current(), []);
  const togglePane = (pane: 'graph' | 'table') => {
    if (order.includes(pane)) {
      if (focusedPane === pane) setFocusedPane(null);
      setOrder((prev) => prev.filter((p) => p !== pane));
      if (mobilePane === pane) setMobilePane('paths');
    } else showPane(pane);
  };
  const resetLayout = () => {
    setFocusedPane(null);
    setOrder(DEFAULT_ORDER);
    setCollapsed([]);
    setMobilePane('input');
    document.querySelectorAll<HTMLElement>('[data-pane]').forEach((el) => (el.style.flex = ''));
    notify('Layout reset');
  };
  const openConvert = (format?: Format, path?: string) => {
    setConvertRequest((prev) => ({ nonce: prev.nonce + 1, format, path }));
    convertRef.current?.showModal();
  };
  const switchMode = useCallback((next: Mode) => {
    setModeState(next);
    save('jsonp.mode', next);
    if (location.hash !== `#${next}`) window.history.replaceState(null, '', `#${next}`);
  }, []);
  // Keep the address bar in step with the mode, and follow back/forward or edited hashes.
  useEffect(() => {
    if (!location.hash.startsWith('#json=') && !modeFromHash())
      window.history.replaceState(null, '', `#${mode}`);
    const onHash = () => {
      // A share link pasted into an open tab loads too.
      if (location.hash.startsWith('#json=')) return openSharedRef.current();
      const next = modeFromHash();
      if (next) {
        setModeState(next);
        save('jsonp.mode', next);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openCompare = () => switchMode('compare');
  const focusSearch = (query?: string) => {
    // In Format mode the explorer search lives in the Tree view; Compare has no explorer.
    if (mode === 'workspace') showPane('paths');
    else {
      if (mode === 'compare') switchMode('format');
      setFormatView('tree');
      sessionStorage.setItem('jsonp.formatView', 'tree');
    }
    if (query !== undefined) setSearch(query);
    requestAnimationFrame(() => document.getElementById('explorer-search')?.focus());
  };
  const dismissWelcome = () => {
    setWelcome(false);
    save('jsonp.welcomed', true);
  };
  const resize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const panel = event.currentTarget.parentElement!;
    const neighbor = panel.nextElementSibling as HTMLElement | null;
    if (!neighbor || neighbor.classList.contains('collapsed')) return;
    event.preventDefault();
    resizeCleanup.current?.();
    const startX = event.clientX,
      startWidth = panel.clientWidth,
      neighborWidth = neighbor.clientWidth;
    const total = startWidth + neighborWidth;
    const move = (e: PointerEvent) => {
      const width = Math.max(240, Math.min(total - 240, startWidth + e.clientX - startX));
      panel.style.flex = `0 0 ${width}px`;
      neighbor.style.flex = `0 0 ${total - width}px`;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
      resizeCleanup.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    document.body.style.cursor = 'col-resize';
    resizeCleanup.current = stop;
  };
  const bytes = useMemo(() => new TextEncoder().encode(input).length, [input]);
  const valid = entries.length > 0;
  const outputBody = () =>
    error ? (
      <div className="empty-state error-state" role="alert">
        <AlertCircle size={30} />
        <strong>
          {problem
            ? `Line ${problem.line + 1}, column ${problem.column}`
            : 'One detail needs attention'}
        </strong>
        <p>{problem ? problem.message : error}</p>
        {(problem || repair) && (
          <div className="error-actions">
            {sniffed && (
              <button className="button primary-button" onClick={() => void convertSource(sniffed)}>
                <Sheet size={14} /> Convert {sniffed.toUpperCase()} to JSON
              </button>
            )}
            {problem && (
              <button className="button" onClick={goToError}>
                <Crosshair size={14} /> Go to error
              </button>
            )}
            {repair && (
              <button
                className={`button ${sniffed ? '' : 'primary-button'}`}
                onClick={repairSource}
              >
                <Wrench size={14} /> Repair JSON
              </button>
            )}
          </div>
        )}
        {repair ? (
          <ul className="repair-fixes" aria-label="Repair will">
            {repair.fixes.map((fix) => (
              <li key={fix}>{fix}</li>
            ))}
          </ul>
        ) : (
          <span>Your source is preserved. Fix it to continue.</span>
        )}
      </div>
    ) : output ? (
      <Output output={output} selected={selected} />
    ) : (
      <div className="empty-state">
        <Braces size={30} />
        <strong>{busy ? 'Reading your document…' : 'Room for clarity'}</strong>
        <p>
          {busy
            ? 'Processing locally in the background.'
            : 'Paste JSON to see a neatly formatted view.'}
        </p>
      </div>
    );
  const validateNow = () => {
    if (busy || !current) return notify('Still checking… try again in a moment.');
    if (!input.trim()) return notify('Nothing to validate yet. Paste or open JSON first.');
    if (problem) {
      goToError();
      return notify(
        `Invalid JSON. Line ${problem.line + 1}, column ${problem.column}: ${problem.message}`,
      );
    }
    if (error) return notify(error);
    notify(`Valid JSON · ${entries.length.toLocaleString()} values`);
  };
  const canExtract = valid && !!selected && selected.parts.length > 0;
  // One action list feeds the menus, the command palette, and keyboard shortcuts.
  const actions = {
    open: { label: 'Open file…', icon: <Upload size={15} />, run: () => fileRef.current?.click() },
    paste: {
      label: 'Paste from clipboard',
      icon: <ClipboardPaste size={15} />,
      run: pasteClipboard,
    },
    sample: { label: 'Load sample', icon: <Braces size={15} />, run: () => replace(EXAMPLE) },
    clear: {
      label: 'Clear source',
      icon: <FilePlus2 size={15} />,
      disabled: !input,
      run: () => replace(''),
    },
    format: {
      label: 'Format source',
      icon: <ArrowRight size={15} />,
      hint: `${MOD} Enter`,
      disabled: !output,
      run: formatSource,
    },
    repair: {
      label: 'Repair JSON',
      icon: <Wrench size={15} />,
      disabled: !repair,
      run: repairSource,
    },
    minify: {
      label: 'Minify',
      icon: <Minimize size={15} />,
      disabled: !valid,
      run: () => transform('Minified', (root) => serialize(root, 0)),
    },
    sort: {
      label: 'Sort keys A–Z',
      icon: <ArrowDownAZ size={15} />,
      disabled: !valid,
      run: () => transform('Keys sorted A–Z', (root) => sortKeys(root)),
    },
    nulls: {
      label: 'Remove null values',
      icon: <Eraser size={15} />,
      disabled: !valid,
      run: () => transform('Null values removed', (root) => prune(root)),
    },
    empty: {
      label: 'Remove empty values',
      icon: <Eraser size={15} />,
      disabled: !valid,
      run: () =>
        transform('Nulls, empty strings, and empty containers removed', (root) =>
          prune(root, true),
        ),
    },
    extract: {
      label: 'Keep only the selected value',
      icon: <Scissors size={15} />,
      disabled: !canExtract,
      run: () =>
        transform(`Extracted ${selected ? jsonPath(selected.parts) : ''}`, (root) =>
          selected ? (nodeAt(root, selected.parts) ?? null) : null,
        ),
    },
    escape: {
      label: 'Escape as a JSON string',
      icon: <Quote size={15} />,
      disabled: !valid,
      run: () => transform('Escaped as a string', (root) => escapeJSON(root)),
    },
    unescape: {
      label: 'Unescape JSON string',
      icon: <TextQuote size={15} />,
      disabled: !valid || entries[0]?.type !== 'string',
      run: () =>
        transform('Unescaped', (root) => {
          const inner = unescapeJSON(root);
          if (!inner) notify('Source is a string, but it doesn’t contain JSON.');
          return inner;
        }),
    },
    csv: {
      label: sniffed
        ? `Convert ${sniffed.toUpperCase()} in Source to JSON`
        : 'Convert YAML, XML, or CSV in Source to JSON',
      icon: <Sheet size={15} />,
      keywords: 'yaml xml csv import',
      disabled: !sniffed,
      run: () => {
        if (sniffed) void convertSource(sniffed);
      },
    },
    undo: {
      label: 'Undo last change',
      icon: <Undo2 size={15} />,
      disabled: !undoStack.length,
      run: undo,
    },
    redo: {
      label: 'Redo',
      icon: <Redo2 size={15} />,
      disabled: !redoStack.length,
      run: redo,
    },
    copy: {
      label: 'Copy formatted JSON',
      icon: <Copy size={15} />,
      hint: `${MOD} ⇧ C`,
      disabled: !output,
      run: () => void copy(output, 'Formatted JSON copied'),
    },
    download: {
      label: 'Download JSON',
      icon: <Download size={15} />,
      hint: `${MOD} S`,
      disabled: !output,
      run: () => download(output, 'formatted.json'),
    },
    convert: {
      label: 'Convert to code types or data formats…',
      icon: <Shuffle size={15} />,
      disabled: !valid,
      run: () => openConvert(),
    },
    excel: {
      label: 'Excel IRD workbook…',
      icon: <FileSpreadsheet size={15} />,
      run: () => exportRef.current?.showModal(),
    },
    share: {
      label: 'Copy share link',
      icon: <Link2 size={15} />,
      disabled: !input.trim(),
      run: () => void share(),
    },
  } satisfies Record<string, MenuItem & { hint?: string; keywords?: string }>;
  const commands: Command[] = [
    ...(
      [
        ['File', ['open', 'paste', 'sample', 'clear']],
        [
          'Edit',
          [
            'format',
            'repair',
            'minify',
            'sort',
            'nulls',
            'empty',
            'extract',
            'escape',
            'unescape',
            'csv',
            'undo',
            'redo',
          ],
        ],
        ['Export', ['copy', 'download', 'convert', 'excel', 'share']],
      ] as const
    ).flatMap(([group, ids]) => ids.map((id) => ({ id, group, ...actions[id] }))),
    ...FORMATS.map((format) => ({
      id: `to-${format.id}`,
      group: 'Convert',
      label: `Convert to ${format.id === 'typescript' ? 'TypeScript types' : format.label}`,
      icon: <Shuffle size={15} />,
      keywords: format.description,
      disabled: !valid,
      run: () => openConvert(format.id),
    })),
    ...MODES.map((m) => ({
      id: `mode-${m.id}`,
      group: 'Mode',
      label: m.id === 'compare' ? 'Compare two documents side by side' : `Switch to ${m.label}`,
      icon:
        m.id === 'format' ? (
          <Wand2 size={15} />
        ) : m.id === 'workspace' ? (
          <LayoutPanelLeft size={15} />
        ) : (
          <GitCompareArrows size={15} />
        ),
      keywords: m.id === 'compare' ? 'diff difference' : m.hint,
      disabled: mode === m.id,
      run: () => switchMode(m.id),
    })),
    {
      id: 'validate',
      group: 'Tools',
      label: 'Validate JSON syntax',
      icon: <CheckCircle2 size={15} />,
      keywords: 'check lint',
      run: () => validateNow(),
    },
    {
      id: 'schema',
      group: 'Tools',
      label: 'Validate against a JSON Schema…',
      icon: <ShieldCheck size={15} />,
      keywords: 'schema validation ajv',
      disabled: !valid,
      run: () => schemaRef.current?.showModal(),
    },
    {
      id: 'query',
      group: 'Tools',
      label: 'Search or run a JSONPath query',
      icon: <Search size={15} />,
      hint: `${MOD} F`,
      keywords: 'find filter',
      run: () => focusSearch(),
    },
    {
      id: 'insights',
      group: 'Tools',
      label: 'Document insights',
      icon: <BarChart3 size={15} />,
      keywords: 'stats statistics',
      run: () => insightsRef.current?.showModal(),
    },
    {
      id: 'goto-error',
      group: 'Tools',
      label: 'Go to error',
      icon: <Crosshair size={15} />,
      disabled: !problem,
      run: goToError,
    },
    {
      id: 'table',
      group: 'View',
      label: `${order.includes('table') ? 'Hide' : 'Show'} table`,
      icon: <Table2 size={15} />,
      run: () => togglePane('table'),
    },
    {
      id: 'graph',
      group: 'View',
      label: `${order.includes('graph') ? 'Hide' : 'Show'} graph`,
      icon: <Network size={15} />,
      run: () => togglePane('graph'),
    },
    {
      id: 'wrap',
      group: 'View',
      label: `${wrap ? 'Disable' : 'Enable'} line wrapping`,
      icon: <WrapText size={15} />,
      run: () => setWrap(!wrap),
    },
    {
      id: 'theme',
      group: 'View',
      label: `Use ${theme === 'dark' ? 'light' : 'dark'} theme`,
      icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'layout',
      group: 'View',
      label: 'Reset layout',
      icon: <RotateCcw size={15} />,
      run: resetLayout,
    },
    ...[...INDENTS, { value: '0', label: 'Compact output', indent: 0 as Indent }].map((option) => ({
      id: `indent-${option.value}`,
      group: 'View',
      label: option.indent
        ? `Indent with ${option.label.toLowerCase()}`
        : 'Compact (minified) output',
      icon: <ArrowRight size={15} />,
      run: () => setIndent(option.indent),
    })),
    {
      id: 'remember',
      group: 'Settings',
      label: remember ? 'Stop keeping my draft on this device' : 'Keep my draft on this device',
      icon: <Save size={15} />,
      keywords: 'autosave persist restore',
      run: () => {
        setRemember(!remember);
        notify(
          remember ? 'Draft removed from this device' : 'Your draft will be restored next time',
        );
      },
    },
    {
      id: 'help',
      group: 'Help',
      label: 'How to use JSON Prettify',
      icon: <CircleHelp size={15} />,
      hint: `${MOD} /`,
      keywords: 'guide tutorial shortcuts',
      run: () => helpRef.current?.showModal(),
    },
  ];
  // ---- Format mode: the jsonformatter-style layout ----------------------------------------
  const explorer = (
    <Explorer
      entries={entries}
      active={active}
      section={activeSection}
      select={select}
      copy={copy}
      reveal={reveal}
      value={selected ? input.slice(selected.start, selected.end) : ''}
      query={search}
      setQuery={setSearch}
      source={input}
      onMatches={setGraphMatches}
    />
  );
  const graph = (
    <div className="graph-area">
      <Suspense fallback={<div className="empty-state">Loading graph…</div>}>
        <Graph entries={entries} active={active} select={select} matches={graphMatches} />
      </Suspense>
    </div>
  );
  const sourceEditor = (
    <>
      {!input && (
        <div className="source-start">
          <button className="button" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Open file
          </button>
          <button className="button" onClick={() => void pasteClipboard()}>
            <ClipboardPaste size={15} /> Paste
          </button>
          <button className="button quiet" onClick={() => replace(EXAMPLE)}>
            <Braces size={15} /> Try the sample
          </button>
        </div>
      )}
      <SourceEditor
        ref={inputRef}
        value={input}
        wrap={wrap}
        errorLine={problem?.line}
        onChange={setInput}
        onCursor={cursor}
      />
    </>
  );
  const formatter = (
    <FormatterView
      inputActions={
        <>
          <button title="Open file" aria-label="Open file" onClick={() => fileRef.current?.click()}>
            <Upload size={15} />
          </button>
          <button
            title="Paste from clipboard"
            aria-label="Paste from clipboard"
            onClick={() => void pasteClipboard()}
          >
            <ClipboardPaste size={15} />
          </button>
          <button title="Load sample" aria-label="Load sample" onClick={() => replace(EXAMPLE)}>
            <Braces size={15} />
          </button>
          <button
            title="Toggle line wrapping"
            aria-label="Toggle line wrapping"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText size={15} />
          </button>
          {undoStack.length > 0 && (
            <button title="Undo last replacement" aria-label="Undo last replacement" onClick={undo}>
              <Undo2 size={15} />
            </button>
          )}
          <button
            title="Clear source"
            aria-label="Clear source"
            disabled={!input}
            onClick={() => replace('')}
          >
            <Trash2 size={15} />
          </button>
        </>
      }
      editor={sourceEditor}
      inputFootnote={
        <>
          {problem
            ? `Error on line ${problem.line + 1}, column ${problem.column}`
            : 'Paste or type. Everything stays on this device.'}
          <span>{(bytes / 1024).toFixed(1)} KB</span>
        </>
      }
      actions={
        <>
          <button
            className="button primary-button big-action"
            aria-pressed={indent !== 0}
            onClick={() => {
              setIndent(indent || lastIndent);
              notify('Formatted');
            }}
          >
            <Sparkles size={16} /> Beautify
          </button>
          <label className="indent-control stacked">
            <span>Indent</span>
            <select
              aria-label="Indentation"
              value={indentKey(indent || lastIndent)}
              onChange={(event) =>
                setIndent(INDENTS.find((o) => o.value === event.target.value)?.indent ?? 2)
              }
            >
              {INDENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button big-action"
            aria-pressed={indent === 0}
            onClick={() => {
              setIndent(0);
              notify('Minified');
            }}
          >
            <Minimize size={16} /> Minify
          </button>
          <button className="button big-action" onClick={validateNow}>
            <CheckCircle2 size={16} /> Validate
          </button>
          <button className="button big-action" disabled={!repair} onClick={repairSource}>
            <Wrench size={16} /> Repair
          </button>
          <button className="button big-action" disabled={!valid} onClick={actions.sort.run}>
            <ArrowDownAZ size={16} /> Sort keys
          </button>
          <Menu
            label="Convert"
            icon={<Shuffle size={16} />}
            className="big-menu"
            items={FORMATS.map((format, index) => ({
              label: format.label,
              disabled: !valid,
              separator: index > 0 && FORMATS[index - 1].group !== format.group,
              run: () => openConvert(format.id),
            }))}
          />
          <button
            className="button big-action"
            disabled={!valid}
            onClick={() => schemaRef.current?.showModal()}
          >
            <ShieldCheck size={16} /> Schema
          </button>
          <span className="actions-divider" aria-hidden="true" />
          <button className="button big-action" onClick={openCompare}>
            <GitCompareArrows size={16} /> Compare
          </button>
          <Menu
            label="Export"
            icon={<Download size={16} />}
            className="big-menu"
            items={[
              actions.copy,
              actions.download,
              { ...actions.excel, separator: true },
              { ...actions.share, separator: true },
            ]}
          />
        </>
      }
      outputActions={
        <>
          <button
            title="Use the output as input"
            aria-label="Use the output as input"
            disabled={!output || output === input}
            onClick={() => {
              replace(output);
              notify('Output copied into the input. Undo restores it.');
            }}
          >
            <ArrowLeftToLine size={15} />
          </button>
          <button
            title="Copy formatted JSON"
            aria-label="Copy formatted JSON"
            disabled={!output}
            onClick={() => void copy(output, 'Formatted JSON copied')}
          >
            <Copy size={15} />
          </button>
          <button
            title="Download JSON"
            aria-label="Download JSON"
            disabled={!output}
            onClick={() => download(output, 'formatted.json')}
          >
            <Download size={15} />
          </button>
        </>
      }
      renderView={(view: OutputView) =>
        view === 'code' ? (
          outputBody()
        ) : !valid ? (
          outputBody()
        ) : view === 'tree' ? (
          explorer
        ) : view === 'table' ? (
          <TableView
            entries={entries}
            active={active}
            select={select}
            onConvert={(path) => openConvert('csv', path)}
          />
        ) : (
          graph
        )
      }
      view={formatView}
      onView={setFormatView}
      outputFootnote={
        <>
          {current && result.warnings.length
            ? result.warnings[0]
            : indent === 0
              ? 'Minified · numbers, key order, and escapes preserved.'
              : 'Numbers, key order, and string escapes preserved.'}
          <span>{entries.length.toLocaleString()} values</span>
        </>
      }
    />
  );
  const dialogsOpen = () =>
    [helpRef, paletteRef, exportRef, convertRef, schemaRef, insightsRef].some(
      (ref) => ref.current?.open,
    );
  const latest = useRef({ formatSource, focusSearch, output, copy, mode });
  latest.current = { formatSource, focusSearch, output, copy, mode };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const { formatSource, focusSearch, output, copy } = latest.current;
      if (event.key === 'Escape' && !dialogsOpen()) setFocusedPane(null);
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k' || event.key === '/') {
        event.preventDefault();
        const dialog = key === 'k' ? paletteRef.current : helpRef.current;
        if (dialog?.open) dialog.close();
        else if (!dialogsOpen()) dialog?.showModal();
        return;
      }
      if (dialogsOpen()) return;
      // Compare mode owns Ctrl/⌘+Enter (run the comparison); document shortcuts don't apply there.
      if (latest.current.mode === 'compare') {
        if (event.key === 'Enter') {
          event.preventDefault();
          window.dispatchEvent(new Event('jsonp:compare'));
        }
        return;
      }
      if (event.key === 'Enter' && output) {
        event.preventDefault();
        formatSource();
      } else if (key === 's' && output) {
        event.preventDefault();
        download(output, 'formatted.json');
      } else if (event.shiftKey && key === 'c' && output) {
        event.preventDefault();
        void copy(output, 'Formatted JSON copied');
      } else if (
        key === 'f' &&
        !event.shiftKey &&
        document.activeElement?.id !== 'input-textarea'
      ) {
        event.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const status =
    busy || !current
      ? 'Processing'
      : error
        ? problem
          ? 'Invalid JSON'
          : 'Not processed'
        : input.trim()
          ? 'Valid JSON'
          : 'Empty document';
  return (
    <div
      className="app-shell"
      data-mode={mode}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node))
          setDragOver(false);
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          setDragOver(false);
          void readFile(event.dataTransfer.files[0]);
        }
      }}
    >
      <header className="app-header">
        <a href="/" className="brand" aria-label="JSON Prettify home">
          <span className="brand-mark">
            <Braces size={24} strokeWidth={1.6} />
          </span>
          <span>
            JSON<span className="brand-light"> / prettify</span>
          </span>
        </a>
        <nav className="mode-switch" aria-label="Mode">
          {MODES.map((m) => (
            <a
              key={m.id}
              href={`#${m.id}`}
              title={m.hint}
              aria-current={mode === m.id ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                switchMode(m.id);
              }}
            >
              {m.id === 'format' ? (
                <Wand2 size={15} />
              ) : m.id === 'workspace' ? (
                <LayoutPanelLeft size={15} />
              ) : (
                <GitCompareArrows size={15} />
              )}
              <span>{m.label}</span>
            </a>
          ))}
        </nav>
        <button
          className="palette-button"
          aria-label="Find any action"
          onClick={() => paletteRef.current?.showModal()}
        >
          <Search size={15} />
          <span>Find any action…</span>
          <kbd>{MOD} K</kbd>
        </button>
        <div className="header-actions">
          <span className="local-badge" title="Nothing you paste leaves this browser">
            <span /> On your device
          </span>
          <button
            className="icon-button"
            title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="icon-button help-button"
            title={`Help and shortcuts (${MOD} /)`}
            aria-label="Help and shortcuts"
            onClick={() => helpRef.current?.showModal()}
          >
            <CircleHelp size={17} />
            <span>Help</span>
          </button>
        </div>
      </header>
      {mode === 'workspace' && (
        <section className="workspace-bar" aria-label="Workspace actions">
          <div className="workspace-title">
            <h1>
              Make sense of JSON<span>.</span>
            </h1>
          </div>
          <div className="workspace-actions">
            <Menu
              label="Open"
              icon={<Upload size={15} />}
              items={[
                actions.open,
                actions.paste,
                actions.sample,
                { ...actions.clear, separator: true },
              ]}
            />
            <Menu
              label="Tools"
              icon={<Wrench size={15} />}
              items={[
                actions.format,
                actions.repair,
                actions.minify,
                { ...actions.sort, separator: true },
                actions.nulls,
                actions.empty,
                actions.extract,
                { ...actions.escape, separator: true },
                actions.unescape,
                actions.csv,
                { ...actions.undo, separator: true },
                actions.redo,
                {
                  label: 'Validate against a JSON Schema…',
                  icon: <ShieldCheck size={15} />,
                  disabled: !valid,
                  separator: true,
                  run: () => schemaRef.current?.showModal(),
                },
              ]}
            />
            <button className="button" disabled={!valid} onClick={() => openConvert()}>
              <Shuffle size={15} /> Convert
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <button
              className={`button view-toggle ${order.includes('table') ? 'active' : ''}`}
              aria-pressed={order.includes('table')}
              onClick={() => togglePane('table')}
            >
              <Table2 size={15} /> Table
            </button>
            <button
              className={`button view-toggle ${order.includes('graph') ? 'active' : ''}`}
              aria-pressed={order.includes('graph')}
              onClick={() => togglePane('graph')}
            >
              <Network size={15} /> Graph
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <Menu
              label="Export"
              icon={<Download size={15} />}
              className="export-menu"
              items={[
                actions.copy,
                actions.download,
                { ...actions.convert, label: 'Convert…' },
                { ...actions.excel, separator: true },
                { ...actions.share, separator: true },
              ]}
            />
            <button
              className="icon-button"
              title="Reset layout"
              aria-label="Reset layout"
              onClick={resetLayout}
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </section>
      )}
      {welcome && mode !== 'compare' && (
        <aside className="welcome" aria-label="Getting started">
          <Sparkles size={18} className="welcome-icon" />
          <ol>
            <li>
              <b>1</b> Paste, drop, or open JSON, YAML, XML, CSV, or Excel. Broken JSON gets a
              one-click repair.
            </li>
            <li>
              <b>2</b> Read it as code, a tree, a table, or a graph. Click any value for its path.
            </li>
            <li>
              <b>3</b> Use <em>Workspace</em> for deep exploration and <em>Compare</em> to diff two
              documents.
            </li>
          </ol>
          <span className="welcome-tip">
            Press <kbd>{MOD} K</kbd> to find any action.
          </span>
          <button className="button" onClick={() => helpRef.current?.showModal()}>
            Show me how
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss getting started"
            onClick={dismissWelcome}
          >
            <X size={15} />
          </button>
        </aside>
      )}
      {mode === 'workspace' && (
        <PathBar entry={selected} select={select} reveal={reveal} copy={copy} />
      )}
      <input
        type="file"
        id="open-file-input"
        aria-label="Open a JSON, YAML, XML, CSV, or Excel file"
        accept=".json,.ndjson,.jsonl,.geojson,.txt,.csv,.tsv,.yaml,.yml,.xml,.xlsx,.xls,.ods,application/json,text/csv"
        ref={fileRef}
        hidden
        onChange={(event) => {
          void readFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {mode === 'workspace' && (
        <>
          <nav className="pane-tabs" aria-label="Workspace panes">
            {[...order, ...(['table', 'graph'] as const).filter((p) => !order.includes(p))].map(
              (pane) => (
                <button
                  key={pane}
                  aria-pressed={mobilePane === pane}
                  onClick={() => showPane(pane)}
                >
                  {LABELS[pane]}
                </button>
              ),
            )}
          </nav>
          <main className={`workspace ${focusedPane ? 'focused' : ''}`} aria-label="JSON workspace">
            {order.map((pane, index) => (
              <section
                key={pane}
                data-pane={pane}
                className={`pane ${collapsed.includes(pane) ? 'collapsed' : ''} ${mobilePane === pane ? 'mobile-active' : ''} ${focusedPane === pane ? 'focused-pane' : ''}`}
                aria-label={LABELS[pane]}
              >
                {collapsed.includes(pane) ? (
                  <button
                    className="restore-pane"
                    title={`Expand ${LABELS[pane]}`}
                    aria-label={`Expand ${LABELS[pane]}`}
                    onClick={() => setCollapsed((prev) => prev.filter((p) => p !== pane))}
                  >
                    <ChevronRight size={17} />
                    <span>{LABELS[pane]}</span>
                  </button>
                ) : (
                  <>
                    <div className="pane-heading">
                      <div
                        className="pane-title"
                        draggable
                        onDragStart={(event) => {
                          dragPane.current = pane;
                          event.dataTransfer.setData('text/plain', pane);
                        }}
                        onDragOver={(event) => {
                          if (dragPane.current) event.preventDefault();
                        }}
                        onDrop={(event) => {
                          if (dragPane.current && dragPane.current !== pane) {
                            event.preventDefault();
                            const next = order.filter((p) => p !== dragPane.current);
                            next.splice(next.indexOf(pane), 0, dragPane.current);
                            setOrder(next);
                          }
                          dragPane.current = null;
                        }}
                        onDragEnd={() => {
                          dragPane.current = null;
                        }}
                        title="Drag to reorder"
                      >
                        <GripVertical size={13} />
                        <span className="pane-index">0{index + 1}</span>
                        <h2>{LABELS[pane]}</h2>
                      </div>
                      <div className="pane-heading-actions">
                        {pane === 'output' && (
                          <>
                            <button
                              title="Copy formatted JSON"
                              aria-label="Copy formatted JSON"
                              disabled={!output}
                              onClick={() => void copy(output, 'Formatted JSON copied')}
                            >
                              <Copy size={15} />
                            </button>
                            <button
                              title="Download JSON"
                              aria-label="Download JSON"
                              disabled={!output}
                              onClick={() => download(output, 'formatted.json')}
                            >
                              <Download size={15} />
                            </button>
                          </>
                        )}
                        {pane === 'paths' && (
                          <>
                            <button
                              title="Document insights"
                              aria-label="Document insights"
                              onClick={() => insightsRef.current?.showModal()}
                            >
                              <BarChart3 size={15} />
                            </button>
                            <button
                              title="Export mapping to Excel"
                              aria-label="Export mapping to Excel"
                              onClick={() => exportRef.current?.showModal()}
                            >
                              <FileSpreadsheet size={15} />
                            </button>
                          </>
                        )}
                        <button
                          className="focus-pane-button"
                          title={
                            focusedPane === pane ? 'Restore workspace' : `Focus ${LABELS[pane]}`
                          }
                          aria-label={
                            focusedPane === pane ? 'Restore workspace' : `Focus ${LABELS[pane]}`
                          }
                          onClick={() => {
                            setFocusedPane(focusedPane === pane ? null : pane);
                            setMobilePane(pane);
                          }}
                        >
                          {focusedPane === pane ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>
                        <button
                          title={`Collapse ${LABELS[pane]}`}
                          aria-label={`Collapse ${LABELS[pane]}`}
                          onClick={() => {
                            setFocusedPane(null);
                            setCollapsed((prev) => [...prev, pane]);
                          }}
                        >
                          <Minimize2 size={14} />
                        </button>
                        {(pane === 'graph' || pane === 'table') && (
                          <button
                            title={`Close ${LABELS[pane].toLowerCase()}`}
                            aria-label={`Close ${LABELS[pane].toLowerCase()}`}
                            onClick={() => togglePane(pane)}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {pane === 'input' && (
                      <>
                        <div className="pane-toolbar">
                          <span className="toolbar-label">RAW JSON</span>
                          {repair && (
                            <button
                              className="repair-button"
                              title={repair.fixes.join(' · ')}
                              onClick={repairSource}
                            >
                              <Wrench size={13} /> Repair
                            </button>
                          )}
                          <button
                            title="Toggle line wrapping"
                            aria-label="Toggle line wrapping"
                            aria-pressed={wrap}
                            onClick={() => setWrap(!wrap)}
                          >
                            <WrapText size={15} />
                          </button>
                          {undoStack.length > 0 && (
                            <button
                              title="Undo last replacement"
                              aria-label="Undo last replacement"
                              onClick={undo}
                            >
                              <Undo2 size={15} />
                            </button>
                          )}
                          {redoStack.length > 0 && (
                            <button title="Redo" aria-label="Redo" onClick={redo}>
                              <Redo2 size={15} />
                            </button>
                          )}
                          <button
                            title="Clear source"
                            aria-label="Clear source"
                            disabled={!input}
                            onClick={() => replace('')}
                          >
                            <Trash2 size={15} />
                          </button>
                          <button
                            className="format-button"
                            disabled={!output}
                            onClick={formatSource}
                          >
                            Format <ArrowRight size={13} />
                          </button>
                        </div>
                        {!input && (
                          <div className="source-start">
                            <button className="button" onClick={() => fileRef.current?.click()}>
                              <Upload size={15} /> Open file
                            </button>
                            <button className="button" onClick={() => void pasteClipboard()}>
                              <ClipboardPaste size={15} /> Paste
                            </button>
                            <button className="button quiet" onClick={() => replace(EXAMPLE)}>
                              <Braces size={15} /> Try the sample
                            </button>
                          </div>
                        )}
                        <SourceEditor
                          ref={inputRef}
                          value={input}
                          wrap={wrap}
                          errorLine={problem?.line}
                          onChange={setInput}
                          onCursor={cursor}
                        />
                        <div className="pane-footnote">
                          {problem
                            ? `Error on line ${problem.line + 1}, column ${problem.column}`
                            : 'Tab indents. Edits validate as you type.'}
                          <span>{(bytes / 1024).toFixed(1)} KB</span>
                        </div>
                      </>
                    )}
                    {pane === 'output' && (
                      <>
                        <div className="pane-toolbar">
                          <label className="indent-control">
                            Indent{' '}
                            <select
                              aria-label="Indentation"
                              value={indentKey(indent)}
                              onChange={(event) =>
                                setIndent(
                                  INDENTS.find((o) => o.value === event.target.value)?.indent ?? 0,
                                )
                              }
                            >
                              {INDENTS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                              <option value="0">Compact</option>
                            </select>
                          </label>
                          <span
                            className="toolbar-label output-path"
                            title={selected ? jsonPath(selected.parts) : ''}
                          >
                            {selected ? jsonPath(selected.parts) : 'LOSSLESS FORMATTING'}
                          </span>
                        </div>
                        {outputBody()}
                        <div className="pane-footnote">
                          {current && result.warnings.length
                            ? result.warnings[0]
                            : 'Numbers, key order, and string escapes preserved.'}
                        </div>
                      </>
                    )}
                    {pane === 'paths' && (
                      <Explorer
                        entries={entries}
                        active={active}
                        section={activeSection}
                        select={select}
                        copy={copy}
                        reveal={reveal}
                        value={selected ? input.slice(selected.start, selected.end) : ''}
                        query={search}
                        setQuery={setSearch}
                        source={input}
                        onMatches={setGraphMatches}
                      />
                    )}
                    {pane === 'table' && (
                      <TableView
                        entries={entries}
                        active={active}
                        select={select}
                        onConvert={(path) => openConvert('csv', path)}
                      />
                    )}
                    {pane === 'graph' && (
                      <div className="graph-area">
                        <Suspense fallback={<div className="empty-state">Loading graph…</div>}>
                          <Graph
                            entries={entries}
                            active={active}
                            select={select}
                            matches={graphMatches}
                          />
                        </Suspense>
                      </div>
                    )}
                    {index < order.length - 1 && (
                      <button
                        className="pane-resizer"
                        aria-label={`Resize ${LABELS[pane]}`}
                        title="Drag to resize; double-click to reset"
                        onPointerDown={resize}
                        onDoubleClick={resetLayout}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                            event.preventDefault();
                            const panel = event.currentTarget.parentElement!;
                            panel.style.flex = `0 0 ${Math.max(240, panel.clientWidth + (event.key === 'ArrowRight' ? 30 : -30))}px`;
                          }
                        }}
                      />
                    )}
                  </>
                )}
              </section>
            ))}
          </main>
        </>
      )}
      {mode === 'format' && formatter}
      {mode === 'compare' && (
        <Suspense fallback={<div className="empty-state">Loading compare…</div>}>
          <CompareView
            initialLeft={input}
            notify={notify}
            copy={copy}
            onOpenInWorkspace={(text) => {
              replace(text);
              switchMode('workspace');
            }}
          />
        </Suspense>
      )}
      <footer className="status-bar">
        <div
          className="status"
          data-state={error ? 'error' : busy ? 'busy' : input.trim() ? 'valid' : 'empty'}
        >
          <span />
          <b>{status}</b>
        </div>
        <div className="document-stats">
          <span>{(bytes / 1024).toFixed(1)} KB</span>
          <button
            className="stats-button"
            title="Document insights"
            onClick={() => insightsRef.current?.showModal()}
          >
            {entries.length.toLocaleString()} values
          </button>
          {selected && (
            <code title={selected.path}>
              {' '}
              {selected.path || 'document'} · {activeSection}
            </code>
          )}
        </div>
        <span className="footer-hint">
          {remember && (
            <>
              <Save size={11} /> Draft kept on this device <span>·</span>{' '}
            </>
          )}
          {MOD} K finds any action <span>·</span> {MOD} Enter formats
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <Upload size={40} />
          <strong>Drop your file here</strong>
          <span>JSON or CSV · up to 5 MiB · processed locally</span>
        </div>
      )}
      <ExportDialog
        dialogRef={exportRef}
        count={entries.length}
        busy={exporting}
        onExport={exportExcel}
      />
      <CommandPalette dialogRef={paletteRef} commands={commands} />
      <HelpDialog
        dialogRef={helpRef}
        onSample={() => {
          replace(EXAMPLE);
          dismissWelcome();
        }}
        onQuery={(query) => {
          if (getTree() === null || !entries.length) replace(EXAMPLE);
          focusSearch(query);
        }}
      />
      <ConvertDialog
        dialogRef={convertRef}
        tree={getTree}
        selected={selected}
        entryAt={(path) => entryMap.get(path)}
        request={convertRequest}
        copy={copy}
      />
      <SchemaDialog
        dialogRef={schemaRef}
        source={input}
        tree={getTree}
        entryAt={(path) => entryMap.get(path)}
        select={select}
        notify={notify}
      />
      <Insights dialogRef={insightsRef} entries={entries} bytes={bytes} select={select} />
    </div>
  );
}
