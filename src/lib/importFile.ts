/** Main-thread import helpers. Kept free of parser libraries so they stay out of the main bundle. */
export type ImportFormat = 'json' | 'yaml' | 'xml' | 'csv' | 'tsv' | 'xlsx' | 'ods';
/** `text` is 2-space strict JSON, or the original text for JSON files. */
export interface ImportResult {
  text: string;
  format: ImportFormat;
  note: string;
}
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_CELLS = 300_000;
export const IMPORT_TIMEOUT = 30_000;

const EXTENSIONS: Record<string, ImportFormat> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  xlsx: 'xlsx',
  ods: 'ods',
};
export function formatFromName(name: string): ImportFormat | null {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return (match && EXTENSIONS[match[1].toLowerCase()]) || null;
}

const lines = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 20);
// Delimiters outside double quotes on one line.
const count = (line: string, delimiter: string) => {
  let quoted = false;
  let total = 0;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) total++;
  }
  return total;
};
// A line that can appear in block YAML: document markers, comments, list items, `key: value`,
// or an indented continuation.
const KEY = String.raw`(?:[A-Za-z_$@./-][^:#]*|'[^']*'|"[^"]*"):(?:\s.*)?`;
const YAML_LINE = new RegExp(
  String.raw`^(?:---(?:\s.*)?|\.\.\.|#.*|\s*-(?:\s.*)?|${KEY}|\s+\S.*)$`,
);
const YAML_ENTRY = new RegExp(String.raw`^\s*(?:-(?:\s.*)?|${KEY})$`);
const XML =
  /^(?:<\?xml[\s?]|<!DOCTYPE\s)|^<([A-Za-z_][\w.:-]*)[\s\S]*<\/\1\s*>$|^<[A-Za-z_][^<>]*\/>$/i;

/**
 * Detects obvious XML, YAML, or CSV in pasted text that failed JSON.parse. Conservative: text
 * that starts like JSON or ends lines with JSON punctuation is left to repair.
 */
export function sniffText(text: string): 'yaml' | 'xml' | 'csv' | null {
  const source = text.replace(/^\ufeff/, '').trim();
  if (!source || /^[{["]/.test(source)) return null;
  if (XML.test(source)) return 'xml';
  if (source.startsWith('<')) return null;
  const sample = lines(source);
  if (
    sample.every((line) => YAML_LINE.test(line) && !/[,{[]\s*$/.test(line)) &&
    (source.startsWith('---') || sample.filter((line) => YAML_ENTRY.test(line)).length >= 2)
  )
    return 'yaml';
  if (sample.length >= 2)
    for (const delimiter of [',', '\t', ';']) {
      const first = count(sample[0], delimiter);
      if (first && sample.every((line) => count(line, delimiter) === first)) return 'csv';
    }
  return null;
}

/** Converts a file in a background worker; rejects after 30 seconds. */
export async function importFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name} is larger than 5 MiB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Import timed out.'));
    }, IMPORT_TIMEOUT);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ result?: ImportResult; error?: string }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || 'Import failed.'));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Import failed.'));
    };
    worker.postMessage({ name: file.name, bytes }, [bytes.buffer]);
  });
}
