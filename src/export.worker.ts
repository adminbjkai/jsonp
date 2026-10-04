import type { MappingEntry } from './json';
import type { ExportKind } from './ird';
import { buildWorkbook } from './workbooks';
interface ExportWorker {
  onmessage: ((event: MessageEvent<{ entries: MappingEntry[]; kind: ExportKind }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
const worker = self as unknown as ExportWorker;
worker.onmessage = async (event) => {
  try {
    const { entries, kind } = event.data;
    const bytes = await buildWorkbook(kind, entries);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    worker.postMessage({ buffer }, [buffer as ArrayBuffer]);
  } catch {
    worker.postMessage({ error: 'Unable to generate the workbook.' });
  }
};
