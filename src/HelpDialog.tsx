import type { RefObject } from 'react';
import { X } from 'lucide-react';
const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
export const SHORTCUTS: [string, string][] = [
  ['K', 'Find any action'],
  ['Enter', 'Format source'],
  ['Shift + C', 'Copy formatted JSON'],
  ['S', 'Download JSON'],
  ['F', 'Search the explorer'],
  ['/', 'Open this help'],
];
const QUERIES: [string, string][] = [
  ['$.crew[*].name', 'Every crew member’s name'],
  ['$..name', 'Every “name”, at any depth'],
  ["$.crew[?(@.role == 'Designer')]", 'Crew members whose role is Designer'],
  ['$.settings.*', 'All values inside settings'],
  ['$.crew[-1]', 'The last crew member'],
];
/** Quick start, what each pane does, query examples, and shortcuts. */
export default function HelpDialog({
  dialogRef,
  onQuery,
  onSample,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  onQuery: (query: string) => void;
  onSample: () => void;
}) {
  const close = () => dialogRef.current?.close();
  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-dialog help-dialog"
      aria-labelledby="help-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="help-title">How to use JSON Prettify</h2>
        <button aria-label="Close help" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <ol className="quick-start">
        <li>
          <b>Bring in JSON.</b> Paste it into Source, drop a file anywhere, or use <em>Open</em>.
          Broken JSON — comments, trailing commas, single quotes — gets a one-click <em>Repair</em>.
        </li>
        <li>
          <b>Click any value.</b> Its path appears at the top, ready to copy, and the matching lines
          light up in every pane.
        </li>
        <li>
          <b>Find what matters.</b> Type in the Explorer’s Find box, or start with <code>$</code> to
          run a JSONPath query.
        </li>
        <li>
          <b>Take it further.</b> <em>Tools</em> sorts and cleans, <em>Convert</em> creates
          TypeScript, JSON Schema, YAML, or CSV, <em>Compare</em> shows what changed, and{' '}
          <em>Export</em> downloads, shares, or builds an Excel IRD.
        </li>
      </ol>
      <button className="button" onClick={() => (close(), onSample())}>
        Load the sample to try it
      </button>
      <h3>Panes</h3>
      <dl className="help-panes">
        <dt>Source</dt>
        <dd>Your editable JSON. Errors show their line and column.</dd>
        <dt>Formatted</dt>
        <dd>A clean, colored copy. Numbers and key order are never altered.</dd>
        <dt>Explorer</dt>
        <dd>Every value with its path. Search, query, copy paths, and step through results.</dd>
        <dt>Table</dt>
        <dd>Arrays of records as rows and columns. Click a column to sort.</dd>
        <dt>Graph</dt>
        <dd>Objects and arrays as connected cards.</dd>
      </dl>
      <h3>Try a query</h3>
      <p>These work on the sample. Click one to run it.</p>
      <div className="query-examples">
        {QUERIES.map(([query, description]) => (
          <button key={query} onClick={() => (close(), onQuery(query))}>
            <code>{query}</code>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <h3>Shortcuts</h3>
      {SHORTCUTS.map(([keys, description]) => (
        <div className="shortcut" key={keys}>
          <span>{description}</span>
          <kbd>
            {MOD} + {keys}
          </kbd>
        </div>
      ))}
      <div className="dialog-tip">
        In the Explorer, ↑/↓ move between results and {MOD} + C copies the selected path. Drag pane
        headers to reorder and dividers to resize. Escape exits a focused pane.
      </div>
    </dialog>
  );
}
