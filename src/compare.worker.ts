import { compareDocuments, type CompareRequest, type CompareResult } from './linediff';
export type CompareReply = { result: CompareResult; error?: undefined } | { error: string };
// Comparison runs here so a slow diff can be cancelled without freezing the page.
self.onmessage = (event: MessageEvent<CompareRequest>) => {
  let reply: CompareReply;
  try {
    reply = { result: compareDocuments(event.data) };
  } catch (error) {
    reply = {
      error: error instanceof Error ? error.message : 'Unable to compare these documents.',
    };
  }
  self.postMessage(reply);
};
