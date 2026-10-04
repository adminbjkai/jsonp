import { AlertCircle, Braces, Crosshair, Sheet, Wrench } from 'lucide-react';
import Output from './Output';
import type { DocumentState } from '../state/useDocument';
import type { EditorState } from '../state/useEditor';

interface Props {
  doc: DocumentState;
  editor: EditorState;
  onConvertSource: (kind: 'yaml' | 'xml' | 'csv') => void;
}

/** Formatted code, or a plain-language explanation of what is wrong with the source. */
export default function OutputBody({ doc, editor, onConvertSource }: Props) {
  const { error, problem, repair, sniffed, output, busy } = doc;
  if (error)
    return (
      <div className="empty-state error-state" role="alert">
        <AlertCircle size={28} />
        <strong>
          {problem
            ? `Line ${problem.line + 1}, column ${problem.column}`
            : 'One detail needs attention'}
        </strong>
        <p>{problem ? problem.message : error}</p>
        {(problem || repair) && (
          <div className="error-actions">
            {sniffed && (
              <button className="button primary-button" onClick={() => onConvertSource(sniffed)}>
                <Sheet size={14} /> Convert {sniffed.toUpperCase()} to JSON
              </button>
            )}
            {problem && (
              <button className="button" onClick={editor.goToError}>
                <Crosshair size={14} /> Go to error
              </button>
            )}
            {repair && (
              <button
                className={`button ${sniffed ? '' : 'primary-button'}`}
                onClick={editor.repairSource}
              >
                <Wrench size={14} /> Repair JSON
              </button>
            )}
          </div>
        )}
        {repair ? (
          <ul className="repair-fixes" aria-label="Repair will">
            {repair.fixes.map((fix) => (
              <li key={fix}>{fix}</li>
            ))}
          </ul>
        ) : (
          <span>Your source is preserved. Fix it to continue.</span>
        )}
      </div>
    );
  if (output) return <Output output={output} selected={doc.selected} />;
  return (
    <div className="empty-state">
      <Braces size={28} />
      <strong>{busy ? 'Reading your document…' : 'Nothing to show yet'}</strong>
      <p>
        {busy
          ? 'Processing locally in the background.'
          : 'Paste or open JSON and the formatted result appears here.'}
      </p>
    </div>
  );
}
