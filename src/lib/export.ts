import type { Entry } from './json';
import { needsSource, type ExportKind } from './ird';
export function download(content: BlobPart, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportMapping(entries: Entry[], kind: ExportKind = 'samples') {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Export timed out.'));
    }, 60_000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer; error?: string }>) => {
      finish();
      if (event.data.buffer) resolve(event.data.buffer);
      else reject(new Error(event.data.error || 'Export failed.'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Export failed.'));
    };
    worker.postMessage({
      kind,
      entries: !needsSource(kind)
        ? []
        : entries.map(({ path, parts, type, value }) => ({
            path,
            parts,
            type,
            value: kind === 'samples' ? value : '',
          })),
    });
  });
  download(
    buffer,
    `${{ samples: 'IRD_Mapping', blank: 'IRD_Blank_Template', ird: 'IRD_Mapping_Template', 'example-target': 'Orbital_Target_Example', 'example-mapping': 'Orbital_Completed_IRD' }[kind]}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
