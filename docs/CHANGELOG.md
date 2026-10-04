# Changelog

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
