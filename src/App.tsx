import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import Explorer from './components/Explorer';
import TableView from './components/TableView';
import ExportDialog from './components/ExportDialog';
import CommandPalette from './components/CommandPalette';
import HelpDialog from './components/HelpDialog';
import ConvertDialog, { type ConvertRequest } from './components/ConvertDialog';
import SchemaDialog from './components/SchemaDialog';
import Insights from './components/Insights';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import Toast from './components/Toast';
import Welcome from './components/Welcome';
import FormatMode, { savedOutputView } from './components/FormatMode';
import WorkspaceMode from './components/WorkspaceMode';
import { download } from './lib/export';
import type { Format } from './lib/convert';
import { createActions } from './actions';
import type { AppContext, OutputView } from './context';
import { initialMode, modeFromHash, save, type Mode } from './state/prefs';
import { useDocument } from './state/useDocument';
import { useSettings } from './state/useSettings';
import { useToast } from './state/useToast';
import { useLayout } from './state/useLayout';
import { useDialogs } from './state/useDialogs';
import { useEditor } from './state/useEditor';
import { useIO } from './state/useIO';

const Graph = lazy(() => import('./components/Graph'));
const CompareView = lazy(() => import('./components/CompareView'));

export default function App() {
  const doc = useDocument();
  const settings = useSettings(doc.input);
  const layout = useLayout();
  const dialogs = useDialogs();
  const { toast, notify, dismiss, hold, release } = useToast();
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [formatView, setFormatViewState] = useState<OutputView>(savedOutputView);
  const [search, setSearch] = useState('');
  const [graphMatches, setGraphMatches] = useState<ReadonlySet<string> | null>(null);
  const [convertRequest, setConvertRequest] = useState<ConvertRequest>({ nonce: 0 });
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // A change that replaced the source offers Undo (and then Redo) in its toast. The offer lapses
  // once a newer replacement, undo, or redo has happened, so it can never revert the wrong change.
  const history = useRef(doc);
  history.current = doc;
  const announce = useCallback(
    (message: string) => {
      const stamp = history.current.revision.current;
      const superseded = () =>
        notify('Newer changes exist. Use Undo in the toolbar to step back through them.');
      notify(message, {
        label: 'Undo',
        run: () => {
          const current = history.current;
          if (current.revision.current !== stamp) return superseded();
          if (!current.undo()) return;
          const after = current.revision.current;
          notify('Undone', {
            label: 'Redo',
            run: () => {
              if (history.current.revision.current !== after) return superseded();
              if (history.current.redo()) notify('Redone');
            },
          });
        },
      });
    },
    [notify],
  );

  const editor = useEditor({ doc, layout, notify, announce });
  const io = useIO({ doc, notify, announce, mode, inputRef: editor.inputRef });

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
      if (location.hash.startsWith('#json=')) return io.openSharedRef.current();
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

  const setFormatView = useCallback((view: OutputView) => {
    setFormatViewState(view);
    sessionStorage.setItem('jsonp.formatView', view);
  }, []);
  const focusSearch = (query?: string) => {
    // In Format mode the explorer search lives in the Tree view; Compare has no explorer.
    if (mode === 'workspace') layout.show('paths');
    else {
      if (mode === 'compare') switchMode('format');
      setFormatView('tree');
    }
    if (query !== undefined) setSearch(query);
    requestAnimationFrame(() => document.getElementById('explorer-search')?.focus());
  };
  const openConvert = (format?: Format, path?: string) => {
    setConvertRequest((prev) => ({ nonce: prev.nonce + 1, format, path }));
    dialogs.open('convert');
  };

  const { actions, commands, toggleTheme } = createActions({
    doc,
    io,
    settings,
    layout,
    editor,
    dialogs,
    mode,
    switchMode,
    notify,
    announce,
    fileRef,
    openConvert,
    focusSearch,
  });

  // Keyboard shortcuts read the latest state through a ref, so the listener is attached once.
  const latest = useRef({ editor, focusSearch, doc, io, mode });
  latest.current = { editor, focusSearch, doc, io, mode };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const { editor, focusSearch, doc, io, mode } = latest.current;
      if (event.key === 'Escape' && !dialogs.anyOpen()) layout.setFocused(null);
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k' || event.key === '/') {
        event.preventDefault();
        const dialog = dialogs.refs[key === 'k' ? 'palette' : 'help'].current;
        if (dialog?.open) dialog.close();
        else if (!dialogs.anyOpen()) dialog?.showModal();
        return;
      }
      if (dialogs.anyOpen()) return;
      // Compare mode owns Ctrl/⌘+Enter (run the comparison); document shortcuts don't apply there.
      if (mode === 'compare') {
        if (event.key === 'Enter') {
          event.preventDefault();
          window.dispatchEvent(new Event('jsonp:compare'));
        }
        return;
      }
      if (event.key === 'Enter' && doc.output) {
        event.preventDefault();
        editor.formatSource();
      } else if (key === 's' && doc.output) {
        event.preventDefault();
        download(doc.output, 'formatted.json');
      } else if (event.shiftKey && key === 'c' && doc.output) {
        event.preventDefault();
        void io.copy(doc.output, 'Formatted JSON copied');
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

  const { input, entries, selected } = doc;
  const views: AppContext['views'] = {
    explorer: (
      <Explorer
        entries={entries}
        active={doc.active}
        section={doc.activeSection}
        select={editor.select}
        copy={io.copy}
        reveal={editor.reveal}
        value={selected ? input.slice(selected.start, selected.end) : ''}
        query={search}
        setQuery={setSearch}
        source={input}
        onMatches={setGraphMatches}
      />
    ),
    table: (
      <TableView
        entries={entries}
        active={doc.active}
        select={editor.select}
        onConvert={(path) => openConvert('csv', path)}
      />
    ),
    graph: (
      <div className="graph-area">
        <Suspense fallback={<div className="empty-state">Loading graph…</div>}>
          <Graph
            entries={entries}
            active={doc.active}
            select={editor.select}
            matches={graphMatches}
          />
        </Suspense>
      </div>
    ),
  };
  const app: AppContext = {
    doc,
    io,
    settings,
    layout,
    editor,
    dialogs,
    mode,
    switchMode,
    notify,
    announce,
    fileRef,
    openConvert,
    focusSearch,
    actions,
    formatView,
    setFormatView,
    views,
  };

  const state = doc.error ? 'error' : doc.busy ? 'busy' : input.trim() ? 'valid' : 'empty';
  const status =
    doc.busy || !doc.current
      ? 'Processing'
      : doc.error
        ? doc.problem
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
          void io.readFile(event.dataTransfer.files[0]);
        }
      }}
    >
      <Header
        mode={mode}
        onMode={switchMode}
        theme={settings.theme}
        onTheme={toggleTheme}
        onPalette={() => dialogs.open('palette')}
        onHelp={() => dialogs.open('help')}
      />
      {settings.welcome && mode !== 'compare' && (
        <Welcome onHelp={() => dialogs.open('help')} onDismiss={settings.dismissWelcome} />
      )}
      <input
        type="file"
        id="open-file-input"
        aria-label="Open a JSON, YAML, XML, CSV, or Excel file"
        accept=".json,.ndjson,.jsonl,.geojson,.txt,.csv,.tsv,.yaml,.yml,.xml,.xlsx,.xls,.ods,application/json,text/csv"
        ref={fileRef}
        hidden
        onChange={(event) => {
          void io.readFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {mode === 'workspace' && <WorkspaceMode app={app} />}
      {mode === 'format' && <FormatMode app={app} />}
      {mode === 'compare' && (
        <Suspense fallback={<div className="empty-state">Loading compare…</div>}>
          <CompareView
            initialLeft={input}
            notify={notify}
            copy={io.copy}
            onOpenInWorkspace={(text) => {
              doc.replace(text);
              switchMode('workspace');
              announce('Opened in Workspace');
            }}
          />
        </Suspense>
      )}
      <StatusBar
        status={status}
        state={state}
        bytes={doc.bytes}
        values={entries.length}
        selected={selected}
        section={doc.activeSection}
        remembered={settings.remember}
        onInsights={() => dialogs.open('insights')}
        onStatus={doc.problem ? editor.goToError : undefined}
      />
      <Toast toast={toast} onDismiss={dismiss} onHold={hold} onRelease={release} />
      {dragOver && (
        <div className="drop-overlay">
          <Upload size={36} />
          <strong>Drop your file to open it</strong>
          <span>JSON, YAML, XML, CSV, or Excel, up to 5 MiB. Processed on this device.</span>
        </div>
      )}
      <ExportDialog
        dialogRef={dialogs.refs.export}
        count={entries.length}
        busy={io.exporting}
        onExport={io.exportExcel}
      />
      <CommandPalette dialogRef={dialogs.refs.palette} commands={commands} />
      <HelpDialog
        dialogRef={dialogs.refs.help}
        onSample={() => {
          actions.sample.run();
          settings.dismissWelcome();
        }}
        onQuery={(query) => {
          if (doc.getTree() === null || !entries.length) actions.sample.run();
          focusSearch(query);
        }}
      />
      <ConvertDialog
        dialogRef={dialogs.refs.convert}
        tree={doc.getTree}
        selected={selected}
        entryAt={(path) => doc.entryMap.get(path)}
        request={convertRequest}
        copy={io.copy}
      />
      <SchemaDialog
        dialogRef={dialogs.refs.schema}
        source={input}
        tree={doc.getTree}
        entryAt={(path) => doc.entryMap.get(path)}
        select={editor.select}
        notify={notify}
      />
      <Insights
        dialogRef={dialogs.refs.insights}
        entries={entries}
        bytes={doc.bytes}
        select={editor.select}
      />
    </div>
  );
}
