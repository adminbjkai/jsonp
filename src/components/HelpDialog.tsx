import type { RefObject } from 'react';
import { X } from 'lucide-react';
const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const SHORTCUTS: [string, string][] = [
  ['K', 'Find any action'],
  ['Enter', 'Format source'],
  ['Shift + C', 'Copy formatted JSON'],
  ['S', 'Download JSON'],
  ['F', 'Focus Find (outside Source)'],
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
      className="dialog help-dialog"
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
          <b>Pick a mode.</b> <em>Format</em> is the quick one: paste on the left, read clean JSON
          on the right. <em>Workspace</em> puts source, formatted output, explorer, table, and graph
          side by side. <em>Compare</em> lines up two documents and highlights every difference.
        </li>
        <li>
          <b>Bring in data.</b> Paste, drop a file anywhere, or use <em>Open</em>. JSON, YAML, XML,
          CSV, and Excel files become JSON. Broken JSON gets a one-click <em>Repair</em>.
        </li>
        <li>
          <b>Read it your way.</b> Switch the output between Code, Tree, Table, and Graph. Click any
          value, in any view, to see its exact path and copy it.
        </li>
        <li>
          <b>Find what matters.</b> Type in Find, or start with <code>$</code> to run a JSONPath
          query. Enter steps to the next match and the path shown follows it. Matches light up in
          the graph too.
        </li>
        <li>
          <b>Take it further.</b> <em>Convert</em> creates TypeScript, Go, Rust, Python, Zod,
          Kotlin, C#, JSON Schema, YAML, CSV, or XML. <em>Schema</em> validates against a JSON
          Schema, and <em>Export</em> downloads, shares, or builds an Excel IRD, with your JSON as
          the source or the target.
        </li>
      </ol>
      <button className="button" onClick={() => (close(), onSample())}>
        Load the sample to try it
      </button>
      <h3>Views</h3>
      <dl className="help-panes">
        <dt>Source</dt>
        <dd>Your editable JSON. Errors show their line and column.</dd>
        <dt>Formatted</dt>
        <dd>A clean, colored copy. Numbers and key order are never altered.</dd>
        <dt>Explorer</dt>
        <dd>
          The tree: every value, with arrow-key navigation. Branches preview what is inside; hover a
          row to copy its path or value.
        </dd>
        <dt>Table</dt>
        <dd>Arrays of records as rows and columns. Click a column to sort.</dd>
        <dt>Graph</dt>
        <dd>
          Objects and arrays as connected cards. Collapse branches, flip the direction, and export a
          PNG or SVG.
        </dd>
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
        In the Explorer, ↑/↓ move between results and {MOD} + C copies the selected path; Show paths
        adds each path under its name. Drag pane headers to reorder and dividers to resize,
        including the split between input and output in Format mode. Escape exits a focused pane.
        Any change that replaces your source offers Undo in its message.
      </div>
    </dialog>
  );
}
