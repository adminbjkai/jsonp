import type { RefObject } from 'react';
import {
  Braces,
  Copy,
  Download,
  Upload,
  Network,
  Sun,
  Moon,
  RotateCcw,
  FileSpreadsheet,
  WrapText,
  Undo2,
  Redo2,
  ArrowRight,
  Search,
  CircleHelp,
  Wrench,
  Shuffle,
  GitCompareArrows,
  Table2,
  Link2,
  ClipboardPaste,
  FilePlus2,
  ArrowDownAZ,
  Eraser,
  Minimize,
  Quote,
  TextQuote,
  Scissors,
  Sheet,
  BarChart3,
  Save,
  Crosshair,
  ShieldCheck,
  CheckCircle2,
  Wand2,
  LayoutPanelLeft,
} from 'lucide-react';
import type { Indent } from './lib/json';
import { download } from './lib/export';
import { serialize, sortKeys, prune, escapeJSON, unescapeJSON } from './lib/tree';
import { FORMATS, type Format } from './lib/convert';
import type { MenuItem } from './components/Menu';
import type { Command } from './components/CommandPalette';
import { MODES, MOD, type Mode } from './state/prefs';
import type { DocumentState } from './state/useDocument';
import type { useIO } from './state/useIO';
import type { useSettings } from './state/useSettings';
import type { LayoutState } from './state/useLayout';
import type { EditorState } from './state/useEditor';
import type { Dialogs } from './state/useDialogs';

export const INDENTS: { value: string; label: string; indent: Indent }[] = [
  { value: '2', label: '2 spaces', indent: 2 },
  { value: '3', label: '3 spaces', indent: 3 },
  { value: '4', label: '4 spaces', indent: 4 },
  { value: 'tab', label: 'Tabs', indent: '\t' },
];
export const indentKey = (indent: Indent) => (indent === '\t' ? 'tab' : String(indent));

export interface ActionContext {
  doc: DocumentState;
  io: ReturnType<typeof useIO>;
  settings: ReturnType<typeof useSettings>;
  layout: LayoutState;
  editor: EditorState;
  dialogs: Dialogs;
  mode: Mode;
  switchMode: (mode: Mode) => void;
  notify: (message: string) => void;
  /** A message after the source was replaced; offers Undo. */
  announce: (message: string) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  openConvert: (format?: Format, path?: string) => void;
  focusSearch: (query?: string) => void;
}

type Action = MenuItem & { hint?: string; keywords?: string };

/** One action list feeds the menus, the command palette, and keyboard shortcuts. */
export function createActions(ctx: ActionContext) {
  const {
    doc,
    io,
    settings,
    layout,
    editor,
    dialogs,
    mode,
    switchMode,
    notify,
    announce,
    fileRef,
  } = ctx;
  const { input, output, repair, valid, selected, sniffed } = doc;
  const icon = (Icon: typeof Braces) => <Icon size={15} />;
  const canExtract = valid && !!selected && selected.parts.length > 0;

  const actions = {
    open: { label: 'Open file…', icon: icon(Upload), run: () => fileRef.current?.click() },
    paste: { label: 'Paste from clipboard', icon: icon(ClipboardPaste), run: io.pasteClipboard },
    sample: {
      label: 'Load sample',
      icon: icon(Braces),
      run: () => {
        doc.loadSample();
        announce('Sample loaded');
      },
    },
    clear: {
      label: 'Clear source',
      icon: icon(FilePlus2),
      disabled: !input,
      run: () => {
        doc.replace('');
        announce('Source cleared');
      },
    },
    format: {
      label: 'Format source',
      icon: icon(ArrowRight),
      hint: `${MOD} Enter`,
      disabled: !output,
      run: editor.formatSource,
    },
    repair: {
      label: 'Repair JSON',
      icon: icon(Wrench),
      disabled: !repair,
      run: editor.repairSource,
    },
    minify: {
      label: 'Minify',
      icon: icon(Minimize),
      disabled: !valid,
      run: () => editor.transform('Minified', (root) => serialize(root, 0)),
    },
    sort: {
      label: 'Sort keys A–Z',
      icon: icon(ArrowDownAZ),
      disabled: !valid,
      run: () => editor.transform('Keys sorted A–Z', (root) => sortKeys(root)),
    },
    nulls: {
      label: 'Remove null values',
      icon: icon(Eraser),
      disabled: !valid,
      run: () => editor.transform('Null values removed', (root) => prune(root)),
    },
    empty: {
      label: 'Remove empty values',
      icon: icon(Eraser),
      disabled: !valid,
      run: () =>
        editor.transform('Nulls, empty strings, and empty containers removed', (root) =>
          prune(root, true),
        ),
    },
    extract: {
      label: 'Keep only the selected value',
      icon: icon(Scissors),
      disabled: !canExtract,
      run: editor.extractSelected,
    },
    escape: {
      label: 'Escape as a JSON string',
      icon: icon(Quote),
      disabled: !valid,
      run: () => editor.transform('Escaped as a string', (root) => escapeJSON(root)),
    },
    unescape: {
      label: 'Unescape JSON string',
      icon: icon(TextQuote),
      disabled: !valid || doc.entries[0]?.type !== 'string',
      run: () =>
        editor.transform('Unescaped', (root) => {
          const inner = unescapeJSON(root);
          if (!inner) notify('Source is a string, but it doesn’t contain JSON.');
          return inner;
        }),
    },
    csv: {
      label: sniffed
        ? `Convert ${sniffed.toUpperCase()} in Source to JSON`
        : 'Convert YAML, XML, or CSV in Source to JSON',
      icon: icon(Sheet),
      keywords: 'yaml xml csv import',
      disabled: !sniffed,
      run: () => {
        if (sniffed) void io.convertSource(sniffed);
      },
    },
    undo: {
      label: 'Undo last change',
      icon: icon(Undo2),
      disabled: !doc.canUndo,
      run: () => doc.undo() && notify('Undone. Redo brings it back.'),
    },
    redo: {
      label: 'Redo',
      icon: icon(Redo2),
      disabled: !doc.canRedo,
      run: () => doc.redo() && notify('Redone'),
    },
    copy: {
      label: 'Copy formatted JSON',
      icon: icon(Copy),
      hint: `${MOD} ⇧ C`,
      disabled: !output,
      run: () => void io.copy(output, 'Formatted JSON copied'),
    },
    copyMinified: {
      label: 'Copy minified JSON',
      icon: icon(Minimize),
      disabled: !valid,
      run: () => {
        const root = doc.getTree();
        if (root) void io.copy(serialize(root, 0), 'Minified JSON copied');
      },
    },
    download: {
      label: 'Download JSON',
      icon: icon(Download),
      hint: `${MOD} S`,
      disabled: !output,
      run: () => download(output, 'formatted.json'),
    },
    convert: {
      label: 'Convert to code types or data formats…',
      icon: icon(Shuffle),
      disabled: !valid,
      run: () => ctx.openConvert(),
    },
    schema: {
      label: 'Validate against a JSON Schema…',
      icon: icon(ShieldCheck),
      keywords: 'schema validation ajv',
      disabled: !valid,
      run: () => dialogs.open('schema'),
    },
    excel: {
      label: 'Excel IRD workbook…',
      icon: icon(FileSpreadsheet),
      run: () => dialogs.open('export'),
    },
    share: {
      label: 'Copy share link',
      icon: icon(Link2),
      disabled: !input.trim(),
      run: () => void io.share(),
    },
  } satisfies Record<string, Action>;

  const groups = [
    ['File', ['open', 'paste', 'sample', 'clear']],
    [
      'Edit',
      [
        'format',
        'repair',
        'minify',
        'sort',
        'nulls',
        'empty',
        'extract',
        'escape',
        'unescape',
        'csv',
        'undo',
        'redo',
      ],
    ],
    ['Export', ['copy', 'copyMinified', 'download', 'convert', 'excel', 'share']],
  ] as const;

  const toggleTheme = () => settings.setTheme(settings.theme === 'dark' ? 'light' : 'dark');
  const modeIcon = (id: Mode) =>
    id === 'format'
      ? icon(Wand2)
      : id === 'workspace'
        ? icon(LayoutPanelLeft)
        : icon(GitCompareArrows);

  const commands: Command[] = [
    ...groups.flatMap(([group, ids]) => ids.map((id) => ({ id, group, ...actions[id] }))),
    ...FORMATS.map((format) => ({
      id: `to-${format.id}`,
      group: 'Convert',
      label: `Convert to ${format.id === 'typescript' ? 'TypeScript types' : format.label}`,
      icon: icon(Shuffle),
      keywords: format.description,
      disabled: !valid,
      run: () => ctx.openConvert(format.id),
    })),
    ...MODES.map((m) => ({
      id: `mode-${m.id}`,
      group: 'Mode',
      label: m.id === 'compare' ? 'Compare two documents side by side' : `Switch to ${m.label}`,
      icon: modeIcon(m.id),
      keywords: m.id === 'compare' ? 'diff difference' : m.hint,
      disabled: mode === m.id,
      run: () => switchMode(m.id),
    })),
    {
      id: 'validate',
      group: 'Tools',
      label: 'Validate JSON syntax',
      icon: icon(CheckCircle2),
      keywords: 'check lint',
      run: editor.validateNow,
    },
    { id: 'schema', group: 'Tools', ...actions.schema },
    {
      id: 'query',
      group: 'Tools',
      label: 'Search or run a JSONPath query',
      icon: icon(Search),
      hint: `${MOD} F`,
      keywords: 'find filter',
      run: () => ctx.focusSearch(),
    },
    {
      id: 'insights',
      group: 'Tools',
      label: 'Document insights',
      icon: icon(BarChart3),
      keywords: 'stats statistics',
      run: () => dialogs.open('insights'),
    },
    {
      id: 'goto-error',
      group: 'Tools',
      label: 'Go to error',
      icon: icon(Crosshair),
      disabled: !doc.problem,
      run: editor.goToError,
    },
    {
      id: 'table',
      group: 'View',
      label: `${layout.order.includes('table') ? 'Hide' : 'Show'} table`,
      icon: icon(Table2),
      run: () => layout.toggle('table'),
    },
    {
      id: 'graph',
      group: 'View',
      label: `${layout.order.includes('graph') ? 'Hide' : 'Show'} graph`,
      icon: icon(Network),
      run: () => layout.toggle('graph'),
    },
    {
      id: 'wrap',
      group: 'View',
      label: `${settings.wrap ? 'Disable' : 'Enable'} line wrapping`,
      icon: icon(WrapText),
      run: () => settings.setWrap(!settings.wrap),
    },
    {
      id: 'theme',
      group: 'View',
      label: `Use ${settings.theme === 'dark' ? 'light' : 'dark'} theme`,
      icon: settings.theme === 'dark' ? icon(Sun) : icon(Moon),
      run: toggleTheme,
    },
    {
      id: 'layout',
      group: 'View',
      label: 'Reset layout',
      icon: icon(RotateCcw),
      run: () => {
        layout.reset();
        notify('Layout reset');
      },
    },
    ...[...INDENTS, { value: '0', label: 'Compact output', indent: 0 as Indent }].map((option) => ({
      id: `indent-${option.value}`,
      group: 'View',
      label: option.indent
        ? `Indent with ${option.label.toLowerCase()}`
        : 'Compact (minified) output',
      icon: icon(ArrowRight),
      run: () => doc.setIndent(option.indent),
    })),
    {
      id: 'remember',
      group: 'Settings',
      label: settings.remember
        ? 'Stop keeping my draft on this device'
        : 'Keep my draft on this device',
      icon: icon(Save),
      keywords: 'autosave persist restore',
      run: () => {
        settings.setRemember(!settings.remember);
        notify(
          settings.remember
            ? 'Draft removed from this device'
            : 'Your draft will be restored next time',
        );
      },
    },
    {
      id: 'help',
      group: 'Help',
      label: 'How to use JSON Prettify',
      icon: icon(CircleHelp),
      hint: `${MOD} /`,
      keywords: 'guide tutorial shortcuts',
      run: () => dialogs.open('help'),
    },
  ];

  return { actions, commands, toggleTheme };
}

export type Actions = ReturnType<typeof createActions>['actions'];
