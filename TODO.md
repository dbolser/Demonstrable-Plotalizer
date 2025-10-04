# Codebase TODO List

This is a prioritized list of tasks for improving the codebase, generated from various code comments and analysis.

---

### High Priority

These issues are critical and should be addressed soon as they impact correctness, usability, or security.

1.  **Fix Non-Destructive Column Filtering**
    *   **File:** `App.tsx`
    *   **Issue:** When the column filter is cleared, it forces all columns to become visible, discarding any columns the user had manually hidden.
    *   **Suggestion:** Refactor the filtering logic to be non-destructive. `handleColumnFilterChange` should only set the filter state. The `ScatterPlotMatrix` component should then use that filter string to derive the list of visible columns from the user's current selection, rather than modifying the `visible` property on the main `columns` state.

2.  **Fix `vitest` Version in `package.json`**
    *   **File:** `package.json`
    *   **Issue:** The `vitest` version `^3.2.4` is not an official release, which poses a security and stability risk.
    *   **Suggestion:** Update `vitest` to an official, stable version (e.g., `^1.6.0`).

3.  **Improve `selectedStateHash` Robustness**
    *   **File:** `components/ScatterPlotMatrix.tsx`
    *   **Issue:** The cache key for the selection state (`selectedStateHash`) only uses the first 5 selected IDs, which can cause cache collisions if different selections share the same first 5 items.
    *   **Suggestion:** Generate the hash by sorting all selected IDs before joining them into a string. This will ensure a unique key for every unique set of selected items.

4.  **Improve `dataStateHash` Robustness**
    *   **File:** `components/ScatterPlotMatrix.tsx`
    *   **Issue:** The cache key for the data state (`dataStateHash`) is not robust. It won't change if data points (other than the first one) are modified, leading to stale cache rendering.
    *   **Suggestion:** Create a more reliable hash by sampling a few points from the data (e.g., first, middle, and last IDs) instead of just the first.

5.  **Prevent Memory Leaks from `setTimeout`**
    *   **File:** `components/ScatterPlotMatrix.tsx`
    *   **Issue:** The `setTimeout` calls for caching canvas images are not cleaned up when the component unmounts or re-renders, which can lead to memory leaks and race conditions.
    *   **Suggestion:** Collect the timer IDs from `setTimeout` within the `useEffect` hook and clear them in the effect's cleanup function.

---

### Medium Priority

These are valuable refactoring and maintainability improvements.

1.  **Consolidate Cache `useRef`s**
    *   **File:** `components/ScatterPlotMatrix.tsx`
    *   **Issue:** The component uses three separate `useRef`s for caching (`canvasCacheRef`, `canvasElementsRef`, `imageDataCacheRef`), which adds complexity.
    *   **Suggestion:** Consolidate them into a single cache object (e.g., a `Map` where the value is an object containing the canvas, element, and image data) for simpler management.

2.  **Extract Hardcoded `gridSize`**
    *   **File:** `components/ScatterPlotMatrix.tsx`
    *   **Issue:** The `gridSize` for the spatial grid is hardcoded to `20` in multiple places.
    *   **Suggestion:** Extract this to a single module-level constant to improve maintainability.

3.  **Evaluate `setTimeout` for Caching**
    *   **File:** `components/ScatterPlotMatrix.tsx`
    *   **Issue:** Caching is wrapped in a `setTimeout(..., 0)`. This might be unnecessary.
    *   **Suggestion:** Evaluate if making the caching call synchronous or using `requestAnimationFrame` would be a better approach.

---

### Low Priority / Cleanup

These are minor improvements related to code style, consistency, and removing dead code.

1.  **Remove Unused Refs:** The `canvasCacheRef` and `canvasElementsRef` in `components/ScatterPlotMatrix.tsx` are unused and should be removed.
2.  **Use Named Constants for Magic Numbers:** In `components/ScatterPlotMatrix.tsx`, replace hardcoded numbers for `padding/2` and the point radius (`2.5`) with named constants.
3.  **Update Path Alias Convention:** In `vitest.config.ts`, change the `'@'` path alias to point to the `src` directory (`./src`).
4.  **Use Path Aliases in Tests:** After updating the alias, refactor test files to use `@/` for imports instead of relative paths (`../../`).
5.  **Remove Unused Test Imports:** Remove the unused `DndProvider` and `HTML5Backend` imports from `src/test/componentLogic.test.tsx`.
6.  **Fix Inconsistent Test Logic:** In `src/test/columnReordering.test.ts`, the test for filtering logic is inconsistent with the application's logic. Refactor it to use the `filterColumns` utility function.
7.  **Use Optional Chaining:** In `components/ScatterPlotMatrix.tsx`, replace the non-null assertion (`!`) on `canvasContainerRef.current` with optional chaining (`?.`) for stylistic consistency.
8.  **Memoize Visible Column Count:** In `components/ControlPanel.tsx`, use the `useMemo` hook to calculate the visible column count for a minor performance gain.


# RANDOM NOTES

## ONE

components/ScatterPlotMatrix.tsx

It's great that you've extracted computeSelectedStateHash into a utility file. However, the related functions createSpatialGrid and getPointsInBrush have also been created in selectionUtils.ts, but their old implementations still exist as useCallback hooks within this component (starting on lines 115 and 139 respectively).

To complete the refactoring and avoid code duplication, you should:

Import all three functions here.
Remove the local useCallback definitions for createSpatialGrid and getPointsInBrush from this component.
Update the call sites (e.g., lines 397-398) to use the imported functions, making sure to pass the size argument as required by their new signatures.


## TWO

src/utils/selectionUtils.ts
Comment on lines +18 to +26
export function createSpatialGrid(
    data: any[],
    xScale: (v: number) => number,
    yScale: (v: number) => number,
    xCol: string,
    yCol: string,
    size: number,
    gridSize = 20
) {
Contributor
￼ gemini-code-assist bot 3 minutes ago
￼

To improve type safety and make the function signature more explicit, you can replace the any type with the more specific DataPoint type and add a return type annotation. You'll need to add import type { DataPoint } from '../../types'; at the top of the file.

Suggested change
export function createSpatialGrid(
    data: any[],
    xScale: (v: number) => number,
    yScale: (v: number) => number,
    xCol: string,
    yCol: string,
    size: number,
    gridSize = 20
) {
export function createSpatialGrid(
    data: DataPoint[],
    xScale: (v: number) => number,
    yScale: (v: number) => number,
    xCol: string,
    yCol: string,
    size: number,
    gridSize = 20
): DataPoint[][][] {
Commit suggestion
￼Add suggestion to batch



## THREE

