import { importBytes } from './importers';
interface ImportWorker {
  onmessage: ((event: MessageEvent<{ name: string; bytes: Uint8Array }>) => void) | null;
  postMessage: (message: unknown) => void;
}
const worker = self as unknown as ImportWorker;
worker.onmessage = async (event) => {
  try {
    const { name, bytes } = event.data;
    worker.postMessage({ result: await importBytes(name, bytes) });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : 'Import failed.' });
  }
};
