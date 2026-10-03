import { processJSON } from './json';
self.onmessage = (event: MessageEvent<{ source: string; indent: number }>) => {
  self.postMessage(processJSON(event.data.source, event.data.indent));
};
