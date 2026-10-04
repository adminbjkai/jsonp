# JSON Prettify

A private JSON workspace at **[jsonp.bjk.ai](https://jsonp.bjk.ai)**. Format a document, inspect its values, and navigate its structure without sending your JSON to a server.

![JSON Prettify workspace](docs/workspace.png)

## Getting started

1. **Bring in JSON.** Paste it into Source, drop a JSON or CSV file anywhere, or use **Open**. Broken JSON shows the exact line and column with a plain-language explanation. **Repair** fixes comments, trailing or missing commas, single quotes, unquoted keys, Python `True`/`False`/`None`, `NaN`/`Infinity`, smart quotes, JSONP or `const x =` wrappers, Markdown code fences, unclosed brackets, and NDJSON (wrapped into an array).
2. **Click any value.** Its path appears in the bar above the panes. You can copy it or jump to the source, and the matching lines highlight in every pane.
3. **Find what matters.** Type in the Explorer's Find box, or start with `$` to run a JSONPath query such as `$.crew[*].name`, `$..name`, or `$.crew[?(@.role == 'Designer')]`.
4. **Take it further.** **Tools** sorts and cleans, **Convert** creates TypeScript, JSON Schema, YAML, or CSV, **Compare** shows what changed, and **Export** downloads, shares, or builds an Excel IRD.

![Command palette](docs/palette.png)

Press **Ctrl/⌘ + K** to search every action by name. **Help** explains each pane and has clickable query examples. A short getting-started banner appears on the first visit.

## Workspace

- **Source:** line numbers, error-line marker, Tab/Shift+Tab indentation, line wrapping, live validation, file import or drop, and multi-step undo for every replacement (format, repair, transforms, open, clear).
- **Formatted:** syntax colors and line numbers, 2- or 4-space indentation, compact output, copy, and JSON download. Formatting preserves exact number tokens, negative zero, exponents, string escapes, key order, and duplicate keys.
- **Explorer:** search keys, values, or types, or run JSONPath queries (names, wildcards, recursive descent, indexes, slices, unions, and filters with comparisons, regular expressions, `&&`, `||`, and `!`). Copy query results as a JSON array. Switch between tree and list, expand or collapse branches, and select a value to highlight its source and formatted lines. Choose JSONPath, JSON Pointer, or JavaScript paths; use breadcrumbs, previous/next, or arrow keys to move through results. Root JSON Pointer is the empty string; `/` identifies an empty property name.
- **Table:** arrays of records as a sortable, filterable, virtualized grid. It follows your selection; click any cell to select that value, or convert the array to CSV.
- **Graph:** connected container cards with scalar values and color swatches, zoom, pan, fit, manual card positioning, and selection linked to the source.
- **Insights:** value counts by type, nesting depth, most common keys, largest arrays, and the longest string. Open it from the status bar.

Drag pane headers to reorder, drag dividers to resize, and collapse or focus individual panes. Focused dividers also accept arrow keys. Reset layout restores the default arrangement. On phones, switch panes, including Table and Graph, using tabs. Dark and light themes and pane order persist on this device. There are no AI requests, external fonts, or analytics.

### Tools

| Menu    | Actions                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open    | Open file (JSON, NDJSON, GeoJSON, CSV, or TSV), paste from clipboard, load sample, clear                                                                                      |
| Tools   | Format, repair, minify, sort keys A–Z (recursive), remove nulls, remove empty values, keep only the selected value, escape as a JSON string, unescape, CSV text to JSON, undo |
| Convert | TypeScript interfaces (optional keys, unions, merged array shapes), JSON Schema 2020-12 (required keys, integer vs number, formats), YAML, CSV (flattened dotted columns)     |
| Compare | Structural diff against a second document by path: added, removed, changed, and type-changed values. Key order is ignored; array order can be ignored too.                    |
| Export  | Copy or download formatted JSON, convert, Excel IRD workbook, copy share link                                                                                                 |

All transforms and conversions keep exact number tokens. CSV import keeps numbers exact, leaves leading-zero values such as `007` as strings, and turns empty cells into `null`. CSV export prefixes cells that start with `=`, `+`, `-`, or `@` with an apostrophe, unless the cell is a number, to prevent spreadsheet formula injection.

**Share links** compress the document into the URL fragment (`#json=…`). Browsers never send the fragment to the server, so the data lives only in the link. Links over 60,000 characters are refused; download the file instead. Opening a link loads the document and clears the fragment from the address bar.

**Keep my draft on this device** (in the command palette) is off by default. When it is on, the source is saved to this browser's local storage, up to 2 MiB, and restored on the next visit. Turning it off deletes the saved draft. Otherwise, document contents are lost on reload.

### Shortcuts

Use Ctrl on Windows/Linux or ⌘ on macOS.

| Keys               | Action                         |
| ------------------ | ------------------------------ |
| Ctrl/⌘ + K         | Find any action                |
| Ctrl/⌘ + Enter     | Format source                  |
| Ctrl/⌘ + Shift + C | Copy formatted JSON            |
| Ctrl/⌘ + S         | Download JSON                  |
| Ctrl/⌘ + F         | Search or query the explorer   |
| Ctrl/⌘ + /         | Open help                      |
| Tab / Shift + Tab  | Indent or outdent source lines |
| Escape             | Close a dialog or exit focus   |

In Source, Ctrl/⌘ + F keeps the browser's own find, and pressing Escape then Tab moves focus out of the editor. When the explorer is focused, ↑/↓ and Home/End navigate visible results, and Ctrl/⌘ + C copies the selected path in the chosen format. Double-click an explorer value to copy its path.

### IRD workbooks

Open **Export → Excel IRD workbook…** from the workspace toolbar, or use the explorer’s Excel button.

![IRD export choices](docs/ird-export.png)

- **IRD mapping template** is the default for valid JSON. It uses source fields, paths, and observed data types, with repeated array records combined into reusable `[*]` paths. Nonempty objects are represented by their child fields; arrays and empty containers remain available as mappings. Primitive roots use `$`. No sample values are sent to the template export worker or included in the workbook.
- **Blank IRD template** works even without valid JSON. It contains 30 empty, editable mapping rows.
- **Known-target worked example** provides two independent downloads: a target XLSX with Projects and Crew tables, field definitions, expected output, and the bundled Orbital source JSON; and a completed IRD mapping all eleven target columns. Select this option, download the target workbook, then download the completed IRD. Both work without valid editor JSON and always use the bundled sample. The mapping covers direct fields, uppercase codes, boolean Y/N conversion, crew counts, parent foreign keys, repeated crew rows, optional launch dates, and validation/rejection rules. Use **Sample** in the workspace to explore that source. This is an explicitly defined example contract, not a schema inferred from your data.
- **Mapping with samples** retains the original `Data_Mapping_IRD` sheet and its existing columns and per-value paths.

Both clean templates contain **Overview**, **Field Mapping**, and **Instructions** sheets. Mapping columns cover source field/path/type, target field/path/type, requiredness, cardinality, transformations/business rules, defaults, validation constraints, and descriptions. Those business decisions stay blank. Types are observed from the provided document, not a guaranteed schema; confirm them against your source contract. This is a general-purpose IRD layout you can adapt to your organization. The mapping sheet has column widths and filters and is fully editable.

### Document limits

Formatting, validation, and repair run in a cancellable Web Worker after a short debounce. Source is limited to 5 MiB of UTF-16 code units; imported files are limited to 5 MiB in bytes. The workspace supports 300,000 values, 256 nesting levels, and 20 MiB of formatted output. JSONPath queries also run in a worker and stop after 5 seconds, so a slow filter can't freeze the page. Exceeding a limit produces an explicit error; the source stays intact. Blank input has no output.

The graph supports 400 containers. Larger documents remain available in the searchable explorer and full exports. Primitive roots have no container graph. Duplicate keys are preserved and flagged; reference selection uses the last occurrence, and the graph requires unique paths. Validation follows `JSON.parse` syntax; it does not check a schema.

## Development

Node.js **22.12+** and npm are required.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. No environment variables or API keys are needed.

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm audit
```

GitHub Actions runs these checks on pushes and pull requests, testing the production build in Chromium.

`check` verifies formatting, strict TypeScript, core regressions, and a production build. Browser tests cover desktop/mobile flows, exact numbers and escaped paths, root copy, file import, Excel/JSON downloads, graph navigation and focus, themes, large-document virtualization, and accessibility. To test an existing deployment, set `TEST_URL` instead of starting Vite:

```sh
TEST_URL=https://jsonp.bjk.ai npm run test:e2e
```

## Code map

| File                                             | Responsibility                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/App.tsx`                                    | Workspace state, action list, worker lifecycle, menus, layout, and shortcuts |
| `src/json.ts`, `src/json.worker.ts`              | Lossless formatting, typed ranges, and background processing with repair     |
| `src/tree.ts`                                    | Lossless JSON tree, serialization, and transforms                            |
| `src/locate.ts`, `src/repair.ts`                 | Plain-language error locations and token-level JSON repair                   |
| `src/query.ts`, `src/diff.ts`                    | JSONPath evaluation and structural comparison                                |
| `src/convert.ts`                                 | TypeScript, JSON Schema, YAML, and CSV output; CSV import                    |
| `src/share.ts`                                   | Compressed share links in the URL fragment                                   |
| `src/Explorer.tsx`, `src/PathBar.tsx`            | Searchable, queryable virtualized tree/list, breadcrumbs, and path copying   |
| `src/SourceEditor.tsx`, `src/Output.tsx`         | Source gutter and indentation; virtualized syntax-colored output             |
| `src/TableView.tsx`, `src/Graph.tsx`             | Record grid and lazy-loaded graph                                            |
| `src/CommandPalette.tsx`, `src/Menu.tsx`         | Action search and accessible toolbar menus                                   |
| `src/HelpDialog.tsx`, `src/Insights.tsx`         | Guided help and document profile                                             |
| `src/ConvertDialog.tsx`, `src/CompareDialog.tsx` | Conversion preview and document comparison                                   |
| `src/ExportDialog.tsx`, `src/ird.ts`             | Workbook choices, IRD fields, reusable paths, and instructions               |
| `src/export.ts`, `src/export.worker.ts`          | Downloads and background XLSX generation                                     |
| `src/index.css`                                  | Themes, responsive layouts, and reduced-motion styling                       |

SheetJS 0.20.3 is vendored from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) because the npm registry package is outdated. Its upstream license is included in the tarball. Graph and Excel code load only when used.

See [deployment instructions](docs/DEPLOYMENT.md) and [release notes](docs/CHANGELOG.md).
