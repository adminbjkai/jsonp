import { parseTree, serialize } from './tree';
import { runQuery } from './query';
import { pointer } from './json';
export interface QueryReply {
  error: string | null;
  paths: string[];
  json: string;
}
// Queries run here so a slow filter can be stopped without freezing the page.
self.onmessage = (event: MessageEvent<{ source: string; expression: string }>) => {
  let reply: QueryReply;
  try {
    const matches = runQuery(parseTree(event.data.source), event.data.expression);
    reply = {
      error: null,
      paths: matches.map((match) => pointer(match.parts)),
      json: serialize({ type: 'array', items: matches.map((match) => match.node) }, 2),
    };
  } catch (error) {
    reply = {
      error: error instanceof Error ? error.message : 'Invalid query.',
      paths: [],
      json: '',
    };
  }
  self.postMessage(reply);
};
