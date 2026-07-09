---
name: verify
description: Build, launch and drive this app to verify a change end-to-end in a real browser.
---

# Verifying Demonstrable-Plotalizer changes

Vite + React SPA; the surface is the browser at http://localhost:3000.

## Launch

```bash
npm install        # only if node_modules is missing
npm run dev        # background; serves on port 3000
```

## Load a dataset

- Default load is `public/data/sample.csv` (iris — 150 rows, 3 species of 50 each; useless for count-skewed features).
- To drive a custom CSV: drop it in `public/data/<name>.csv` (served same-origin by Vite) and navigate to
  `http://localhost:3000/?data=http://localhost:3000/data/<name>.csv`. Delete the file when done — public/ is checked in.

## Driving tips

- Rendering backend is logged to the console: `[ScatterPlotMatrix] point rendering backend: WebGL|Canvas 2D`.
  Real Chrome uses WebGL; jsdom tests only ever exercise the Canvas 2D path, so browser verification is the only
  coverage the WebGL path gets.
- Sidebar sections (Color, Facets, Analysis…) are collapsible; native `<select>`s respond well to form_input.
- Brush-select by click-dragging inside a scatter cell; the selected-rows table appears at the bottom with a row
  count — good for asserting selection semantics. Escape clears the selection.
- Legend/category clicks: prefer element refs over coordinates; rows are small and easy to miss.
