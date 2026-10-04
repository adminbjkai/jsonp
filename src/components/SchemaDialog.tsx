import { useEffect, useRef, useState, type RefObject } from 'react';
import { ShieldCheck, Upload, Wand2, X, CheckCircle2, AlertCircle } from 'lucide-react';
import type { SchemaIssue } from '../lib/validate';
import { toJSONSchema } from '../lib/convert';
import type { Node } from '../lib/tree';
import { jsonPath, MAX_INPUT, type Entry } from '../lib/json';
interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  source: string;
  tree: () => Node | null;
  entryAt: (path: string) => Entry | undefined;
  select: (path: string) => boolean;
  notify: (message: string) => void;
}
type Result = { valid: boolean; issues: SchemaIssue[]; schemaError?: string; draft: string };
/** Validates the document against a JSON Schema and lists every problem with a clickable path. */
export default function SchemaDialog({ dialogRef, source, tree, entryAt, select, notify }: Props) {
  const [schema, setSchema] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const worker = useRef<{ stop: () => void } | null>(null);
  useEffect(() => () => worker.current?.stop(), []);
  const run = (schemaText = schema) => {
    if (!tree()) return notify('Fix the JSON in Source before validating it.');
    if (!schemaText.trim()) return notify('Paste a JSON Schema first, or generate one.');
    worker.current?.stop();
    setRunning(true);
    const job = new Worker(new URL('../workers/validate.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (next: Result) => {
      clearTimeout(timer);
      job.terminate();
      worker.current = null;
      setRunning(false);
      setResult(next);
    };
    const timer = setTimeout(
      () =>
        finish({
          valid: false,
          issues: [],
          draft: '',
          schemaError:
            'Validation took longer than 10 seconds and was stopped. A "pattern" in the schema may be too slow for this data.',
        }),
      10_000,
    );
    worker.current = {
      stop: () => {
        clearTimeout(timer);
        job.terminate();
        setRunning(false);
      },
    };
    job.onmessage = (event: MessageEvent<Result>) => finish(event.data);
    job.onerror = () =>
      finish({ valid: false, issues: [], draft: '', schemaError: 'Validation failed to run.' });
    job.postMessage({ source, schema: schemaText });
  };
  const label = (pointer: string) => {
    const entry = entryAt(pointer);
    return entry ? jsonPath(entry.parts) : pointer || '(document)';
  };
  return (
    <dialog
      ref={dialogRef}
      className="dialog wide-dialog"
      aria-labelledby="schema-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="schema-title">
          <ShieldCheck size={19} /> Validate against a JSON Schema
        </h2>
        <button aria-label="Close schema validation" onClick={() => dialogRef.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <p className="dialog-description">
        Paste a schema (drafts 4 through 2020-12), open a file, or generate one from this document
        and tighten it. Validation runs on your device.
      </p>
      <textarea
        className="compare-input"
        aria-label="JSON Schema"
        placeholder='{ "type": "object", "required": ["id"] }'
        spellCheck={false}
        value={schema}
        onChange={(event) => {
          setSchema(event.target.value);
          setResult(null);
        }}
      />
      <div className="compare-options">
        <button className="button" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Open schema
        </button>
        <button
          className="button"
          onClick={() => {
            const root = tree();
            if (!root) return notify('Fix the JSON in Source first.');
            const generated = toJSONSchema(root);
            setSchema(generated);
            setResult(null);
          }}
        >
          <Wand2 size={14} /> Generate from document
        </button>
        <button className="button primary-button" disabled={running} onClick={() => run()}>
          <ShieldCheck size={14} /> {running ? 'Validating…' : 'Validate'}
        </button>
        <input
          type="file"
          hidden
          ref={fileRef}
          accept=".json,application/json,application/schema+json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > MAX_INPUT) return notify('Choose a schema smaller than 5 MiB.');
            const text = (await file.text()).replace(/^\uFEFF/, '');
            setSchema(text);
            run(text);
          }}
        />
      </div>
      {result &&
        (result.schemaError ? (
          <p className="export-error" role="alert">
            {result.schemaError}
          </p>
        ) : result.valid ? (
          <p className="schema-valid" role="status">
            <CheckCircle2 size={16} /> The document matches the schema ({result.draft}).
          </p>
        ) : (
          <>
            <p className="schema-invalid" role="status">
              <AlertCircle size={16} /> {result.issues.length.toLocaleString()}{' '}
              {result.issues.length === 1 ? 'problem' : 'problems'} ({result.draft})
            </p>
            <ul className="diff-list" aria-label="Schema problems">
              {result.issues.map((issue, index) => (
                <li key={index} data-kind="removed">
                  <button
                    title="Show in workspace"
                    onClick={() => {
                      if (select(issue.pointer)) dialogRef.current?.close();
                    }}
                  >
                    <code>{label(issue.pointer)}</code>
                  </button>
                  <span className="schema-message">{issue.message}</span>
                </li>
              ))}
            </ul>
          </>
        ))}
    </dialog>
  );
}
