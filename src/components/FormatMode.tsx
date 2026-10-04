import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  ArrowDownAZ,
  ArrowLeftToLine,
  Braces,
  ClipboardPaste,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  GitCompareArrows,
  ListTree,
  Maximize2,
  Minimize,
  Minimize2,
  Network,
  Shuffle,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  Upload,
  WrapText,
  Wrench,
} from 'lucide-react';
import Menu from './Menu';
import OutputBody from './OutputBody';
import SourcePane from './SourcePane';
import { FORMATS } from '../lib/convert';
import { download } from '../lib/export';
import { INDENTS, indentKey } from '../actions';
import type { AppContext, OutputView } from '../context';
import { save, saved } from '../state/prefs';

const VIEWS: { id: OutputView; label: string; icon: typeof Code2 }[] = [
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'tree', label: 'Tree', icon: ListTree },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'graph', label: 'Graph', icon: Network },
];
export const savedOutputView = (): OutputView => {
  const stored = sessionStorage.getItem('jsonp.formatView');
  return VIEWS.some((v) => v.id === stored) ? (stored as OutputView) : 'code';
};
const MIN_SPLIT = 0.2;
const initialSplit = () => {
  const value = saved<unknown>('jsonp.split', 0.5);
  return typeof value === 'number' && value >= MIN_SPLIT && value <= 1 - MIN_SPLIT ? value : 0.5;
};

/** The quick formatter: input on the left, labelled actions in the middle, output on the right. */
export default function FormatMode({ app }: { app: AppContext }) {
  const { doc, editor, io, actions, settings, notify, formatView, views } = app;
  const { indent, lastIndent, output, valid, repair, input } = doc;
  const [expanded, setExpanded] = useState<'input' | 'output' | null>(null);
  const [split, setSplit] = useState(initialSplit);
  const grid = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);

  const expand = (pane: 'input' | 'output') => (
    <button
      title={expanded === pane ? 'Restore layout' : 'Expand'}
      aria-label={expanded === pane ? 'Restore layout' : `Expand ${pane}`}
      onClick={() => setExpanded(expanded === pane ? null : pane)}
    >
      {expanded === pane ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
  const choose = (view: OutputView) => {
    app.setFormatView(view);
    sessionStorage.setItem('jsonp.formatView', view);
  };

  // Dragging either edge of the action column moves the split between input and output.
  const drag = (event: PointerEvent<HTMLElement>) => {
    const frame = grid.current,
      middle = rail.current;
    if (!frame || !middle) return;
    event.preventDefault();
    const box = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const padLeft = parseFloat(style.paddingLeft);
    const handleWidth = event.currentTarget.getBoundingClientRect().width;
    const total =
      box.width - padLeft - parseFloat(style.paddingRight) - handleWidth * 2 - middle.offsetWidth;
    let next = split;
    const move = (e: globalThis.PointerEvent) => {
      const left = e.clientX - box.left - padLeft - handleWidth - middle.offsetWidth / 2;
      next = Math.min(1 - MIN_SPLIT, Math.max(MIN_SPLIT, left / total));
      setSplit(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
      save('jsonp.split', next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    document.body.style.cursor = 'col-resize';
  };
  const nudge = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? -0.03 : event.key === 'ArrowRight' ? 0.03 : 0;
    if (!step && event.key !== 'Home') return;
    event.preventDefault();
    const next =
      event.key === 'Home' ? 0.5 : Math.min(1 - MIN_SPLIT, Math.max(MIN_SPLIT, split + step));
    setSplit(next);
    save('jsonp.split', next);
  };
  const handle = (decorative = false) => (
    <div
      className="split-handle"
      {...(decorative
        ? { 'aria-hidden': true }
        : {
            role: 'separator',
            'aria-orientation': 'vertical' as const,
            'aria-label': 'Resize input and output',
            'aria-valuemin': Math.round(MIN_SPLIT * 100),
            'aria-valuemax': Math.round((1 - MIN_SPLIT) * 100),
            'aria-valuenow': Math.round(split * 100),
            tabIndex: 0,
            onKeyDown: nudge,
          })}
      title="Drag to resize; double-click to reset"
      onPointerDown={drag}
      onDoubleClick={() => {
        setSplit(0.5);
        save('jsonp.split', 0.5);
      }}
    />
  );

  return (
    <main
      ref={grid}
      className={`formatter ${expanded ? `expanded-${expanded}` : ''}`}
      style={{ '--left': `${split}fr`, '--right': `${1 - split}fr` } as React.CSSProperties}
      aria-label="JSON formatter"
    >
      <section className="pane formatter-input" aria-label="Input">
        <div className="pane-heading">
          <h2 className="pane-title">Input</h2>
          <div className="pane-actions">
            <button title="Open file" aria-label="Open file" onClick={actions.open.run}>
              <Upload size={15} />
            </button>
            <button
              title="Paste from clipboard"
              aria-label="Paste from clipboard"
              onClick={actions.paste.run}
            >
              <ClipboardPaste size={15} />
            </button>
            <button title="Load sample" aria-label="Load sample" onClick={actions.sample.run}>
              <Braces size={15} />
            </button>
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
            <button
              title="Clear source"
              aria-label="Clear source"
              disabled={!input}
              onClick={actions.clear.run}
            >
              <Trash2 size={15} />
            </button>
            {expand('input')}
          </div>
        </div>
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
              : 'Paste or type. Everything stays on this device.'}
          </span>
          <span>{(doc.bytes / 1024).toFixed(1)} KB</span>
        </div>
      </section>

      {handle()}
      <nav className="formatter-actions" aria-label="Formatter actions" ref={rail}>
        <button
          className="button primary-button big-action"
          aria-pressed={indent !== 0}
          onClick={() => {
            doc.setIndent(indent || lastIndent);
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
              doc.setIndent(INDENTS.find((o) => o.value === event.target.value)?.indent ?? 2)
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
            doc.setIndent(0);
            notify('Minified');
          }}
        >
          <Minimize size={16} /> Minify
        </button>
        <button className="button big-action" onClick={editor.validateNow}>
          <CheckCircle2 size={16} /> Validate
        </button>
        <button className="button big-action" disabled={!repair} onClick={editor.repairSource}>
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
            run: () => app.openConvert(format.id),
          }))}
        />
        <button className="button big-action" disabled={!valid} onClick={actions.schema.run}>
          <ShieldCheck size={16} /> Schema
        </button>
        <span className="actions-divider" aria-hidden="true" />
        <button className="button big-action" onClick={() => app.switchMode('compare')}>
          <GitCompareArrows size={16} /> Compare
        </button>
        <Menu
          label="Export"
          icon={<Download size={16} />}
          className="big-menu"
          items={[
            actions.copy,
            actions.copyMinified,
            actions.download,
            { ...actions.excel, separator: true },
            { ...actions.share, separator: true },
          ]}
        />
      </nav>
      {handle(true)}

      <section className="pane formatter-output" aria-label="Output">
        <div className="pane-heading">
          <div className="segmented view-tabs" role="tablist" aria-label="Output view">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={formatView === id}
                onClick={() => choose(id)}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <div className="pane-actions">
            <button
              title="Use the output as input"
              aria-label="Use the output as input"
              disabled={!output || output === input}
              onClick={() => {
                doc.replace(output);
                app.announce('Output copied into the input');
              }}
            >
              <ArrowLeftToLine size={15} />
            </button>
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
            {expand('output')}
          </div>
        </div>
        <div className="formatter-view" role="tabpanel" aria-label={`${formatView} view`}>
          {formatView === 'code' || !valid ? (
            <OutputBody
              doc={doc}
              editor={editor}
              onConvertSource={(kind) => void io.convertSource(kind)}
            />
          ) : formatView === 'tree' ? (
            views.explorer
          ) : formatView === 'table' ? (
            views.table
          ) : (
            views.graph
          )}
        </div>
        <div className="pane-footnote">
          <span>
            {doc.warnings.length
              ? doc.warnings[0]
              : indent === 0
                ? 'Minified. Numbers, key order, and escapes preserved.'
                : 'Numbers, key order, and string escapes preserved.'}
          </span>
          <span>{doc.entries.length.toLocaleString()} values</span>
        </div>
      </section>
    </main>
  );
}
