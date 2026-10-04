import { useCallback, useRef } from 'react';
import { entryAtOffset, jsonPath } from '../lib/json';
import { serialize, nodeAt, type Node } from '../lib/tree';
import type { DocumentState } from './useDocument';
import type { LayoutState } from './useLayout';

const LINE = 22;

interface Options {
  doc: DocumentState;
  layout: LayoutState;
  notify: (message: string) => void;
  announce: (message: string) => void;
}

/** Keeps the Source textarea and the selected value in step, and applies edits to the source. */
export function useEditor({ doc, layout, notify, announce }: Options) {
  const { input, entries, entryMap, current, indent, output, repair, problem, error, replace } =
    doc;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollSource = (offset: number) => {
    const textarea = inputRef.current;
    if (textarea)
      textarea.scrollTop = Math.max(
        0,
        (input.slice(0, offset).match(/\n/g)?.length || 0) * LINE - textarea.clientHeight / 3,
      );
  };
  const select = useCallback(
    (path: string) => {
      const entry = entryMap.get(path);
      if (!entry) return false;
      doc.setActive(path);
      doc.setActiveSection('value');
      inputRef.current?.setSelectionRange(entry.start, entry.end);
      scrollSource(entry.start);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entryMap, input],
  );
  /** Follows the caret in Source to the value under it. */
  const cursor = () => {
    const position = inputRef.current?.selectionStart;
    if (position === undefined || !current) return;
    const entry = entryAtOffset(entries, position);
    if (entry) doc.setActiveSection(position < entry.start ? 'key' : 'value');
    doc.setActive(entry?.path ?? null);
  };
  /** Shows the selected value in Source. */
  const reveal = useCallback(
    (path: string) => {
      select(path);
      layout.showSource();
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    },
    [select, layout],
  );
  const goToError = () => {
    if (!problem) return;
    layout.showSource();
    requestAnimationFrame(() => {
      const textarea = inputRef.current;
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(problem.offset, Math.min(input.length, problem.offset + 1));
      scrollSource(problem.offset);
    });
  };

  const formatSource = () => {
    if (!output) return notify(repair ? 'Repair the JSON first.' : 'Nothing to format yet.');
    replace(output);
    announce('Source formatted');
  };
  const repairSource = () => {
    if (!repair)
      return notify(error ? 'This JSON can’t be repaired automatically.' : 'Already valid');
    replace(repair.output);
    announce(`Repaired JSON: ${repair.fixes.join('; ')}`);
  };
  /** Applies a lossless tree transform to the source. */
  const transform = (message: string, change: (root: Node) => Node | string | null) => {
    const root = doc.getTree();
    if (!root) return notify('Fix the JSON in Source first.');
    const next = change(root);
    if (next === null) return;
    replace(typeof next === 'string' ? next : serialize(next, indent || 2));
    announce(message);
  };
  const extractSelected = () => {
    const { selected } = doc;
    if (!selected) return;
    transform(
      `Extracted ${jsonPath(selected.parts)}`,
      (root) => nodeAt(root, selected.parts) ?? null,
    );
  };
  const validateNow = () => {
    if (doc.busy || !current) return notify('Still checking… try again in a moment.');
    if (!input.trim()) return notify('Nothing to validate yet. Paste or open JSON first.');
    if (problem) {
      goToError();
      return notify(
        `Invalid JSON. Line ${problem.line + 1}, column ${problem.column}: ${problem.message}`,
      );
    }
    if (error) return notify(error);
    notify(`Valid JSON · ${entries.length.toLocaleString()} values`);
  };

  return {
    inputRef,
    select,
    cursor,
    reveal,
    goToError,
    formatSource,
    repairSource,
    transform,
    extractSelected,
    validateNow,
  };
}

export type EditorState = ReturnType<typeof useEditor>;
