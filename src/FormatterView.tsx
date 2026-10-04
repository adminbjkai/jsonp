import { useState, type ReactNode } from 'react';
import { Code2, ListTree, Network, Table2, Maximize2, Minimize2 } from 'lucide-react';
export type OutputView = 'code' | 'tree' | 'table' | 'graph';
const VIEWS: { id: OutputView; label: string; icon: ReactNode }[] = [
  { id: 'code', label: 'Code', icon: <Code2 size={14} /> },
  { id: 'tree', label: 'Tree', icon: <ListTree size={14} /> },
  { id: 'table', label: 'Table', icon: <Table2 size={14} /> },
  { id: 'graph', label: 'Graph', icon: <Network size={14} /> },
];
interface Props {
  /** Input pane header actions (open, paste, sample, clear). */
  inputActions: ReactNode;
  editor: ReactNode;
  inputFootnote: ReactNode;
  /** The middle column of big, labelled actions. */
  actions: ReactNode;
  outputActions: ReactNode;
  renderView: (view: OutputView) => ReactNode;
  outputFootnote: ReactNode;
  view: OutputView;
  onView: (view: OutputView) => void;
}
export const savedOutputView = (): OutputView => {
  const saved = sessionStorage.getItem('jsonp.formatView');
  return VIEWS.some((v) => v.id === saved) ? (saved as OutputView) : 'code';
};
/** The simple formatter: input on the left, actions in the middle, output on the right. */
export default function FormatterView({
  inputActions,
  editor,
  inputFootnote,
  actions,
  outputActions,
  renderView,
  outputFootnote,
  view,
  onView,
}: Props) {
  const [expanded, setExpanded] = useState<'input' | 'output' | null>(null);
  const choose = (next: OutputView) => {
    onView(next);
    sessionStorage.setItem('jsonp.formatView', next);
  };
  const expand = (pane: 'input' | 'output') => (
    <button
      title={expanded === pane ? 'Restore layout' : 'Expand'}
      aria-label={expanded === pane ? 'Restore layout' : `Expand ${pane}`}
      onClick={() => setExpanded(expanded === pane ? null : pane)}
    >
      {expanded === pane ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
  return (
    <main
      className={`formatter ${expanded ? `expanded-${expanded}` : ''}`}
      aria-label="JSON formatter"
    >
      <section className="pane formatter-input" aria-label="Input">
        <div className="pane-heading">
          <div className="pane-title">
            <span className="pane-index">IN</span>
            <h2>Input</h2>
          </div>
          <div className="pane-heading-actions">
            {inputActions}
            {expand('input')}
          </div>
        </div>
        {editor}
        <div className="pane-footnote">{inputFootnote}</div>
      </section>
      <nav className="formatter-actions" aria-label="Formatter actions">
        {actions}
      </nav>
      <section className="pane formatter-output" aria-label="Output">
        <div className="pane-heading">
          <div className="segmented view-tabs" role="tablist" aria-label="Output view">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                role="tab"
                aria-selected={view === option.id}
                onClick={() => choose(option.id)}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>
          <div className="pane-heading-actions">
            {outputActions}
            {expand('output')}
          </div>
        </div>
        <div className="formatter-view" role="tabpanel" aria-label={`${view} view`}>
          {renderView(view)}
        </div>
        <div className="pane-footnote">{outputFootnote}</div>
      </section>
    </main>
  );
}
