import { mappingRows, type MappingEntry } from './json';
import { utils, write } from 'xlsx';
interface ExportWorker {
  onmessage: ((event: MessageEvent<MappingEntry[]>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
const worker = self as unknown as ExportWorker;
worker.onmessage = (event) => {
  try {
    const rows = mappingRows(event.data);
    const sheet = utils.json_to_sheet(rows);
    sheet['!cols'] = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.min(
        60,
        rows.reduce(
          (max, row) => Math.max(max, String(row[key as keyof typeof row]).length),
          key.length,
        ) + 3,
      ),
    }));
    sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:J1' };
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, 'Data_Mapping_IRD');
    const buffer = write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    worker.postMessage({ buffer }, [buffer]);
  } catch {
    worker.postMessage({ error: 'Unable to generate the workbook.' });
  }
};
