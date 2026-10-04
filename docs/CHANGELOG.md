# Changelog

## 3.0.0 — 2026-10-04

Restructured into three modes, adopting the best parts of jsonformatter.org, JSON Crack, and hucre.

### Modes

- **Format** (new default for first visits): input on the left, a single column of labelled actions in the middle, output on the right.
  - Actions: Beautify (2, 3, or 4 spaces, or tabs), Minify, Validate, Repair, Sort keys, Convert, Schema, Compare, and Export.
  - Code, Tree, Table, and Graph output views; "Use the output as input".
- **Workspace:** the multi-pane explorer from 2.x.
- **Compare** (replaces the compare dialog):
  - Side-by-side, line-aligned diff with synced scrolling and character-level highlights.
  - An overview strip, Prev/Next with "i of N" (F7, Alt+↑/↓), and "Only changes" folding with expandable context.
  - Swap sides, sort keys, and ignore array order.
  - Each side can open, paste, use a sample, format, repair, and send its document to the workspace.
  - A clickable list of structural changes and a copyable report.
  - Handles about 120,000 lines per side, with alignment computed in a worker by jsdiff.
- Each mode has its own address (`#format`, `#workspace`, `#compare`), and the last mode is remembered.

### Graph

- Collapse and expand branches, collapse or expand everything, and show only one branch.
- Large documents start collapsed to 300 cards instead of hitting a 400-container limit.
- Explorer search and JSONPath matches are highlighted, and outside selections center the graph.
- Left-to-right or top-to-bottom layout, a minimap, a grid, and key labels on edges.
- Export a PNG or SVG of the whole graph, or copy a PNG.
- Colour swatches for hex, rgb(), and hsl() values, clickable URLs, both themes, and Shift+1 and Shift+2 shortcuts.

### Import and export

- Open YAML, XML, XLSX/XLS, and ODS as well as JSON and CSV/TSV. Pasted YAML, XML, or CSV is detected and offered a one-click conversion.
  - YAML numbers stay exact, anchors and multiple documents are supported, and XML values stay strings.
  - Imports run in a worker with size, cell, and zip-bomb limits.
- Excel export moved from vendored SheetJS 0.20.3 to hucre 1.1.0. The export worker went from 111 KB to 44 KB gzipped, and the vendored tarball was removed. Workbooks keep the same sheets, columns, values, widths, and autofilters, and now have bold, frozen header rows.
- New converters: Go, Rust (serde), Python dataclasses, Zod, Kotlin (kotlinx.serialization), C# (System.Text.Json), and XML. They join TypeScript, JSON Schema, YAML, and CSV in two groups, Types and Data.
- JSON Schema validation (drafts 4 to 2020-12, no eval): generate a schema from the document, validate, and click a problem to jump to it.

### Verified

- The structural change list now aligns array items, so one inserted item is reported as one addition instead of a cascade of positional changes.
- Hardening from an independent adversarial review:
  - **YAML import:** keeps key order, converts `!!set` and `!!omap`, and explains recursive anchors and complex keys in plain language.
  - **XML import:** decodes numeric character references.
  - **Empty or damaged spreadsheets:** these are refused instead of replacing the document with `[]`.
  - **Excel export:** text is sanitized for XML and Excel's 32,767-character cell limit.
  - **Schema validation:** runs in a worker with a 10-second limit.
  - **Big integers:** integers beyond 64 bits get arbitrary-precision types in Go, Rust, Kotlin, and C#.
  - **Share links:** a link pasted into an open tab now loads.
  - **Keyboard and settings:** Ctrl/⌘+F opens the Tree search from any Format view, Ctrl/⌘+Enter in Compare never reformats the main document, and an invalid saved mode falls back to Format.
- Verified: 141 unit tests and 36 browser scenarios against the production build cover the Format, Workspace, and Compare modes, graph features, imports, schema validation, accessibility checks in every mode and theme, and phone layouts. The independent pass also covered:
  - **Content security policy:** zero violations with the production header.
  - **Privacy:** no requests to other origins.
  - **Generated code:** compiled or executed checks for the TypeScript, Go, and Python output.
  - **Workbooks:** opened in LibreOffice and openpyxl.

## 2.0.0 — 2026-10-03

### Easier to learn

- Added a command palette (Ctrl/⌘ + K) that lists every action by name, with shortcuts. Actions that don't apply yet stay visible but dimmed.
- Grouped the toolbar into **Open**, **Tools**, **Convert**, **Compare**, **Table**, **Graph**, and **Export**.
- Added a dismissible getting-started banner on the first visit, and a Help dialog with a quick start, a description of each pane, clickable JSONPath examples, and shortcuts.
- Invalid JSON now reports its line, column, and a plain-language cause in every browser. **Go to error** selects the problem in Source, and the gutter marks the error line.
- An empty Source offers Open, Paste, and Try the sample.

### New capabilities

- **Repair:** one-click, token-level repair of comments, trailing and missing commas, single and smart quotes, unquoted keys, Python literals, NaN/Infinity/undefined, hex and malformed numbers, invalid escapes, control characters, JSONP and JavaScript wrappers, Markdown fences, unclosed brackets and strings, and NDJSON. The fixes are listed before you apply them, and exact numbers survive.
- **JSONPath queries** in the explorer search: wildcards, recursive descent, slices, unions, and filters. Results can be copied as a JSON array.
- **Transforms:** sort keys, remove nulls or empty values, minify, keep only the selection, escape as a JSON string, and unescape. All are lossless, with multi-step undo.
- **Convert** a whole document or a selection to TypeScript, JSON Schema 2020-12, YAML, or CSV, with preview, copy, and download.
- **Compare** two documents structurally, with an ignore-array-order option and a copyable report. Click a difference to select it.
- **Table** pane for arrays of records: sorting, filtering, virtualization, and selection linked to every other pane.
- **Insights:** type counts, depth, common keys, largest arrays, and the longest string.
- **CSV and TSV import** with exact numbers, delimiter detection, and quoted fields.
- **Share links** that keep the compressed document in the URL fragment, which is never sent to a server.
- An optional **saved draft** on this device, off by default.
- Source editor line numbers and Tab/Shift+Tab indentation. Ctrl/⌘ + F focuses the explorer search, except inside Source, where the browser's find still works.
- Raised the document limit from 50,000 to 300,000 values. A document that hits a limit now shows **Not processed** instead of **Invalid JSON**.
- Transforms keep the original spelling of string escapes, such as `\u00e9` and `\/`. Undo is multi-step, and Redo keeps anything typed since the last change.
- JSONPath filters compare numbers above 2^53 exactly. Queries run in a worker and stop after 5 seconds.
- Repair keeps stray backslashes in Windows paths and regular expressions.

### Verified

- 75 core tests and 17 browser scenarios, including accessibility checks of every new dialog, the menus, and the table.
- An independent adversarial pass covered 5 MiB documents, 20,000-row tables, deep nesting, `__proto__` keys, damaged share links, compression bombs, CSV formula injection, and ReDoS queries. It also checked that no request goes to any other origin. Every defect it found is fixed and covered by a regression test.

## 1.2.0 — 2026-10-03

- Added a known-target worked example to Export XLSX with paired target and completed IRD downloads, available independently of the editor.
- Defined Projects and Crew target tables, all eleven field contracts, keys, record creation rules, and validation policy. Included the bundled source and expected target output in both workbooks.
- Completed every target mapping with paths, types, cardinality, transformations, defaults, constraints, and descriptions. Kept existing clean, blank, and sample exports.
- Added contract/output coverage and browser checks for both workbooks, consistent target schemas, privacy, and invalid-source availability.
- Verified 19 core tests, all 10 browser scenarios against the production build and public HTTPS app, accessibility checks, and a zero-vulnerability dependency audit.

## 1.1.0 — 2026-10-03

- Full inline paths with a display-format selector and always-visible copy buttons.
- Parent breadcrumbs, one-click current-path copy, source reveal on desktop/mobile, and exact-value copying.
- Previous/next and keyboard navigation through visible results; selected references wrap for easier reading.
- Source selection no longer steals explorer focus. Ancestors expand when selecting hidden values, and selection stays visible after pane resizing.
- Added a prominent Export XLSX dialog. Its default is a clean IRD from the current JSON structure, with array records deduplicated into reusable paths and no sample values.
- Added a blank IRD export independent of JSON validity. Clean workbooks contain Overview, Field Mapping, and Instructions; mapping decisions remain empty.
- Retained the original mapping-with-samples export as a separate option.
- Added IRD regressions and browser coverage for workbook contents, blank export, inline paths, parent/keyboard navigation, and mobile source reveal.

- Verified: 16 core tests, strict TypeScript, production build, and all 9 browser scenarios against the deployed app, including accessibility and workbook contents. Dependency audit: zero known vulnerabilities.

## 1.0.0 — 2026-10-03

### Correctness

- Replaced parse/stringify formatting with validated token formatting so large integers, high precision decimals, exponents, negative zero, duplicate keys, and string escapes survive unchanged.
- Corrected RFC 6901 pointer escaping and root handling. Numeric object keys remain strings in JSONPath and JavaScript references.
- Added explicit value types so strings like `Object` and `Array(3)` are never mistaken for containers, and null/boolean/number values render correctly.
- Used exact source offsets and output line ranges for selection, including escaped and empty keys.
- Preserved Excel mapping fields and document order; sample numbers are exported as text.

### Performance and structure

- Moved formatting into a debounced worker and terminate superseded work. Excel generation also runs in a worker, keeping the interface responsive during exports.
- Virtualized explorer and output rows; added explicit document and graph budgets.
- Grouped graph properties in one pass and replaced fixed row spacing with height-aware tree layout.
- Split the formatter, explorer, output, graph, and export into small focused modules.
- Lazy-load graph and Excel chunks. Removed unused Gemini, Express, dotenv, source-map, animation, panel, and Tailwind packages and stale AI Studio configuration.
- Removed external font requests and added strict TypeScript and consistent formatting.
- Upgraded affected dependencies and replaced the outdated npm SheetJS package with its official 0.20.3 distribution.

### Interface

- Introduced charcoal/sage and warm light themes, clearer controls, mobile tabs, code colors, and line numbers.
- Retained draggable/resizable/collapsible panes, graph navigation, three path formats, per-row copy, sample/reset actions, and Excel mapping export.
- Added pane focus, file import/drop, path/value search, compact formatting, JSON download, undo last replacement, theme/pane-order preferences, and documented shortcuts.
- Added named controls, focus indicators, a keyboard-accessible modal, notifications for failed clipboard/export operations, and reduced-motion support.

### Production

- Replaced the Vite preview service with a non-root static nginx container.
- Bound the backend only to localhost, with health checks, a read-only filesystem, dropped capabilities, and CPU/memory/process limits.
- Added immutable asset caching, compression, response headers, and a content security policy.
- Added core regression tests and browser tests, including accessibility checks and large-document coverage.

### Verified release

- 11 core regression tests pass; strict TypeScript, formatting checks, and production build pass.
- All 6 browser scenarios pass against the Docker build and the public HTTPS app, including WCAG A/AA checks for both themes, mobile, and graph controls.
- Dependency audit reports zero known vulnerabilities at release time.
- Initial JavaScript: 223.13 kB (71.38 kB gzip). Graph (~145 kB) and Excel generation (~332 kB) are loaded on demand.
- Production container is healthy with two nginx processes and was observed below 10 MiB of idle memory; configured maximum is 64 MiB.
- Host nginx syntax check and public health endpoint pass; port 3100 and the former preview service are retired. Migration backups are under `/var/backups/jsonp/2026-10-03/`.
