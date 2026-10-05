import { writeXlsx, rangeRef } from 'hucre/xlsx';
import type { CellStyle, CellValue, Cell, WriteSheet } from 'hucre/xlsx';
import { mappingRows, type MappingEntry } from './json';
import {
  IRD_COLUMNS,
  IRD_OVERVIEW,
  irdInstructions,
  irdRows,
  blankIRDRows,
  type ExportKind,
  type Role,
} from './ird';
import {
  TABLE_FIELDS,
  TABLE_PROJECTS,
  TABLE_CREW,
  exampleMapping,
  exampleOverview,
  exampleJson,
  exampleGuide,
} from './mapping-example';

type Row = Record<string, string | number>;
type WriteCell = CellValue | Partial<Cell>;
const HEADER: CellStyle = { font: { bold: true } };
// hucre writes these exact strings as error cells; rich text keeps them as ordinary text.
const ERRORS = new Set([
  '#VALUE!',
  '#REF!',
  '#N/A',
  '#NAME?',
  '#NULL!',
  '#DIV/0!',
  '#NUM!',
  '#GETTING_DATA',
  '#SPILL!',
  '#CALC!',
]);
// Character counts plus Excel's cell padding, as SheetJS stored them (wch + 5px at 6px/char).
const width = (chars: number) => chars + 213 / 256;
/** Excel's per-cell text limit. */
const MAX_CELL = 32_767;
/**
 * Makes text safe for a worksheet: drops characters XML 1.0 can't hold (control characters
 * other than tab/newline/return, U+FFFE/U+FFFF, lone surrogates) and truncates past Excel's
 * cell limit with a visible marker.
 */
export function cellText(text: string): string {
  const clean = text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  );
  return clean.length > MAX_CELL ? clean.slice(0, MAX_CELL - 12) + '…[truncated]' : clean;
}
const cell = (raw: string | number, style?: CellStyle): WriteCell => {
  const value = typeof raw === 'string' ? cellText(raw) : raw;
  const base: Partial<Cell> =
    typeof value === 'string' && ERRORS.has(value)
      ? { value, richText: [{ text: value }] }
      : { value };
  return style ? { ...base, style } : base.richText ? base : value;
};

/** A filterable table: bold frozen header row, widths fitted to content (max 60). */
function table(name: string, rows: Row[], header = Object.keys(rows[0] || {})): WriteSheet {
  return {
    name,
    columns: header.map((key) => ({
      width: width(
        Math.min(
          60,
          rows.reduce((max, row) => Math.max(max, String(row[key] ?? '').length), key.length) + 3,
        ),
      ),
    })),
    rows: [
      header.map((key) => cell(key, HEADER)),
      ...rows.map((row) => header.map((key) => cell(row[key] ?? ''))),
    ],
    autoFilter: header.length
      ? { range: rangeRef(0, 0, rows.length, header.length - 1) }
      : undefined,
    freezePane: { rows: 1 },
  };
}

/** A two-column reference sheet with a bold first row. */
const info = (name: string, rows: string[][], widths: number[]): WriteSheet => ({
  name,
  columns: widths.map((chars) => ({ width: width(chars) })),
  rows: rows.map((row, index) => row.map((value) => cell(value, index ? undefined : HEADER))),
});

export function buildWorkbook(
  kind: ExportKind,
  entries: MappingEntry[],
  role: Role = 'source',
): Promise<Uint8Array> {
  const sheets: WriteSheet[] = [];
  if (kind === 'example-tables' || kind === 'example-mapping') {
    sheets.push(info('Overview', exampleOverview(role), [34, 110]));
    if (kind === 'example-mapping') sheets.push(table('Field Mapping', exampleMapping(role)));
    sheets.push(
      table(role === 'source' ? 'Target Fields' : 'Source Fields', TABLE_FIELDS),
      table('Projects', TABLE_PROJECTS),
      table('Crew', TABLE_CREW),
      info(role === 'source' ? 'Source JSON' : 'Target JSON', exampleJson(role), [34, 110]),
      info('Instructions', exampleGuide(role), [34, 110]),
    );
  } else if (kind === 'samples') {
    sheets.push(table('Data_Mapping_IRD', mappingRows(entries, role)));
  } else {
    const fields = kind === 'blank' ? [] : irdRows(entries, role);
    sheets.push(
      info('Overview', IRD_OVERVIEW, [52, 70]),
      {
        ...table('Field Mapping', fields.length ? fields : blankIRDRows(role), [
          ...IRD_COLUMNS[role],
        ]),
        pageSetup: {
          margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
        },
      },
      info('Instructions', irdInstructions(role), [34, 110]),
    );
  }
  return writeXlsx({ sheets });
}
