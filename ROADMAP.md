# Roadmap

## Performance targets

Treat these as **targets, not gates** — the app already falls back safely (`MAX_INITIAL_RENDER_POINTS = 15000` auto-limits visible columns on big loads), so hitting them is not the primary objective. Cost model: rows × (visible columns)²; Canvas 2D sustains ~1–2M point-draws/sec.

| Stage | Rows × visible cols | What unlocks it |
|---|---|---|
| Canvas 2D baseline (shipped #30/#31) | 100–200k × 10 non-blocking | worker parse + RAF chunking + ImageData LRU |
| Columnar + WebGL (shipped #73/#74) | 12M points: 15.5s → 4.2s full paint on *software* GL (SwiftShader); real GPUs land far lower | one shared GL context, blit-into-2D, Canvas 2D fallback |
| Next ceiling | CPU-side costs now dominate (brush grid, RAF pacing at 4 cells/frame, blits) | tune scheduler; #32 (density/chips) PARKED pending brushing-semantics design |

Visible columns cap at ~15–20 regardless of engine (k² cells is a pixel-budget problem, not a rendering one) — mitigated by grouping (#45) and correlation-based sorting (#36), not by faster drawing.

Feature backlog, reconstructed July 2026 (branch/PR triage: #23 merged, #19/#22 closed with salvage notes, `feature/lines` and `feature/pages` deleted). Each item links to its tracking issue. Ordered roughly by dependency, not priority. `TODO.md` remains the code-quality backlog.

## Performance

- [x] **Web Worker CSV parsing + RAF-chunked rendering** ([#30](https://github.com/dbolser/Demonstrable-Plotalizer/issues/30)) *(salvaged from PR #19)* — PapaParse `worker: true` so parsing never freezes the UI; render ~4 cells / ~12ms per animation frame with cancellation, streaming progress (cells done, elapsed) into the existing loading indicator instead of painting all cells synchronously. Avoid the old branch's regressions (keep `CoordinateDisplay`/`HistogramBin` types and PR #20's histogram-brush coordinate readout).
- [x] **Per-cell ImageData LRU cache** ([#31](https://github.com/dbolser/Demonstrable-Plotalizer/issues/31)) *(salvaged from PR #22)* — main's render-key cache (`ScatterPlotMatrix.tsx` ~L500) only skips re-render when the key is unchanged; add a small per-canvas LRU (~6 entries, unselected-state only, size-capped) so toggling log scale or a filter *back* restores instantly via `putImageData`. ~40 lines around the existing renderKey check.
- [ ] **[PARKED]** **Density-based sub-sampling + pre-rendered chips** ([#32](https://github.com/dbolser/Demonstrable-Plotalizer/issues/32)) — stop drawing every point. Bin each cell (extend the spatial grid to finer resolution); in dense regions draw a representative subset or density shade. Pre-render each cell's unselected cloud to an offscreen canvas ("chip") and blit it, overlaying only selected points live. Decouples render cost from row count; makes tile dragging free. Target: 1M+ rows interactive.
- [x] **WebGL backend** ([#33](https://github.com/dbolser/Demonstrable-Plotalizer/issues/33)) — Canvas 2D tops out around a few million point-draws per full-matrix pass. A point-sprite renderer (regl or hand-rolled; one shared context, scissored per cell) handles 1–10M instances at interactive rates and makes per-point categorical color cheap via attribute buffers.
- [x] **Columnar typed-array storage** (shipped with #33 stack, PR #73) — row-objects cost ~10× the raw data in memory; `Float64Array` per column is the prerequisite for 1M-row datasets and fast worker transfer (transferables).

## Interaction

- [ ] **Fast tile drag-to-reorder** ([#34](https://github.com/dbolser/Demonstrable-Plotalizer/issues/34)) — grab tiles in the matrix itself and fluidly drag to reorder rows/columns. With chips cached, drag animation is just blitting images to new positions; re-render for real only on drop.
- [x] **Per-cell reference lines: x=y identity + linear regression** ([#50](https://github.com/dbolser/Demonstrable-Plotalizer/issues/50)) — the *actual* intent behind the shelved `feature/lines` branch: toggleable y=x diagonal (parity structure for same-unit column pairs) and per-cell least-squares line, fit in transformed space when an axis is log. Natural anchor for #36's r/r², and residual-from-line as a selection/coloring dimension later. Cheap: two segments per cell after the point pass; include toggle in the render key.
- [ ] **Cross-plot point tracing (crosshair network)** ([#35](https://github.com/dbolser/Demonstrable-Plotalizer/issues/35)) — the other reading of deleted `feature/lines` (sketch in history at `107fc77`; the code was a broken spike), kept as a lower-priority separate idea. Hover a point (with modifier key) → highlight/trace it across every cell, using the spatial grid for hit-testing and a non-blocking overlay layer.
- [x] **Bug: data-table divider drag** ([#49](https://github.com/dbolser/Demonstrable-Plotalizer/issues/49)) — dragging the divider between table and plots misbehaves; reproduce, pin the symptom (pointer capture? user-select? re-render fighting the drag?), fix in the B3 resizable-table code in `App.tsx`.
- [x] **Data table always available via toggle** ([#56](https://github.com/dbolser/Demonstrable-Plotalizer/issues/56)) — currently selection-gated; make it a persistent toggle showing the full dataset (capped/virtualized) when nothing is selected.
- [x] **Fluid tile zoom** ([#57](https://github.com/dbolser/Demonstrable-Plotalizer/issues/57)) — Ctrl/Cmd+wheel CSS-scales painted canvases during the gesture, one real re-render on commit; first taste of the chips technique from #32.
- [x] **ControlPanel reorganization** ([#58](https://github.com/dbolser/Demonstrable-Plotalizer/issues/58)) — collapsible sections + a View toggle group (histograms, table, reference lines, legend); scheduled after wave-2 controls exist.
- [ ] **Better axis scaling controls** ([#46](https://github.com/dbolser/Demonstrable-Plotalizer/issues/46)) — symlog for zero/negative columns (closed PR #12's motivation), percentile/winsorized domain clipping for outliers, shared-domain option per row/column of cells for comparability.

## Color & categories

- [x] **Color-by** ([#39](https://github.com/dbolser/Demonstrable-Plotalizer/issues/39)) — (a) user marks string columns as *category columns*, picks one as "color by" → categorical palette + legend; (b) **rainbow by row order**: gradient by position in the input file — doubles as a "is this file sorted by something meaningful" detector; (c) **rainbow by column rank**: click a column to re-order the rainbow by that column's sorted rank instead of file order — effectively a gradient color-by for any numeric column. Requires per-point color in the render pipeline (currently binary selected/unselected); cache keys must include color mode.
- [x] **Rainbow-stacked histogram bars** ([#40](https://github.com/dbolser/Demonstrable-Plotalizer/issues/40)) — with color-by active, each histogram bar becomes a stacked bar showing how much of each color falls in that bin (e.g. instantly see whether early rows concentrate at low values). Depends on color-by. Note: with rainbow-by-column-rank, the *clicked* column's own histogram becomes a perfect gradient — a nice visual confirmation of which column drives the ordering.
- [x] **Faceted filtering by category columns** ([#41](https://github.com/dbolser/Demonstrable-Plotalizer/issues/41)) — facet controls (checkbox list / mini bar chart with counts per category) that filter or highlight by category value, composing with brush selection and highlight/filter modes.

## Analysis

- [x] **Per-cell metrics** ([#36](https://github.com/dbolser/Demonstrable-Plotalizer/issues/36)) — optional Pearson/Spearman correlation, r², selection counts per cell; corner badge and/or cell border colored by |r| (classic SPLOM technique); sort columns by correlation.
- [ ] **Clustering** ([#37](https://github.com/dbolser/Demonstrable-Plotalizer/issues/37)) — k-means first (DBSCAN/HDBSCAN later) over selected numeric columns; cluster assignment becomes a derived category column so it composes with color-by and faceting.
- [x] **PCA** ([#38](https://github.com/dbolser/Demonstrable-Plotalizer/issues/38)) — computed in a worker over visible numeric columns; components appear as derived columns (PC1, PC2, …) in the matrix. Bonus: scree plot, loadings.
- [ ] **Smarter column grouping** ([#45](https://github.com/dbolser/Demonstrable-Plotalizer/issues/45)) — extend `groupUtils.ts` token detection with separator-aware prefix/suffix hierarchies, correlation-based grouping suggestions, manual group editing.

## Data, sharing & state

- [x] **Load CSV/TSV from URL** ([#42](https://github.com/dbolser/Demonstrable-Plotalizer/issues/42)) — `?data=<url>` query param and/or input field; stream-parse, handle CORS gracefully, record in IndexedDB file history.
- [ ] **Shareable state links** ([#43](https://github.com/dbolser/Demonstrable-Plotalizer/issues/43)) — serialize view state (data URL, column visibility/order/scales, color-by, filters, selection) into a compact URL fragment. For uploaded files, share state minus data with a "load your copy" prompt. Depends on load-from-URL.
- [ ] **Session history** ([#44](https://github.com/dbolser/Demonstrable-Plotalizer/issues/44)) — undo/redo over state snapshots (selection, columns, filters, color-by), persisted per-file in IndexedDB next to file history, so reopening a recent file restores where you left off.
