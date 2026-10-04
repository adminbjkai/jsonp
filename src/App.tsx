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
  Keyboard,
  FileSpreadsheet,
  Check,
  ChevronRight,
  WrapText,
  Undo2,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { EXAMPLE, MAX_INPUT, jsonPath, type DocumentResult } from './json';
import { download, exportMapping } from './export';
import Explorer from './Explorer';
import Output from './Output';
import PathBar from './PathBar';
import ExportDialog from './ExportDialog';
import { needsSource, type ExportKind } from './ird';
const Graph = lazy(() => import('./Graph'));
type Pane = 'input' | 'output' | 'paths' | 'graph';
const DEFAULT_ORDER: Pane[] = ['input', 'output', 'paths'];
const LABELS: Record<Pane, string> = {
  input: 'Source',
  output: 'Formatted',
  paths: 'Explorer',
  graph: 'Graph',
};
const EMPTY: DocumentResult = { output: '', entries: [], warnings: [], error: null };
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
    value.length <= 4 &&
    new Set(value).size === value.length &&
    DEFAULT_ORDER.every((p) => value.includes(p)) &&
    value.every((p) => typeof p === 'string' && Object.hasOwn(LABELS, p))
    ? (value as Pane[])
    : DEFAULT_ORDER;
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferences are optional in private browsing. */
  }
}
export default function App() {
  const [input, setInput] = useState(EXAMPLE);
  const [result, setResult] = useState<DocumentResult>(EMPTY);
  const [processedInput, setProcessedInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [indent, setIndent] = useState(2);
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
  const [undo, setUndo] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null),
    dragPane = useRef<Pane | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = processedInput === input && !busy;
  const entries = current ? result.entries : [];
  const output = current ? result.output : '';
  const error = current ? result.error : null;
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const selected = active !== null ? entryMap.get(active) : undefined;
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(''), 3000);
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
  useEffect(() => {
    setBusy(true);
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      worker = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' });
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
  const select = useCallback(
    (path: string) => {
      const entry = entryMap.get(path);
      if (!entry) return;
      setActive(path);
      setActiveSection('value');
      const textarea = inputRef.current;
      if (textarea) {
        textarea.setSelectionRange(entry.start, entry.end);
        textarea.scrollTop = Math.max(
          0,
          (input.slice(0, entry.start).match(/\n/g)?.length || 0) * 22 - textarea.clientHeight / 3,
        );
      }
    },
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
  const replace = (text: string) => {
    setUndo(input);
    setActive(null);
    setInput(text);
  };
  const formatSource = () => {
    if (output) {
      replace(output);
      notify('Source formatted');
    }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_INPUT) {
      notify('Choose a JSON file smaller than 5 MiB.');
      return;
    }
    try {
      replace((await file.text()).replace(/^\uFEFF/, ''));
      notify(`Opened ${file.name}`);
    } catch {
      notify('The file could not be read. Try opening it again.');
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
  const toggleGraph = () => {
    if (focusedPane === 'graph') setFocusedPane(null);
    setOrder((prev) =>
      prev.includes('graph') ? prev.filter((p) => p !== 'graph') : [...prev, 'graph'],
    );
    setCollapsed((prev) => prev.filter((p) => p !== 'graph'));
    if (mobilePane === 'graph') setMobilePane('paths');
  };
  const resetLayout = () => {
    setFocusedPane(null);
    setOrder(DEFAULT_ORDER);
    setCollapsed([]);
    setMobilePane('input');
    document.querySelectorAll<HTMLElement>('[data-pane]').forEach((el) => (el.style.flex = ''));
    notify('Layout reset');
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
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !helpRef.current?.open) setFocusedPane(null);
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '/') {
        event.preventDefault();
        if (helpRef.current?.open) helpRef.current.close();
        else helpRef.current?.showModal();
      }
      if (event.key === 'Enter' && output) {
        event.preventDefault();
        setUndo(input);
        setInput(output);
      }
      if (event.key.toLowerCase() === 's' && output) {
        event.preventDefault();
        download(output, 'formatted.json');
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c' && output) {
        event.preventDefault();
        void copy(output, 'Formatted JSON copied');
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [input, output, copy]);
  const bytes = useMemo(() => new TextEncoder().encode(input).length, [input]);
  const status =
    busy || !current
      ? 'Processing'
      : error
        ? 'Invalid JSON'
        : input.trim()
          ? 'Valid JSON'
          : 'Empty document';
  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
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
        <span className="header-note">A little clarity for your data.</span>
        <div className="header-actions">
          <span className="local-badge">
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
            className="icon-button"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => helpRef.current?.showModal()}
          >
            <Keyboard size={17} />
          </button>
        </div>
      </header>
      <section className="workspace-bar" aria-label="Workspace actions">
        <div className="workspace-title">
          <span className="eyebrow">WORKSPACE / 01</span>
          <h1>
            Make sense of JSON<span>.</span>
          </h1>
        </div>
        <div className="workspace-actions">
          <button className="button" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Open file
          </button>
          <button className="button quiet" onClick={() => replace(EXAMPLE)}>
            <Braces size={15} /> Sample
          </button>
          <button
            className={`button ${order.includes('graph') ? 'active' : ''}`}
            aria-pressed={order.includes('graph')}
            onClick={toggleGraph}
          >
            <Network size={15} /> Graph
          </button>
          <button
            className="button export-workspace-button"
            onClick={() => exportRef.current?.showModal()}
          >
            <FileSpreadsheet size={15} /> Export XLSX
          </button>
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
      <PathBar entry={selected} select={select} reveal={reveal} copy={copy} />
      <input
        type="file"
        accept=".json,.txt,application/json"
        ref={fileRef}
        hidden
        onChange={(event) => {
          void readFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <nav className="pane-tabs" aria-label="Workspace panes">
        {order.map((pane) => (
          <button
            key={pane}
            aria-pressed={mobilePane === pane}
            onClick={() => {
              setMobilePane(pane);
              setFocusedPane(null);
              setCollapsed((prev) => prev.filter((p) => p !== pane));
            }}
          >
            {LABELS[pane]}
          </button>
        ))}
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
                      <button
                        title="Export mapping to Excel"
                        aria-label="Export mapping to Excel"
                        onClick={() => exportRef.current?.showModal()}
                      >
                        <FileSpreadsheet size={15} />
                      </button>
                    )}
                    <button
                      className="focus-pane-button"
                      title={focusedPane === pane ? 'Restore workspace' : `Focus ${LABELS[pane]}`}
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
                    {pane === 'graph' && (
                      <button title="Close graph" aria-label="Close graph" onClick={toggleGraph}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {pane === 'input' && (
                  <>
                    <div className="pane-toolbar">
                      <span className="toolbar-label">RAW JSON</span>
                      <button
                        title="Toggle line wrapping"
                        aria-label="Toggle line wrapping"
                        aria-pressed={wrap}
                        onClick={() => setWrap(!wrap)}
                      >
                        <WrapText size={15} />
                      </button>
                      {undo !== null && (
                        <button
                          title="Undo last replacement"
                          aria-label="Undo last replacement"
                          onClick={() => {
                            setInput(undo);
                            setUndo(null);
                          }}
                        >
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
                      <button className="format-button" disabled={!output} onClick={formatSource}>
                        Format <ArrowRight size={13} />
                      </button>
                    </div>
                    <textarea
                      ref={inputRef}
                      id="input-textarea"
                      className="source-editor"
                      aria-label="JSON source"
                      placeholder={
                        'Paste JSON here, or drop a file.\n\nEverything stays on your device.'
                      }
                      value={input}
                      wrap={wrap ? 'soft' : 'off'}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoComplete="off"
                      onChange={(event) => setInput(event.target.value)}
                      onSelect={cursor}
                      onClick={cursor}
                      onKeyUp={cursor}
                    />
                    <div className="pane-footnote">
                      Edit freely. We’ll validate as you go.<span>JSON</span>
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
                          value={indent}
                          onChange={(event) => setIndent(Number(event.target.value))}
                        >
                          <option value={2}>2 spaces</option>
                          <option value={4}>4 spaces</option>
                          <option value={0}>Compact</option>
                        </select>
                      </label>
                      <span
                        className="toolbar-label output-path"
                        title={selected ? jsonPath(selected.parts) : ''}
                      >
                        {selected ? jsonPath(selected.parts) : 'LOSSLESS FORMATTING'}
                      </span>
                    </div>
                    {error ? (
                      <div className="empty-state error-state" role="alert">
                        <AlertCircle size={30} />
                        <strong>One detail needs attention</strong>
                        <p>{error}</p>
                        <span>Your source is preserved. Fix it to continue.</span>
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
                    )}
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
                  />
                )}
                {pane === 'graph' && (
                  <div className="graph-area">
                    <Suspense fallback={<div className="empty-state">Loading graph…</div>}>
                      <Graph entries={entries} active={active} select={select} />
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
          <span>{entries.length.toLocaleString()} values</span>
          {selected && (
            <code title={selected.path}>
              {' '}
              {selected.path || 'document'} · {activeSection}
            </code>
          )}
        </div>
        <span className="footer-hint">
          Drag headers to arrange <span>·</span> Ctrl / ⌘ + Enter to format
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
          <strong>Drop your JSON here</strong>
          <span>One file · up to 5 MiB · processed locally</span>
        </div>
      )}
      <ExportDialog
        dialogRef={exportRef}
        count={entries.length}
        busy={exporting}
        onExport={exportExcel}
      />
      <dialog
        ref={helpRef}
        className="shortcuts-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) helpRef.current?.close();
        }}
      >
        <div className="dialog-heading">
          <h2>A few useful shortcuts</h2>
          <button aria-label="Close shortcuts" onClick={() => helpRef.current?.close()}>
            <X size={18} />
          </button>
        </div>
        <p>Use Ctrl on Windows / Linux, or ⌘ on Mac.</p>
        {[
          ['Enter', 'Format source'],
          ['Shift + C', 'Copy formatted JSON'],
          ['S', 'Download JSON'],
          ['/', 'Show or hide this panel'],
        ].map(([keys, description]) => (
          <div className="shortcut" key={keys}>
            <span>{description}</span>
            <kbd>Ctrl / ⌘ + {keys}</kbd>
          </div>
        ))}
        <div className="dialog-tip">
          Drag pane headers to reorder. Drag dividers to resize, or use arrow keys when a divider is
          focused. Double-click an explorer value to copy its pointer. Use the graph controls to
          zoom and fit.
        </div>
      </dialog>
    </div>
  );
}
