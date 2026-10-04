import { Save } from 'lucide-react';
import type { Entry } from '../lib/json';

interface Props {
  status: string;
  state: 'error' | 'busy' | 'valid' | 'empty';
  bytes: number;
  values: number;
  selected?: Entry;
  section: 'key' | 'value';
  remembered: boolean;
  onInsights: () => void;
}

/** One slim line: is the document valid, how big is it, and what is selected. */
export default function StatusBar({
  status,
  state,
  bytes,
  values,
  selected,
  section,
  remembered,
  onInsights,
}: Props) {
  return (
    <footer className="status-bar">
      <div className="status" data-state={state}>
        <span />
        <b>{status}</b>
      </div>
      <div className="document-stats">
        <span>{(bytes / 1024).toFixed(1)} KB</span>
        <button className="stats-button" title="Document insights" onClick={onInsights}>
          {values.toLocaleString()} values
        </button>
        {selected && (
          <code title={selected.path}>
            {selected.path || 'document'} ({section})
          </code>
        )}
      </div>
      {remembered && (
        <span className="draft-note">
          <Save size={11} /> Draft kept on this device
        </span>
      )}
    </footer>
  );
}
