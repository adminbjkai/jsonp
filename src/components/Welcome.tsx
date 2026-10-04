import { X } from 'lucide-react';
import { MOD } from '../state/prefs';

/** A one-time, dismissible orientation for first visits. */
export default function Welcome({
  onHelp,
  onDismiss,
}: {
  onHelp: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside className="welcome" aria-label="Getting started">
      <ol>
        <li>
          <b>1</b> Paste, drop, or open JSON, YAML, XML, CSV, or Excel. Broken JSON gets a one-click
          repair.
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
      <button className="button" onClick={onHelp}>
        Show me how
      </button>
      <button className="icon-button" aria-label="Dismiss getting started" onClick={onDismiss}>
        <X size={15} />
      </button>
    </aside>
  );
}
