import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Copy, Download, Shuffle, X } from 'lucide-react';
import { convert, FORMATS, type Format } from '../lib/convert';
import { nodeAt, type Node } from '../lib/tree';
import { jsonPath, type Entry } from '../lib/json';
import { download } from '../lib/export';
const PREVIEW = 200_000;
export interface ConvertRequest {
  format?: Format;
  path?: string;
  nonce: number;
}
interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  tree: () => Node | null;
  selected?: Entry;
  entryAt: (path: string) => Entry | undefined;
  request: ConvertRequest;
  copy: (text: string, message?: string) => void;
}
/** Converts the document, or the selected value, to type definitions (TypeScript, JSON Schema, Go,
 * Rust, Python, Zod, Kotlin, C#) or data formats (YAML, CSV, XML). */
export default function ConvertDialog({
  dialogRef,
  tree,
  selected,
  entryAt,
  request,
  copy,
}: Props) {
  const [format, setFormat] = useState<Format>('typescript');
  const [scopePath, setScopePath] = useState<string | null>(null);
  const [root, setRoot] = useState<Node | null>(null);
  useEffect(() => {
    if (!request.nonce) return;
    setRoot(tree());
    if (request.format) setFormat(request.format);
    setScopePath(request.path ?? (selected && selected.parts.length ? selected.path : null));
  }, [request.nonce]);
  const scope = scopePath !== null ? entryAt(scopePath) : undefined;
  const meta = FORMATS.find((f) => f.id === format)!;
  const result = useMemo((): { text?: string; error?: string } => {
    if (!root) return { error: 'Fix the JSON in Source to convert it.' };
    const node = scope ? nodeAt(root, scope.parts) : root;
    if (!node) return { error: 'The selected value is no longer in the document.' };
    try {
      const last = scope?.parts.at(-1);
      const rootName =
        typeof last === 'string' && /[a-z]/i.test(last)
          ? last.replace(/^./, (c) => c.toUpperCase())
          : 'Root';
      return { text: convert(node, format, { rootName }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Conversion failed.' };
    }
  }, [root, scope, format]);
  const name = scope?.parts.length ? String(scope.parts.at(-1)) : 'document';
  return (
    <dialog
      ref={dialogRef}
      className="dialog wide-dialog"
      aria-labelledby="convert-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="convert-title">
          <Shuffle size={19} /> Convert
        </h2>
        <button aria-label="Close convert" onClick={() => dialogRef.current?.close()}>
          <X size={18} />
        </button>
      </div>
      {(['types', 'data'] as const).map((group) => (
        <div className="convert-scope" key={group} style={{ marginTop: 14 }}>
          <span id={`convert-${group}`} style={{ minWidth: 40 }}>
            {group === 'types' ? 'Types' : 'Data'}
          </span>
          <div className="segmented small" role="radiogroup" aria-labelledby={`convert-${group}`}>
            {FORMATS.filter((option) => option.group === group).map((option) => (
              <button
                key={option.id}
                role="radio"
                aria-checked={format === option.id}
                onClick={() => setFormat(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="dialog-description">{meta.description}</p>
      <div className="convert-scope">
        <span style={{ minWidth: 40 }}>From</span>
        <div className="segmented small" role="radiogroup" aria-label="What to convert">
          <button role="radio" aria-checked={!scope} onClick={() => setScopePath(null)}>
            Whole document
          </button>
          {(scope || (selected && selected.parts.length > 0)) && (
            <button
              role="radio"
              aria-checked={!!scope}
              onClick={() => setScopePath((scope ?? selected)!.path)}
              title={jsonPath((scope ?? selected)!.parts)}
            >
              <code>{jsonPath((scope ?? selected)!.parts)}</code>
            </button>
          )}
        </div>
      </div>
      {result.error !== undefined ? (
        <p className="export-error" role="alert">
          {result.error}
        </p>
      ) : (
        <pre className="convert-preview" aria-label="Converted output" tabIndex={0}>
          {result.text!.length > PREVIEW
            ? result.text!.slice(0, PREVIEW) +
              '\n… Preview truncated. Download for the full output.'
            : result.text}
        </pre>
      )}
      <div className="dialog-actions">
        <button
          className="button"
          disabled={!result.text}
          onClick={() => copy(result.text!, `${meta.label} copied`)}
        >
          <Copy size={15} /> Copy
        </button>
        <button
          className="button primary-button"
          disabled={!result.text}
          onClick={() => download(result.text!, `${name}.${meta.extension}`, meta.mime)}
        >
          <Download size={15} /> Download .{meta.extension}
        </button>
      </div>
    </dialog>
  );
}
