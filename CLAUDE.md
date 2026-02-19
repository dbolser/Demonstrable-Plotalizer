# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start the development server on port 3000
- `npm run build` - Build the production version
- `npm run preview` - Preview the production build (port 4173)

### Testing
- `npm run test:run` - Run all tests once
- `npm test` - Run tests in watch mode
- `npm run test:ui` - Test UI dashboard
- `npm run test:coverage` - Coverage report

### Environment Setup
- Set `GEMINI_API_KEY` in `.env.local` for the Gemini API integration
- See `.env.example` for available environment variables

## Architecture

React 19 + TypeScript + D3.js v7 scatter plot matrix for exploring large datasets (30k+ rows, 30+ columns). Built with Vite, uses Canvas for rendering performance.

### State and Data Flow

All global state lives in `App.tsx`:
- `data: DataPoint[]` - CSV rows augmented with `__id: number` for stable identity
- `columns: Column[]` - visibility, scale (`linear`|`log`), name per column
- `brushSelection: BrushSelection | null` - screen coordinates + `selectedIds: Set<number>`
- `filterMode: 'highlight' | 'filter'` - dims vs hides non-selected points

CSV parsing (PapaParse) → auto-detect numeric vs. string columns → first string column becomes the label shown in tooltips. ESC key clears selection.

### Core Types (`types.ts`)

```typescript
DataPoint = { [key: string]: number | string, __id: number }
Column = { name: string, scale: ScaleType, visible: boolean }
BrushSelection = { indexX, indexY, x0, y0, x1, y1, selectedIds: Set<number> } | null
```

### Rendering Pipeline (`ScatterPlotMatrix.tsx`)

The matrix uses **Canvas** (not SVG) for performance. Key patterns:

1. **Canvas caching** - Rendered images are cached by a hash key; cache is invalidated when selection or data changes
2. **Spatial grid (20×20)** - Each scatter plot divides its space into a grid; brush queries only check cells overlapping the brush rectangle instead of all points
3. **Selection state hashing** (`selectionUtils.ts`) - `computeSelectedStateHash()` generates cache keys; currently uses first 5 IDs (known collision risk for large identical-prefix selections)
4. **Column visibility mapping** (`columnUtils.ts`) - `mapVisibleColumns()` translates drag-and-drop visible indices back to original column indices without re-rendering

Points: gray `#ccc` at 30% opacity (unselected when something is selected), blue `#1e40af` at 80% opacity (selected).

### Utility Modules (`src/utils/`)

- `columnUtils.ts` - `reorderColumns`, `filterColumns`, `mapVisibleColumns`
- `dataUtils.ts` - `filterData(data, selectedIds, filterMode)` splits data by selection
- `selectionUtils.ts` - `createSpatialGrid`, `getPointsInBrush`, `computeSelectedStateHash`

### Performance Benchmarks (enforced by tests)

- 30k row filtering: < 100ms
- 30 column filtering: < 10ms
- Canvas caching operations: < 50ms
- Image restoration: < 20ms
- Column reordering: < 1ms

### Deployment

- GitHub Pages via `deploy.yml` on push to `main`
- Vite uses base path `/Demonstrable-Plotalizer/` in production, `/` in dev
