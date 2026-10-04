import { processJSON, type Indent } from '../lib/json';
import { repairJSON } from '../lib/repair';
self.onmessage = (event: MessageEvent<{ source: string; indent: Indent }>) => {
  const result = processJSON(event.data.source, event.data.indent);
  if (result.problem) result.repair = repairJSON(event.data.source) ?? undefined;
  self.postMessage(result);
};
