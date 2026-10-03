# JSON Prettify

A private JSON workspace at **[jsonp.bjk.ai](https://jsonp.bjk.ai)**. Format a document, inspect its values, and navigate its structure without sending your JSON to a server.

![JSON Prettify workspace](docs/workspace.png)

## Workspace

- **Source:** live validation, file import or drop, line wrapping, format in place, clear, and undo the last replacement.
- **Formatted:** syntax colors and line numbers, 2- or 4-space indentation, compact output, copy, and JSON download. Formatting preserves exact number tokens, negative zero, exponents, string escapes, key order, and duplicate keys.
- **Explorer:** search keys, values, or types; switch between tree and list; expand or collapse branches; select a value to highlight its source and formatted lines. Copy JSON Pointer, JSONPath, or JavaScript property references. Root JSON Pointer is the empty string; `/` identifies an empty property name.
- **Graph:** connected container cards with scalar values and color swatches, zoom, pan, fit, manual card positioning, and selection linked to the source. Focus the graph to give it the full workspace.
- **Excel mapping:** download an `.xlsx` workbook with levels, field names, exact sample values, types, references, and the existing requirement/mapping/business-rule/description columns. Rows retain document order, and numeric samples remain text to avoid spreadsheet rounding.

Drag pane headers to reorder, drag dividers to resize, and collapse or focus individual panes. Focused dividers also accept arrow keys. Reset layout restores the default arrangement. On phones, switch panes using tabs. Dark and light themes and pane order persist on this device; document contents do not persist and are lost on reload. There are no AI requests, external fonts, or analytics.

### Shortcuts

Use Ctrl on Windows/Linux or ⌘ on macOS.

| Keys               | Action                        |
| ------------------ | ----------------------------- |
| Ctrl/⌘ + Enter     | Format source                 |
| Ctrl/⌘ + Shift + C | Copy formatted JSON           |
| Ctrl/⌘ + S         | Download JSON                 |
| Ctrl/⌘ + /         | Show/hide shortcut help       |
| Escape             | Close help or exit pane focus |

Double-click an explorer value to copy its JSON Pointer.

### Document limits

Formatting runs in a cancellable Web Worker after a short debounce. Source is limited to 5 MiB of UTF-16 code units; imported files are limited to 5 MiB in bytes. The workspace supports 50,000 values, 256 nesting levels, and 20 MiB of formatted output. Exceeding a limit produces an explicit error; the source stays intact. Blank input has no output.

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

| File                 | Responsibility                                                              |
| -------------------- | --------------------------------------------------------------------------- |
| `src/App.tsx`        | Workspace controls, worker lifecycle, source selection, and layout          |
| `src/json.ts`        | Lossless formatting, typed source ranges, path references, and mapping rows |
| `src/json.worker.ts` | Background processing entrypoint                                            |
| `src/Explorer.tsx`   | Virtualized searchable tree/list and selected references                    |
| `src/Output.tsx`     | Virtualized syntax-colored output and line highlighting                     |
| `src/Graph.tsx`      | Lazy-loaded linear grouping and height-aware tree layout                    |
| `src/export.ts`      | JSON download and lazy-loaded Excel export                                  |
| `src/index.css`      | Themes, desktop/mobile layouts, and reduced-motion styling                  |

SheetJS 0.20.3 is vendored from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) because the npm registry package is outdated. Its upstream license is included in the tarball. Graph and Excel code load only when used.

See [deployment instructions](docs/DEPLOYMENT.md) and [release notes](docs/CHANGELOG.md).
