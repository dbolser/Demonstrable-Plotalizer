# Testing Guide

This project includes a comprehensive test suite for the interactive scatter plot matrix application.

## Test Structure

### 🧪 **Unit Tests** (`src/test/columnReordering.test.ts`)
- **Column reordering logic**: Tests drag-and-drop column swapping
- **Column filtering**: Tests substring matching for large datasets
- **Edge cases**: Handles same-index reordering, preserves column properties
- **Large datasets**: Tests performance with 30+ columns

### 🏗️ **Component Logic Tests** (`src/test/componentLogic.test.tsx`)
- **App rendering**: Ensures main component renders without crashing
- **Data filtering**: Tests highlight vs filter modes
- **Column visibility mapping**: Tests complex visible/original index mapping
- **Integration logic**: Tests core business logic without heavy D3 dependencies

### ⚡ **Performance Tests** (`src/test/performance.test.ts`)
- **Large dataset handling**: Tests 30k rows × 30 columns efficiently
- **Canvas caching**: Tests image caching operations
- **Memory management**: Tests cache size limits and cleanup
- **Execution time benchmarks**: Ensures operations complete within thresholds

### 🎯 **Selection Tests** (`src/test/selectionCache.test.ts`, `src/test/spatialGrid.test.ts`, `src/test/brushIntegration.test.tsx`)
- **Selection hash stability**: Tests collision-resistant cache keys for large selections
- **Spatial grid filtering**: Tests efficient point-in-rectangle queries
- **Brush integration**: Tests selection state propagation through components

## Running Tests

```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm test

# Run tests with UI (if @vitest/ui installed)
npm run test:ui

# Run with coverage (if @vitest/coverage installed)
npm run test:coverage
```

## Test Results

✅ **27 tests passing**
- 8 column reordering tests
- 9 performance tests
- 5 component logic tests
- 2 selection cache tests
- 1 spatial grid test
- 1 brush integration test
- 1 log scale test

## Test Environment

- **Framework**: Vitest with React Testing Library
- **Environment**: jsdom for DOM simulation
- **Mocking**: Canvas operations, PapaParse, fetch
- **TypeScript**: Full type safety in tests

## Key Test Coverage

### Column Operations
- ✅ Adjacent column swapping
- ✅ Non-adjacent column reordering
- ✅ 30+ column handling
- ✅ Property preservation during reorder
- ✅ Case-insensitive filtering

### Performance Benchmarks
- ✅ 30k row filtering < 100ms
- ✅ 30 column filtering < 10ms
- ✅ Canvas caching < 50ms
- ✅ Image restoration < 20ms
- ✅ Column reordering < 1ms

### Data Handling
- ✅ Large dataset processing
- ✅ Brush selection filtering
- ✅ Highlight vs filter modes
- ✅ Visible column index mapping

### Selection Features
- ✅ Rubber-band selection in scatter plots
- ✅ Histogram range selection (horizontal & vertical)
- ✅ Selection highlight propagation across all plots
- ✅ Highlight/filter mode toggle
- ✅ Stable selection cache keys (no collisions)
- ✅ Spatial grid optimization for large selections
- ✅ ESC key and button to clear selection

## Future Test Additions

For more comprehensive testing, consider adding:

1. **E2E Tests** (Playwright/Cypress)
   - Real drag-and-drop interactions
   - File upload workflows
   - Full user journeys

2. **Visual Regression Tests**
   - Screenshot comparisons
   - Canvas rendering validation

3. **Integration Tests**
   - D3 rendering (with better mocking)
   - react-dnd interactions
   - Canvas-to-image conversion

## Test Philosophy

These tests focus on:
- ✅ **Business logic** over visual rendering
- ✅ **Performance** for large datasets
- ✅ **Edge cases** and error conditions
- ✅ **Fast execution** for developer productivity

The test suite validates the core functionality while avoiding complex D3/canvas mocking that would make tests brittle and slow.