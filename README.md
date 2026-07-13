<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# JSON Prettify

A local-first JSON formatter with source-aware paths, copy/export utilities, and an interactive visual graph.

## Visual graph

The graph groups direct JSON values into container cards and uses a tidy-tree layout: parents are centered over their descendants, sibling branches remain adjacent, and the viewport fits the complete structure after a valid JSON update. This makes nested arrays and repeated records readable at a glance without manually arranging nodes.

Use the graph controls to zoom, pan, and fit the structure. Clicking a card or property selects the corresponding value in the editor.

## Run locally

Prerequisite: Node.js 20+.

1. Install dependencies with `npm install`.
2. Start the development server with `npm run dev`.
3. Open `http://localhost:3000`.

## Verify

Run `npm run lint` for TypeScript checks and `npm run build` for a production build.
