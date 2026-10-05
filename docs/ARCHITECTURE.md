# Architecture

JSON Prettify is a static single-page app: React 19, TypeScript (strict), and Vite. It has no backend, no network calls, and no analytics. Everything happens in the browser; a document leaves the device only when you copy a share link, which carries the data inside the URL fragment.

This page explains how a document travels through the app, where each responsibility lives, and the decisions that keep it accurate and light. The [README](../README.md) covers using it; [DEPLOYMENT](DEPLOYMENT.md) covers shipping it.

## The one idea: a lossless entry list

Everything the app shows about a document comes from one list of **entries**, produced from the source text by a tokenizer that never goes through `JSON.parse` values:

```
source text ──▶ processJSON ──▶ { output, entries[], warnings, error }
```

Each `Entry` is one value in document order: its JSON Pointer `path`, `parts` (keys and array indexes), `type`, the **exact source token** as `value`, the source range (`start`, `end`, `keyStart`), the formatted-output range, line numbers, and `count` for containers.

Because numbers and strings stay as written, `9007199254740993`, `1.50`, and escaped strings survive formatting, search, copying, and export unchanged. Duplicate keys are kept in order and flagged rather than collapsed. Paths are pointers internally (so `a/b` and `0` never collide) and are displayed as JSONPath, JSON Pointer, or JavaScript on demand.

Every view (code, tree, table, graph, path bar, status line, export) reads this same list. None of them re-parses the document, so they cannot disagree about what a value is or where it lives.

## Data flow

```
┌───────────── main thread ─────────────┐        ┌───────── workers ─────────┐
│ SourceEditor ─▶ useDocument ──────────┼──post──▶ json.worker               │
│   (text)        input, active,        │ ◀─reply─ processJSON + repair      │
│                 undo/redo, indent     │        └───────────────────────────┘
│        │                              │
│        ▼  { output, entries }         │        one-shot, terminated after use:
│  useSearch ─ text match (in memory)   │        query.worker    JSONPath query
│            └ `$…` query ──────────────┼──────▶ validate.worker JSON Schema
│        │                              │        compare.worker  structural diff
│        ▼  results, matches, step      │        import.worker   YAML/XML/CSV/XLSX/ODS
│  Views: Code · Tree · Table · Graph   │        export.worker   XLSX workbooks
│  PathBar · StatusBar · Export         │
└───────────────────────────────────────┘
```

**Editing.** `useDocument` owns the source text, its processed result, the selected path, and undo history. Edits are debounced (180 ms) and sent to one long-lived `json.worker`. Each request takes a sequence ticket at the moment of the edit, so a reply to older input is discarded even while a newer request is waiting out its debounce. A worker that falls behind is replaced, and an idle one is released after 30 seconds. Large documents therefore never block typing, and a stale result can never overwrite a newer edit.

**Selection.** There is one selected path (`doc.active`). A click in the tree, table, or graph, a step through search matches, or the caret moving in Source all call the same `select(path)`, which sets the path, selects the value's range in Source, and scrolls it into view. Every view highlights from that one path. The path bar shows it with copy options, so the live path is always the one in the entry list, including when the same field name exists under several branches.

**Search.** `useSearch` turns a query into one ordered list of matching entries, which any view can step through.

- Plain text matches keys, values, types, and paths on the main thread with a matcher that skips building paths whenever the query cannot match one (about 12–20 ms per keystroke for plain words at 270,000 values; queries containing `/`, `.`, `[`, or spaces cost more because every path is built).
- A query starting with `$` runs as JSONPath in a worker with a 5-second limit; its result paths are mapped back to entries.
- Enter and Shift+Enter step through matches by selecting each one, so the path bar, code, tree, table, and graph follow. The Find bar sits above the output in Format and above the panes in Workspace, so search works in both.

**Long-running work** (queries, schema validation, comparison, file import, Excel export) runs in a fresh worker that is terminated when it answers or times out, so none of them can freeze the page and none keeps memory after it finishes.

## Code map

| Area                              | Files                                                                                                           | Responsibility                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/` (pure logic, no React) | `json.ts`, `locate.ts`, `repair.ts`, `tree.ts`                                                                  | Lossless processing and entries; plain-language syntax errors; token-level repair; the lossless tree and its transforms          |
|                                   | `query.ts`, `treeview.ts`, `colors.ts`                                                                          | JSONPath engine; tree helpers (child previews, match highlighting); color-value detection                                        |
|                                   | `convert.ts`, `validate.ts`, `diff.ts`, `linediff.ts`                                                           | Type/data conversions; JSON Schema checks; structural and line diffs                                                             |
|                                   | `importFile.ts`, `importers.ts`, `export.ts`, `workbooks.ts`, `ird.ts`, `mapping-example.ts`, `share.ts`        | File import; downloads; Excel IRD workbooks for JSON as source or target; share links                                            |
| `src/workers/`                    | `json`, `query`, `validate`, `compare`, `import`, `export`                                                      | Thin message wrappers around `lib` functions                                                                                     |
| `src/state/` (hooks)              | `useDocument`, `useEditor`, `useSearch`, `useIO`, `useSettings`, `useLayout`, `useDialogs`, `useToast`, `prefs` | Document and history; Source caret and selection; search; clipboard, files, share, export; preferences; panes; dialogs; messages |
| `src/components/`                 | `App` composition in `src/App.tsx`; `FormatMode`, `WorkspaceMode`, `CompareView`                                | The three modes. `App` wires the hooks into `AppContext` and renders the active mode                                             |
|                                   | `Explorer`, `TableView`, `Graph`, `OutputBody`, `PathBar`, `FindBar`, `LookupBar`                               | Views over the entry list, the selected-value bar, and Find                                                                      |
|                                   | `Menu`, `CommandPalette`, `Toast`, `*Dialog`, `Header`, `StatusBar`, `Welcome`                                  | Shared chrome                                                                                                                    |
| `src/actions.tsx`                 |                                                                                                                 | Every user action (label, shortcut, enabled state, run) in one table, feeding menus, the command palette, and shortcuts          |
| `src/styles/`                     | `tokens`, `base`, `shell`, `panes`, `explorer`, `dialogs`, `graph`, `compare`                                   | Design tokens, then focused layers                                                                                               |
| `public/theme.js`                 |                                                                                                                 | Applies the saved or system theme before first paint, as an external script that the CSP allows                                  |

Dependencies point downwards: components use state hooks and `lib`; hooks use `lib`; `lib` knows nothing about React. Workers import only `lib`.

## The tree

`Explorer` is the WAI-ARIA tree pattern over the entry list.

- **Virtualized.** Only the visible rows exist in the page (30 px rows, or 50 px when paths are shown), so a 300,000-value document scrolls as smoothly as a small one.
- **One tab stop.** The container holds focus and points at the active row with `aria-activedescendant`; rows are `treeitem`s with `aria-level`, `aria-expanded`, and `aria-selected`.
- **Keyboard.** ↑/↓, PageUp/PageDown, Home/End; → expands then steps into a branch; ← collapses then steps to the parent; Enter or Space toggles; `*` expands everything under a branch; typing jumps to the next key with that prefix; Ctrl/⌘ + C copies the path.
- **Collapsed branches stay informative.** A closed branch shows a preview of its children and a count.
- **Search replaces the tree with the result list** (flat, with paths), keeps the current selection when it is a match, and highlights the matching text. Selecting anything from elsewhere opens the branches above it.
- Rows show a type badge, the key, the value, and hover actions to copy the path or the value.

## Graph and table

The graph (React Flow, loaded on demand) shows containers as cards with their primitive fields as rows, capped at 1,500 visible cards (documents over 300 cards start collapsed); selection from anywhere centres it, and search matches are marked. The table shows arrays of records as a sortable, filterable, virtualized grid. Neither owns state: both receive `entries`, `active`, and `select`; the graph also receives `matches`.

## Excel IRD export

`ird.ts` derives one row per JSON field (repeated array records merge into reusable `[*]` paths, with observed types joined by `|`) and defines the column layouts for the two roles: **JSON is the source** (Source columns filled) and **JSON is the target** (Target columns filled). `mapping-example.ts` holds the bundled worked example as one eleven-field contract, read forward (JSON → tables) and backward (tables → JSON). `workbooks.ts` builds the sheets with hucre inside `export.worker.ts`. Sample values are only sent to the worker for the "Mapping with samples" option; clean templates receive structure only.

## Design system

"Marker on ink": neutral surfaces, monochrome controls, and one amber marker for _where you are_ (selection, matches, changes, errors). Tokens in `tokens.css` define both themes, type, spacing, and motion; the theme follows the OS until you choose one. Fonts (Schibsted Grotesk, Red Hat Mono) are bundled. Layout uses container queries so panes adapt to their own width rather than the window's, and menus are positioned in window coordinates so no clipping ancestor can cut them off.

## Security and privacy

- nginx serves a strict CSP: scripts, workers, fonts, and connections are `'self'` only; inline styles are allowed solely for positioned and virtualized rows. No third-party requests exist.
- The page is read-only static content: no cookies, no accounts, nothing stored server-side. Preferences and an auto-saved draft (up to 2 MiB) live in `localStorage` on the device.
- Share links keep the data in the URL fragment (never sent to the server) and are capped at 60,000 characters.
- Container: non-root nginx, read-only filesystem, no capabilities, 64 MiB memory limit.

## Limits

Source 5 MiB (UTF-16 code units); imported files 5 MiB; 300,000 values; 256 nesting levels; 20 MiB of formatted output; JSONPath queries stop after 5 seconds; the graph draws up to 1,500 cards; undo keeps 30 steps within 16 million characters. Exceeding a limit gives an explicit message and leaves your source intact.

## Testing

| Layer   | Tool                                        | What it protects                                                                                                                                          |
| ------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit    | `node:test` through `tsx`                   | Lossless numbers and escapes, entry offsets (including property tests), the search matcher, JSONPath, repair, conversions, diffs, IRD rows, and workbooks |
| Browser | Playwright with axe                         | Format, Workspace, and Compare on desktop and mobile; search and live path; the tree's keyboard model; downloads; themes; accessibility in both themes    |
| Static  | `tsc --strict` with unused checks, Prettier | Dead code and drift                                                                                                                                       |
| Release | `scripts/deploy.sh`                         | `check`, browser tests on the production build, `npm audit`, a rollback image, then browser tests against the container                                   |

`npm run check` runs formatting, types, unit tests, and the build. The browser suite runs with `npm run test:e2e`, or against any deployment with `TEST_URL`.

## Performance decisions

- **Workers by default** for anything that scales with document size; none on the typing path except the one persistent processor.
- **One pass, one list.** Processing yields all views' data at once; views never re-derive structure.
- **Virtualize lists** (tree, table, code) so cost follows the viewport, not the document.
- **Lazy chunks.** The graph, compare view, and each worker load only when used; the main bundle is about 105 KB gzipped, with fonts cached for a year.
- **No work while idle.** Workers are released when idle; menus and observers attach only while open.

## Extending

- **A new action:** add it to `src/actions.tsx`; it appears in menus, the palette, and shortcuts together.
- **A new view of the document:** accept `entries`, `active`, `select`, and (for search) `matches`; do not parse the source yourself.
- **A new conversion or import:** add a pure function to `lib`, call it from a worker, and cover it with a unit test.
- **A new export option:** extend `ExportKind` and `buildWorkbook`, add the dialog entry for each role, and add a workbook test.
