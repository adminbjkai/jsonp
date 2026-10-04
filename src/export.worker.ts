import { mappingRows, type MappingEntry } from './json';
import {
  IRD_HEADERS,
  IRD_OVERVIEW,
  IRD_INSTRUCTIONS,
  irdRows,
  blankIRDRows,
  type ExportKind,
} from './ird';
import { utils, write, type WorkSheet } from 'xlsx';
import {
  TARGET_FIELDS,
  TARGET_PROJECTS,
  TARGET_CREW,
  EXAMPLE_MAPPING,
  EXAMPLE_OVERVIEW,
  EXAMPLE_SOURCE,
  EXAMPLE_GUIDE,
} from './mapping-example';
interface ExportWorker {
  onmessage: ((event: MessageEvent<{ entries: MappingEntry[]; kind: ExportKind }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
const worker = self as unknown as ExportWorker;
const widths = (sheet: WorkSheet, rows: Record<string, unknown>[]) => {
  sheet['!cols'] = Object.keys(rows[0] || {}).map((key) => ({
    wch: Math.min(
      60,
      rows.reduce((max, row) => Math.max(max, String(row[key] ?? '').length), key.length) + 3,
    ),
  }));
  sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:J1' };
};
worker.onmessage = (event) => {
  try {
    const { entries, kind } = event.data;
    const workbook = utils.book_new();
    if (kind === 'example-target' || kind === 'example-mapping') {
      const addRows = (name: string, rows: Record<string, unknown>[]) => {
        const sheet = utils.json_to_sheet(rows);
        widths(sheet, rows);
        utils.book_append_sheet(workbook, sheet, name);
      };
      const addInfo = (name: string, rows: string[][]) => {
        const sheet = utils.aoa_to_sheet(rows);
        sheet['!cols'] = [{ wch: 34 }, { wch: 110 }];
        utils.book_append_sheet(workbook, sheet, name);
      };
      addInfo('Overview', EXAMPLE_OVERVIEW);
      if (kind === 'example-mapping') addRows('Field Mapping', EXAMPLE_MAPPING);
      addRows('Target Fields', TARGET_FIELDS);
      addRows('Projects', TARGET_PROJECTS);
      addRows('Crew', TARGET_CREW);
      addInfo('Source JSON', EXAMPLE_SOURCE);
      addInfo('Instructions', EXAMPLE_GUIDE);
    } else if (kind === 'samples') {
      const rows = mappingRows(entries);
      const sheet = utils.json_to_sheet(rows);
      widths(sheet, rows);
      utils.book_append_sheet(workbook, sheet, 'Data_Mapping_IRD');
    } else {
      const overview = utils.aoa_to_sheet(IRD_OVERVIEW);
      overview['!cols'] = [{ wch: 52 }, { wch: 70 }];
      utils.book_append_sheet(workbook, overview, 'Overview');
      const fields = kind === 'blank' ? blankIRDRows() : irdRows(entries);
      const sheet = utils.json_to_sheet(fields.length ? fields : blankIRDRows(), {
        header: [...IRD_HEADERS],
      });
      widths(sheet, fields.length ? fields : blankIRDRows());
      sheet['!margins'] = {
        left: 0.3,
        right: 0.3,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      };
      utils.book_append_sheet(workbook, sheet, 'Field Mapping');
      const guide = utils.aoa_to_sheet(IRD_INSTRUCTIONS);
      guide['!cols'] = [{ wch: 34 }, { wch: 110 }];
      utils.book_append_sheet(workbook, guide, 'Instructions');
    }
    const buffer = write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    worker.postMessage({ buffer }, [buffer]);
  } catch {
    worker.postMessage({ error: 'Unable to generate the workbook.' });
  }
};
