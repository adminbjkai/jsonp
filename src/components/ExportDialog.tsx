import { useEffect, useState, type RefObject } from 'react';
import { FileSpreadsheet, Download, X } from 'lucide-react';
import { needsSource, type ExportKind, type Role } from '../lib/ird';
interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  count: number;
  busy: boolean;
  onExport: (kind: ExportKind, role: Role) => Promise<boolean>;
}
interface Option {
  kind: ExportKind;
  title: string;
  description: string;
}
/** The same four workbooks for either side of the interface: JSON as the source or as the target. */
const COLUMNS: { role: Role; title: string; flow: string; options: Option[] }[] = [
  {
    role: 'source',
    title: 'JSON is the source',
    flow: 'Your JSON feeds another system.',
    options: [
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
    ],
  },
  {
    role: 'target',
    title: 'JSON is the target',
    flow: 'Another system produces your JSON.',
    options: [
      {
        kind: 'ird',
        title: 'IRD mapping template',
        description:
          'Use your JSON fields and reusable array paths as the target. No sample values. Source mappings and business rules stay blank.',
      },
      {
        kind: 'blank',
        title: 'Blank IRD template',
        description:
          'The same blank template with its columns arranged for a JSON target: an overview, 30 empty mapping rows, and instructions.',
      },
      {
        kind: 'example-mapping',
        title: 'Known-source worked example',
        description:
          'Projects and Crew tables → Orbital JSON. Download the source schema and rows, plus a completed IRD for every source field.',
      },
      {
        kind: 'samples',
        title: 'Mapping with samples',
        description:
          'Every value as a target field: its exact path and sample data, with a blank Mapping Source column.',
      },
    ],
  },
];
export default function ExportDialog({ dialogRef, count, busy, onExport }: Props) {
  const [choice, setChoice] = useState<{ role: Role; kind: ExportKind }>({
    role: 'source',
    kind: 'ird',
  });
  const [error, setError] = useState(false);
  const { role, kind } = choice;
  useEffect(() => {
    if (!dialogRef.current?.open) {
      setChoice({ role: 'source', kind: count ? 'ird' : 'blank' });
      setError(false);
    }
  }, [count]);
  const tables = role === 'source' ? 'target' : 'source';
  return (
    <dialog
      className="dialog export-dialog"
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
      <p>
        Choose the workbook that fits your next step, and which side of the mapping your JSON is.
      </p>
      <div className="export-body">
        <div className="export-columns">
          {COLUMNS.map((column) => (
            <div
              className="export-options"
              role="group"
              aria-labelledby={`export-${column.role}`}
              key={column.role}
            >
              <div className="export-heading" id={`export-${column.role}`}>
                <strong>{column.title}</strong>
                <span>{column.flow}</span>
              </div>
              {column.options.map((option) => (
                <label
                  className={`export-option ${role === column.role && kind === option.kind ? 'chosen' : ''}`}
                  key={option.kind}
                >
                  <input
                    type="radio"
                    name="workbook-type"
                    value={`${column.role}:${option.kind}`}
                    checked={role === column.role && kind === option.kind}
                    disabled={busy || (needsSource(option.kind) && !count)}
                    onChange={() => {
                      setChoice({ role: column.role, kind: option.kind });
                      setError(false);
                    }}
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="export-summary">
        {kind === 'example-mapping'
          ? `Bundled Orbital sample · 2 ${tables} tables · 11 completed mappings`
          : kind === 'samples'
            ? `${count.toLocaleString()} values · includes sample data`
            : '3 sheets · Overview / Field Mapping / Instructions · no sample data'}
        {role === 'target' && ' · JSON as target'}
      </div>
      {kind === 'example-mapping' && (
        <button
          className="button export-download"
          disabled={busy}
          onClick={async () => {
            setError(false);
            if (!(await onExport('example-tables', role))) setError(true);
          }}
        >
          <Download size={15} /> Download {tables} XLSX
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
          if (await onExport(kind, role)) dialogRef.current?.close();
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
