import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MAX_INPUT } from '../lib/json';
import { exportMapping } from '../lib/export';
import { needsSource, type ExportKind } from '../lib/ird';
import { importFile, formatFromName } from '../lib/importFile';
import { shareLink, readShared, MAX_SHARE_LENGTH } from '../lib/share';
import type { DocumentState } from './useDocument';
import { MOD, type Mode } from './prefs';

interface Options {
  doc: DocumentState;
  /** A plain message. */
  notify: (message: string) => void;
  /** A message after the source was replaced; offers Undo. */
  announce: (message: string) => void;
  mode: Mode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

const EXPORT_DONE: Record<ExportKind, string> = {
  'example-target': 'Example target downloaded',
  'example-mapping': 'Completed example IRD downloaded',
  samples: 'Sample mapping downloaded',
  ird: 'IRD template downloaded',
  blank: 'IRD template downloaded',
};

/** Everything that moves data in or out of the document: clipboard, files, share links, Excel. */
export function useIO({ doc, notify, announce, mode, inputRef }: Options) {
  const { input, output, entries, replace } = doc;
  const [exporting, setExporting] = useState(false);

  const copy = useCallback(
    async (text: string, message = 'Copied to clipboard') => {
      try {
        await navigator.clipboard.writeText(text);
        notify(message);
      } catch {
        notify('Clipboard unavailable. Select the text and copy it manually.');
      }
    },
    [notify],
  );

  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_INPUT) return notify('Choose a file smaller than 5 MiB.');
    const format = formatFromName(file.name);
    try {
      if (format && format !== 'json') {
        const imported = await importFile(file);
        replace(imported.text);
        return announce(imported.note || `Imported ${file.name} as JSON`);
      }
      replace((await file.text()).replace(/^\uFEFF/, ''));
      announce(`Opened ${file.name}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'The file could not be read. Try opening it again.');
    }
  };

  /** Converts pasted YAML, XML, or CSV in Source into JSON (runs in the import worker). */
  const convertSource = async (kind: 'yaml' | 'xml' | 'csv') => {
    try {
      const imported = await importFile(new File([input], `pasted.${kind}`));
      replace(imported.text);
      announce(`${kind.toUpperCase()} converted to JSON`);
    } catch (e) {
      notify(e instanceof Error ? e.message : `The ${kind.toUpperCase()} could not be read.`);
    }
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return notify('The clipboard is empty.');
      replace(text);
      announce('Pasted from clipboard');
    } catch {
      inputRef.current?.focus();
      notify(`Clipboard access was blocked. Press ${MOD} + V in Source instead.`);
    }
  };

  const exportExcel = async (kind: ExportKind) => {
    if ((needsSource(kind) && !entries.length) || exporting) return false;
    setExporting(true);
    try {
      await exportMapping(entries, kind);
      notify(EXPORT_DONE[kind]);
      return true;
    } catch {
      return false;
    } finally {
      setExporting(false);
    }
  };

  const share = async () => {
    if (!input.trim()) return notify('Add some JSON to share.');
    try {
      const link = await shareLink(output || input);
      if (link.length > MAX_SHARE_LENGTH)
        return notify('Too large for a link. Download the JSON and share the file instead.');
      await copy(link, 'Share link copied. The data travels inside the link only.');
    } catch {
      notify('This browser can’t create share links.');
    }
  };

  // Open a document shared through the URL fragment, then remove it from the address bar.
  const openShared = () => {
    if (!location.hash.startsWith('#json=')) return;
    readShared(location.hash)
      .then((text) => {
        if (text === null) return;
        replace(text);
        announce('Opened shared document');
      })
      .catch(() => notify('This share link is damaged or too large.'))
      .finally(() => window.history.replaceState(null, '', `${location.pathname}#${mode}`));
  };
  const openSharedRef = useRef(openShared);
  openSharedRef.current = openShared;
  useEffect(() => openSharedRef.current(), []);

  return {
    copy,
    readFile,
    convertSource,
    pasteClipboard,
    exportExcel,
    exporting,
    share,
    openSharedRef,
  };
}
