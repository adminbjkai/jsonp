# Changes — 2026-10-03

## Correctness

- Replaced parse/stringify formatting with validated token formatting so large integers, high precision decimals, exponents, negative zero, duplicate keys, and string escapes survive unchanged.
- Corrected RFC 6901 pointer escaping and root handling. Numeric object keys remain strings in JSONPath and JavaScript references.
- Added explicit value types so strings like `Object` and `Array(3)` are never mistaken for containers, and null/boolean/number values render correctly.
- Used exact source offsets and output line ranges for selection, including escaped and empty keys.
- Preserved Excel mapping fields and document order; sample numbers are exported as text.

## Performance and structure

- Moved formatting into a debounced worker and terminate superseded work. Excel generation also runs in a worker, keeping the interface responsive during exports.
- Virtualized explorer and output rows; added explicit document and graph budgets.
- Grouped graph properties in one pass and replaced fixed row spacing with height-aware tree layout.
- Split the formatter, explorer, output, graph, and export into small focused modules.
- Lazy-load graph and Excel chunks. Removed unused Gemini, Express, dotenv, source-map, animation, panel, and Tailwind packages and stale AI Studio configuration.
- Removed external font requests and added strict TypeScript and consistent formatting.
- Upgraded affected dependencies and replaced the outdated npm SheetJS package with its official 0.20.3 distribution.

## Interface

- Introduced charcoal/sage and warm light themes, clearer controls, mobile tabs, code colors, and line numbers.
- Retained draggable/resizable/collapsible panes, graph navigation, three path formats, per-row copy, sample/reset actions, and Excel mapping export.
- Added pane focus, file import/drop, path/value search, compact formatting, JSON download, undo last replacement, theme/pane-order preferences, and documented shortcuts.
- Added named controls, focus indicators, a keyboard-accessible modal, notifications for failed clipboard/export operations, and reduced-motion support.

## Production

- Replaced the Vite preview service with a non-root static nginx container.
- Bound the backend only to localhost, with health checks, a read-only filesystem, dropped capabilities, and CPU/memory/process limits.
- Added immutable asset caching, compression, response headers, and a content security policy.
- Added core regression tests and browser tests, including accessibility checks and large-document coverage.

## Verified release

- 11 core regression tests pass; strict TypeScript, formatting checks, and production build pass.
- All 6 browser scenarios pass against the Docker build and the public HTTPS app, including WCAG A/AA checks for both themes, mobile, and graph controls.
- Dependency audit reports zero known vulnerabilities at release time.
- Initial JavaScript: 223.13 kB (71.38 kB gzip). Graph (~145 kB) and Excel generation (~332 kB) are loaded on demand.
- Production container is healthy with two nginx processes and was observed below 10 MiB of idle memory; configured maximum is 64 MiB.
- Host nginx syntax check and public health endpoint pass; port 3100 and the former preview service are retired. Migration backups are under `/var/backups/jsonp/2026-10-03/`.
