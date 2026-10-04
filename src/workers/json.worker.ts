import { processJSON, type DocumentResult, type Indent } from '../lib/json';
import { repairJSON } from '../lib/repair';
export interface WorkerRequest {
  seq: number;
  source: string;
  indent: Indent;
}
export interface WorkerReply {
  seq: number;
  result: DocumentResult;
}
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { seq, source, indent } = event.data;
  const result = processJSON(source, indent);
  if (result.problem) result.repair = repairJSON(source) ?? undefined;
  self.postMessage({ seq, result } satisfies WorkerReply);
};
