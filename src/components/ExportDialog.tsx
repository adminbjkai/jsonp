import { useEffect, useState, type RefObject } from 'react';
import { FileSpreadsheet, Download, X } from 'lucide-react';
import { needsSource, type ExportKind } from '../lib/ird';
interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  count: number;
  busy: boolean;
  onExport: (kind: ExportKind) => Promise<boolean>;
}
export default function ExportDialog({ dialogRef, count, busy, onExport }: Props) {
  const [kind, setKind] = useState<ExportKind>('ird');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!dialogRef.current?.open) {
      setKind(count ? 'ird' : 'blank');
      setError(false);
    }
  }, [count]);
  const options: { kind: ExportKind; title: string; description: string }[] = [
    {
      kind: 'ird',
      title: 'IRD mapping template',
      description:
        'Use your JSON fields and reusable array paths. No sample values. Target mappings and business rules stay blank.',
    },
    {
      kind: 'blank',
      title: 'Blank IRD template',
      description:
        'Start fresh for any interface. Includes an overview, 30 empty mapping rows, and instructions.',
    },
    {
      kind: 'example-mapping',
      title: 'Known-target worked example',
      description:
        'Orbital sample → Projects and Crew tables. Download the target schema and output, plus a completed IRD for every target field.',
    },
    {
      kind: 'samples',
      title: 'Mapping with samples',
      description: 'The original mapping export: every value, its exact path, and sample data.',
    },
  ];
  return (
    <dialog
      className="shortcuts-dialog export-dialog"
      ref={dialogRef}
      aria-labelledby="export-title"
      onClose={() => setError(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="export-title">
          <FileSpreadsheet size={20} /> Export to Excel
        </h2>
        <button aria-label="Close export" onClick={() => dialogRef.current?.close()}>
          <X size={18} />
        </button>
      </div>
      <p>Choose the workbook that fits your next step.</p>
      <fieldset className="export-options" disabled={busy}>
        <legend className="sr-only">Workbook type</legend>
        {options.map((option) => (
          <label
            className={`export-option ${kind === option.kind ? 'chosen' : ''}`}
            key={option.kind}
          >
            <input
              type="radio"
              name="workbook-type"
              value={option.kind}
              checked={kind === option.kind}
              disabled={needsSource(option.kind) && !count}
              onChange={() => {
                setKind(option.kind);
                setError(false);
              }}
            />
            <span>
              <strong>{option.title}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="export-summary">
        {kind === 'example-mapping'
          ? 'Bundled Orbital sample · 2 target tables · 11 completed mappings'
          : kind === 'samples'
            ? `${count.toLocaleString()} values · includes sample data`
            : '3 sheets · Overview / Field Mapping / Instructions · no sample data'}
      </div>
      {kind === 'example-mapping' && (
        <button
          className="button export-download"
          disabled={busy}
          onClick={async () => {
            setError(false);
            if (!(await onExport('example-target'))) setError(true);
          }}
        >
          <Download size={15} /> Download target XLSX
        </button>
      )}
      {error && (
        <p role="alert" className="export-error">
          Couldn’t create the workbook. Please try again.
        </p>
      )}
      <button
        className="button primary-button export-download"
        disabled={busy || (needsSource(kind) && !count)}
        onClick={async () => {
          setError(false);
          if (await onExport(kind)) dialogRef.current?.close();
          else setError(true);
        }}
      >
        <Download size={15} />{' '}
        {busy
          ? 'Preparing workbook…'
          : kind === 'example-mapping'
            ? 'Download completed IRD'
            : 'Download XLSX'}
      </button>
    </dialog>
  );
}
