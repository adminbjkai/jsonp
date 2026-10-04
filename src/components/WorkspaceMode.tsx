import { useEffect, useRef, type PointerEvent } from 'react';
import {
  BarChart3,
  ChevronRight,
  ChevronsRightLeft,
  Copy,
  Download,
  FileSpreadsheet,
  GripVertical,
  Maximize2,
  Minimize2,
  Network,
  Redo2,
  RotateCcw,
  Shuffle,
  Table2,
  Trash2,
  Undo2,
  Upload,
  Wrench,
  WrapText,
  X,
} from 'lucide-react';
import Menu from './Menu';
import OutputBody from './OutputBody';
import PathBar from './PathBar';
import SourcePane from './SourcePane';
import { download } from '../lib/export';
import { INDENTS, indentKey } from '../actions';
import type { AppContext } from '../context';
import { MOD } from '../state/prefs';
import { PANE_LABELS, type Pane } from '../state/useLayout';

const MIN_PANE = 240;

/** Source, Formatted, Explorer, Table, and Graph side by side: draggable, resizable, collapsible. */
export default function WorkspaceMode({ app }: { app: AppContext }) {
  const { doc, editor, io, actions, settings, layout, dialogs, notify, views } = app;
  const { order, collapsed, focused, mobilePane } = layout;
  const { selected, input, output, repair, valid } = doc;
  const dragPane = useRef<Pane | null>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanup.current?.(), []);

  const resize = (event: PointerEvent<HTMLButtonElement>) => {
    const panel = event.currentTarget.parentElement!;
    const neighbor = panel.nextElementSibling as HTMLElement | null;
    if (!neighbor || neighbor.classList.contains('collapsed')) return;
    event.preventDefault();
    resizeCleanup.current?.();
    const startX = event.clientX,
      startWidth = panel.clientWidth,
      total = startWidth + neighbor.clientWidth;
    const move = (e: globalThis.PointerEvent) => {
      const width = Math.max(MIN_PANE, Math.min(total - MIN_PANE, startWidth + e.clientX - startX));
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
  const resetLayout = () => {
    layout.reset();
    notify('Layout reset');
  };

  const paneActions = (pane: Pane) => (
    <>
      {pane === 'input' && (
        <>
          {repair && (
            <button
              className="repair-button"
              title={repair.fixes.join('; ')}
              onClick={editor.repairSource}
            >
              <Wrench size={13} /> Repair
            </button>
          )}
          <button
            title="Toggle line wrapping"
            aria-label="Toggle line wrapping"
            aria-pressed={settings.wrap}
            onClick={() => settings.setWrap(!settings.wrap)}
          >
            <WrapText size={15} />
          </button>
          {doc.canUndo && (
            <button
              title="Undo last replacement"
              aria-label="Undo last replacement"
              onClick={actions.undo.run}
            >
              <Undo2 size={15} />
            </button>
          )}
          {doc.canRedo && (
            <button title="Redo" aria-label="Redo" onClick={actions.redo.run}>
              <Redo2 size={15} />
            </button>
          )}
          <button
            title="Clear source"
            aria-label="Clear source"
            disabled={!input}
            onClick={actions.clear.run}
          >
            <Trash2 size={15} />
          </button>
          <button
            className="format-button"
            title={`Format source (${MOD} Enter)`}
            disabled={!output}
            onClick={editor.formatSource}
          >
            Format
          </button>
        </>
      )}
      {pane === 'output' && (
        <>
          <label className="indent-control">
            <span className="sr-only">Indent</span>
            <select
              aria-label="Indentation"
              value={indentKey(doc.indent)}
              onChange={(event) =>
                doc.setIndent(INDENTS.find((o) => o.value === event.target.value)?.indent ?? 0)
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
          <button
            title="Copy formatted JSON"
            aria-label="Copy formatted JSON"
            disabled={!output}
            onClick={actions.copy.run}
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
            onClick={() => dialogs.open('insights')}
          >
            <BarChart3 size={15} />
          </button>
          <button
            title="Export mapping to Excel"
            aria-label="Export mapping to Excel"
            onClick={() => dialogs.open('export')}
          >
            <FileSpreadsheet size={15} />
          </button>
        </>
      )}
      <button
        className="focus-pane-button"
        title={focused === pane ? 'Restore workspace' : `Focus ${PANE_LABELS[pane]}`}
        aria-label={focused === pane ? 'Restore workspace' : `Focus ${PANE_LABELS[pane]}`}
        onClick={() => {
          layout.setFocused(focused === pane ? null : pane);
          layout.setMobilePane(pane);
        }}
      >
        {focused === pane ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      <button
        className="collapse-pane-button"
        title={`Collapse ${PANE_LABELS[pane]}`}
        aria-label={`Collapse ${PANE_LABELS[pane]}`}
        onClick={() => {
          layout.setFocused(null);
          layout.setCollapsed((prev) => [...prev, pane]);
        }}
      >
        <ChevronsRightLeft size={14} />
      </button>
      {(pane === 'graph' || pane === 'table') && (
        <button
          title={`Close ${PANE_LABELS[pane].toLowerCase()}`}
          aria-label={`Close ${PANE_LABELS[pane].toLowerCase()}`}
          onClick={() => layout.toggle(pane)}
        >
          <X size={14} />
        </button>
      )}
    </>
  );

  const paneBody = (pane: Pane) => {
    switch (pane) {
      case 'input':
        return (
          <>
            <SourcePane
              doc={doc}
              editor={editor}
              wrap={settings.wrap}
              onOpen={actions.open.run}
              onPaste={actions.paste.run}
            />
            <div className="pane-footnote">
              <span>
                {doc.problem
                  ? `Error on line ${doc.problem.line + 1}, column ${doc.problem.column}`
                  : 'Tab indents. Edits validate as you type.'}
              </span>
              <span>{(doc.bytes / 1024).toFixed(1)} KB</span>
            </div>
          </>
        );
      case 'output':
        return (
          <>
            <OutputBody
              doc={doc}
              editor={editor}
              onConvertSource={(kind) => void io.convertSource(kind)}
            />
            <div className="pane-footnote">
              <span>
                {doc.warnings.length
                  ? doc.warnings[0]
                  : 'Numbers, key order, and string escapes preserved.'}
              </span>
            </div>
          </>
        );
      case 'paths':
        return views.explorer;
      case 'table':
        return views.table;
      case 'graph':
        return views.graph;
    }
  };

  return (
    <>
      <section className="workspace-bar" aria-label="Workspace actions">
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
            { ...actions.schema, separator: true },
          ]}
        />
        <button className="button" disabled={!valid} onClick={actions.convert.run}>
          <Shuffle size={15} /> Convert
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button
          className={`button view-toggle ${order.includes('table') ? 'active' : ''}`}
          aria-pressed={order.includes('table')}
          onClick={() => layout.toggle('table')}
        >
          <Table2 size={15} /> Table
        </button>
        <button
          className={`button view-toggle ${order.includes('graph') ? 'active' : ''}`}
          aria-pressed={order.includes('graph')}
          onClick={() => layout.toggle('graph')}
        >
          <Network size={15} /> Graph
        </button>
        <span className="toolbar-spacer" />
        <Menu
          label="Export"
          icon={<Download size={15} />}
          className="export-menu"
          items={[
            actions.copy,
            actions.copyMinified,
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
      </section>
      <PathBar entry={selected} select={editor.select} reveal={editor.reveal} copy={io.copy} />
      <nav className="pane-tabs" aria-label="Workspace panes">
        {[...order, ...(['table', 'graph'] as const).filter((p) => !order.includes(p))].map(
          (pane) => (
            <button key={pane} aria-pressed={mobilePane === pane} onClick={() => layout.show(pane)}>
              {PANE_LABELS[pane]}
            </button>
          ),
        )}
      </nav>
      <main className={`workspace ${focused ? 'focused' : ''}`} aria-label="JSON workspace">
        {order.map((pane, index) => (
          <section
            key={pane}
            data-pane={pane}
            className={`pane ${collapsed.includes(pane) ? 'collapsed' : ''} ${mobilePane === pane ? 'mobile-active' : ''} ${focused === pane ? 'focused-pane' : ''}`}
            aria-label={PANE_LABELS[pane]}
          >
            {collapsed.includes(pane) ? (
              <button
                className="restore-pane"
                title={`Expand ${PANE_LABELS[pane]}`}
                aria-label={`Expand ${PANE_LABELS[pane]}`}
                onClick={() => layout.setCollapsed((prev) => prev.filter((p) => p !== pane))}
              >
                <ChevronRight size={17} />
                <span>{PANE_LABELS[pane]}</span>
              </button>
            ) : (
              <>
                <div className="pane-heading">
                  <div
                    className="pane-title"
                    draggable
                    title="Drag to reorder"
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
                        layout.setOrder(next);
                      }
                      dragPane.current = null;
                    }}
                    onDragEnd={() => {
                      dragPane.current = null;
                    }}
                  >
                    <GripVertical size={13} />
                    <h2>{PANE_LABELS[pane]}</h2>
                  </div>
                  <div className="pane-actions">{paneActions(pane)}</div>
                </div>
                {paneBody(pane)}
                {index < order.length - 1 && (
                  <button
                    className="pane-resizer"
                    aria-label={`Resize ${PANE_LABELS[pane]}`}
                    title="Drag to resize; double-click to reset"
                    onPointerDown={resize}
                    onDoubleClick={resetLayout}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                        event.preventDefault();
                        const panel = event.currentTarget.parentElement!;
                        panel.style.flex = `0 0 ${Math.max(MIN_PANE, panel.clientWidth + (event.key === 'ArrowRight' ? 30 : -30))}px`;
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
  );
}
