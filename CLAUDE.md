# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start the development server on port 3000
- `npm run build` - Build the production version
- `npm run preview` - Preview the production build

### Environment Setup
- Set `GEMINI_API_KEY` in `.env.local` for the Gemini API integration
- The development server runs on `http://localhost:3000`

## Architecture

This is a React-based interactive scatter plot matrix visualization application built with Vite, TypeScript, and D3.js.

### Core Components Structure
- **App.tsx** - Main application component managing global state (data, columns, brush selection, filter mode)
- **ScatterPlotMatrix.tsx** - The core visualization component handling D3.js rendering, drag-and-drop column reordering, and brushing interactions
- **ControlPanel.tsx** - Sidebar controls for column management, data upload, and visualization settings
- **FileUpload.tsx** - CSV file upload and parsing functionality using PapaParse
- **Tooltip.tsx** - Hover tooltips for data points

### Key Libraries and Technologies
- **React 19** with TypeScript for UI components and state management
- **D3.js v7** for data visualization, scales, and brushing interactions
- **react-dnd** for drag-and-drop column reordering in the matrix headers
- **PapaParse** for CSV file parsing and data loading
- **Vite** as the build tool and development server

### Data Flow
- CSV data is parsed and augmented with unique `__id` properties for each data point
- Columns are detected automatically with numeric columns becoming matrix dimensions
- String columns are auto-detected as label columns for tooltips
- Brush selections create filtered data sets that propagate through all visualizations

### State Management
- Global state in App.tsx includes: data array, columns configuration, brush selection coordinates/IDs, filter mode, and UI preferences
- ScatterPlotMatrix uses complex memoization to map between visible column indices and original column indices for drag-and-drop reordering
- Brush interactions update both visual brush rectangles and selected data point IDs simultaneously

### Visualization Features
- Interactive scatter plot matrix with brushing for data selection
- Optional histograms on matrix borders with independent brushing
- Dynamic column visibility, scaling (linear/log), and drag-and-drop reordering
- Two filter modes: "highlight" (dimming) and "filter" (hiding) non-selected points
- Responsive tooltips showing label column values on hover

## File Structure
- Root TypeScript files: App.tsx, index.tsx, types.ts
- Components directory: All reusable UI components
- Vite configuration supports React, TypeScript, and path aliases via "@/*"