import { validateDocument } from '../lib/validate';
// Validation runs here so a pathological schema pattern can be stopped without freezing the page.
self.onmessage = (event: MessageEvent<{ source: string; schema: string }>) => {
  self.postMessage(validateDocument(event.data.source, event.data.schema));
};
