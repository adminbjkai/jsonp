import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLE, type DocumentResult, type Indent } from '../lib/json';
import { parseTree, type Node } from '../lib/tree';
import { sniffText } from '../lib/importFile';
import type { WorkerReply } from '../workers/json.worker';
import { initialDraft, save, saved } from './prefs';

const EMPTY: DocumentResult = { output: '', entries: [], warnings: [], error: null };
const DEBOUNCE = 180;
/** The worker is released after this much idle time. */
const IDLE_WORKER = 30_000;
const HISTORY_STEPS = 30;
/** Undo history is trimmed oldest-first beyond this many characters in total. */
const HISTORY_CHARS = 16 * 1024 * 1024;

const remember = (stack: string[], text: string) => {
  const next = [...stack.slice(-(HISTORY_STEPS - 1)), text];
  let total = next.reduce((sum, item) => sum + item.length, 0);
  while (total > HISTORY_CHARS && next.length > 1) total -= next.shift()!.length;
  return next;
};

/**
 * The document: source text, its background-processed result, the selected value, and undo history.
 * One long-lived worker handles edits; it is replaced if it falls behind and released when idle.
 */
export function useDocument() {
  const [input, setInput] = useState(initialDraft);
  const [result, setResult] = useState<DocumentResult>(EMPTY);
  const [processedInput, setProcessedInput] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [indent, setIndentState] = useState<Indent>(() => {
    const value = saved<unknown>('jsonp.indent', 2);
    return value === '\t' || value === 0 || value === 2 || value === 3 || value === 4 ? value : 2;
  });
  /** The last non-compact indentation, restored by Beautify. */
  const [lastIndent, setLastIndent] = useState<Indent>(indent || 2);
  const [active, setActive] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'key' | 'value'>('value');
  /** Counts every replace, undo, and redo, so a toast can tell whether its change is still the latest. */
  const revision = useRef(0);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const setIndent = useCallback((next: Indent) => {
    setIndentState(next);
    if (next) setLastIndent(next);
    save('jsonp.indent', next);
  }, []);

  // ---- Background processing -------------------------------------------------------------
  const job = useRef({
    worker: undefined as Worker | undefined,
    seq: 0,
    outstanding: 0,
    idle: undefined as ReturnType<typeof setTimeout> | undefined,
    /** The source of the most recent request: what a reply or failure is reported against. */
    source: '',
  });
  const releaseWorker = useCallback(() => {
    const state = job.current;
    clearTimeout(state.idle);
    state.worker?.terminate();
    state.worker = undefined;
    state.outstanding = 0;
  }, []);
  useEffect(() => releaseWorker, [releaseWorker]);
  useEffect(() => {
    setBusy(true);
    // The ticket is taken now, not when the request is sent: a reply to any earlier edit is stale
    // from this moment, even while this one waits out the debounce.
    const state = job.current;
    const seq = ++state.seq;
    const timer = setTimeout(() => {
      clearTimeout(state.idle);
      // Anything still running was started for older input, so it is not worth finishing.
      if (state.worker && state.outstanding) releaseWorker();
      if (!state.worker) {
        const worker = new Worker(new URL('../workers/json.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          state.outstanding = Math.max(0, state.outstanding - 1);
          if (state.outstanding === 0)
            state.idle = setTimeout(() => state.worker === worker && releaseWorker(), IDLE_WORKER);
          if (event.data.seq !== state.seq) return;
          setResult(event.data.result);
          setProcessedInput(state.source);
          setBusy(false);
        };
        worker.onerror = () => {
          const source = state.source;
          releaseWorker();
          setResult({ ...EMPTY, error: 'Processing failed. Reload the page and try again.' });
          setProcessedInput(source);
          setBusy(false);
        };
        state.worker = worker;
      }
      state.source = input;
      state.outstanding++;
      state.worker.postMessage({ seq, source: input, indent });
    }, DEBOUNCE);
    return () => clearTimeout(timer);
  }, [input, indent, releaseWorker]);

  // ---- Derived state ---------------------------------------------------------------------
  const current = processedInput === input && !busy;
  const entries = current ? result.entries : EMPTY.entries;
  const output = current ? result.output : '';
  const error = current ? result.error : null;
  const problem = current ? result.problem : undefined;
  const repair = current ? result.repair : undefined;
  const warnings = current ? result.warnings : EMPTY.warnings;
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const selected = active !== null ? entryMap.get(active) : undefined;
  const bytes = useMemo(() => new TextEncoder().encode(input).length, [input]);
  // Pasted YAML, XML, or CSV is offered a conversion instead of (or alongside) repair.
  const sniffed = useMemo(
    () => (problem && input.length < 5 * 1024 * 1024 ? sniffText(input) : null),
    [problem, input],
  );
  /** Lossless tree of the current source, parsed on first use. */
  const getTree = useMemo(() => {
    let cache: Node | null | undefined;
    return () => {
      if (cache === undefined)
        try {
          cache = parseTree(input);
        } catch {
          cache = null;
        }
      return cache;
    };
  }, [input]);

  // ---- Changing the source ---------------------------------------------------------------
  /** Replaces the whole source, keeping the previous text for Undo. */
  const replace = useCallback(
    (text: string) => {
      revision.current++;
      setUndoStack((prev) => remember(prev, input));
      setRedoStack([]);
      setActive(null);
      setInput(text);
    },
    [input],
  );
  /** Typing since the last replacement is kept on the redo stack, never lost. */
  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (previous === undefined) return false;
    revision.current++;
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((prev) => remember(prev, input));
    setActive(null);
    setInput(previous);
    return true;
  }, [undoStack, input]);
  const redo = useCallback(() => {
    const next = redoStack.at(-1);
    if (next === undefined) return false;
    revision.current++;
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((prev) => remember(prev, input));
    setActive(null);
    setInput(next);
    return true;
  }, [redoStack, input]);
  const loadSample = useCallback(() => replace(EXAMPLE), [replace]);

  return {
    input,
    setInput,
    replace,
    undo,
    redo,
    revision,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    loadSample,
    indent,
    lastIndent,
    setIndent,
    busy,
    current,
    entries,
    entryMap,
    output,
    error,
    problem,
    repair,
    warnings,
    sniffed,
    valid: entries.length > 0,
    selected,
    active,
    setActive,
    activeSection,
    setActiveSection,
    bytes,
    getTree,
  };
}

export type DocumentState = ReturnType<typeof useDocument>;
