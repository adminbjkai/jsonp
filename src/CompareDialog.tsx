import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { GitCompareArrows, Upload, X, Copy, Wrench } from 'lucide-react';
import { diffTrees, type ChangeKind } from './diff';
import { parseTree, type Node } from './tree';
import { repairJSON } from './repair';
import { jsonPath, pointer, MAX_INPUT } from './json';
interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  opened: number;
  tree: () => Node | null;
  select: (path: string) => boolean;
  copy: (text: string, message?: string) => void;
  notify: (message: string) => void;
}
const KIND_LABEL: Record<ChangeKind, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  type: 'Type changed',
};
/** Structural comparison between the Source document and a second document. */
export default function CompareDialog({ dialogRef, opened, tree, select, copy, notify }: Props) {
  const [other, setOther] = useState('');
  const [ignoreOrder, setIgnoreOrder] = useState(false);
  const [root, setRoot] = useState<Node | null>(null);
  const deferred = useDeferredValue(other);
  const fileRef = useRef<HTMLInputElement>(null);
  // Re-read Source each time the dialog opens.
  useEffect(() => {
    if (opened) setRoot(tree());
  }, [opened]);
  const comparison = useMemo(() => {
    if (!deferred.trim()) return null;
    if (!root) return { error: 'Fix the JSON in Source first. It is the “before” document.' };
    let b: Node;
    try {
      b = parseTree(deferred);
    } catch {
      return { error: 'The second document isn’t valid JSON.', repairable: !!repairJSON(deferred) };
    }
    return { diff: diffTrees(root, b, { ignoreOrder }) };
  }, [deferred, root, ignoreOrder]);
  const diff = comparison && 'diff' in comparison ? comparison.diff : undefined;
  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-dialog wide-dialog"
      aria-labelledby="compare-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="compare-title">
          <GitCompareArrows size={19} /> Compare
        </h2>
        <button aria-label="Close compare" onClick={() => dialogRef.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <p className="dialog-description">
        Paste or open a second document. Differences are listed against Source by path; key order
        never counts as a change.
      </p>
      <textarea
        className="compare-input"
        aria-label="Second JSON document"
        placeholder="Paste the “after” JSON here…"
        spellCheck={false}
        value={other}
        onChange={(event) => setOther(event.target.value)}
      />
      <div className="compare-options">
        <button className="button" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Open file
        </button>
        <label>
          <input
            type="checkbox"
            checked={ignoreOrder}
            onChange={(event) => setIgnoreOrder(event.target.checked)}
          />{' '}
          Ignore array order
        </label>
        {comparison && 'repairable' in comparison && comparison.repairable && (
          <button className="button" onClick={() => setOther(repairJSON(other)?.output ?? other)}>
            <Wrench size={14} /> Repair it
          </button>
        )}
        <input
          type="file"
          hidden
          ref={fileRef}
          accept=".json,.txt,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > MAX_INPUT) return notify('Choose a JSON file smaller than 5 MiB.');
            setOther((await file.text()).replace(/^\uFEFF/, ''));
          }}
        />
      </div>
      {comparison && 'error' in comparison && (
        <p className="export-error" role="alert">
          {comparison.error}
        </p>
      )}
      {diff && (
        <>
          <div className="diff-summary" role="status">
            {diff.changes.length ? (
              (Object.keys(KIND_LABEL) as ChangeKind[]).map(
                (kind) =>
                  diff.summary[kind] > 0 && (
                    <span key={kind} data-kind={kind}>
                      {diff.summary[kind].toLocaleString()} {KIND_LABEL[kind].toLowerCase()}
                    </span>
                  ),
              )
            ) : (
              <span data-kind="same">The documents are equivalent.</span>
            )}
            {diff.truncated && (
              <span>Showing the first {diff.changes.length.toLocaleString()}</span>
            )}
            {diff.changes.length > 0 && (
              <button
                className="button"
                onClick={() =>
                  copy(
                    JSON.stringify(
                      diff.changes.map((c) => ({
                        ...c,
                        path: jsonPath(c.parts),
                        parts: undefined,
                      })),
                      null,
                      2,
                    ),
                    'Differences copied',
                  )
                }
              >
                <Copy size={14} /> Copy report
              </button>
            )}
          </div>
          <ul className="diff-list" aria-label="Differences">
            {diff.changes.slice(0, 2000).map((change, index) => (
              <li key={index} data-kind={change.kind}>
                <button
                  title={
                    change.kind === 'added' ? 'Only in the second document' : 'Show in workspace'
                  }
                  disabled={change.kind === 'added'}
                  onClick={() => {
                    if (select(pointer(change.parts))) dialogRef.current?.close();
                  }}
                >
                  <b>{KIND_LABEL[change.kind]}</b>
                  <code>{jsonPath(change.parts)}</code>
                </button>
                <span className="diff-values">
                  {change.before !== undefined && <del>{change.before}</del>}
                  {change.after !== undefined && <ins>{change.after}</ins>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </dialog>
  );
}
