export function computeSelectedStateHash(selectedIds: Set<number>): string {
    // Return a concise string that changes whenever the membership of the set changes,
    // but is independent of insertion order. We combine the size with a simple additive hash
    // of the sorted ids. This is fast and avoids long cache-key strings for very large selections.
    if (selectedIds.size === 0) return "none";

    // Convert to array, sort to make order-independent
    const sorted = Array.from(selectedIds).sort((a, b) => a - b);
    let hash = 0;
    const prime = 31;
    const mod = 2_147_483_647; // large prime near 2^31 − 1
    for (const id of sorted) {
        hash = (hash * prime + id) % mod;
    }
    return `${selectedIds.size}-${hash}`;
}

export function createSpatialGrid(
    data: any[],
    xScale: (v: number) => number,
    yScale: (v: number) => number,
    xCol: string,
    yCol: string,
    size: number,
    gridSize = 20
) {
    const grid: any[][][] = Array.from({ length: gridSize }, () =>
        Array.from({ length: gridSize }, () => [])
    );
    data.forEach((d) => {
        const x = +d[xCol];
        const y = +d[yCol];
        if (!isFinite(x) || !isFinite(y)) return;
        const sx = xScale(x);
        const sy = yScale(y);
        // Map screen coordinates [0, size] to grid cells [0, gridSize-1]
        const gx = Math.floor((sx / size) * gridSize);
        const gy = Math.floor((sy / size) * gridSize);
        if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
            grid[gx][gy].push(d);
        }
    });
    return grid;
}

export function getPointsInBrush(
    grid: DataPoint[][][],
    xScale: (v: number) => number,
    yScale: (v: number) => number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    xCol: string,
    yCol: string,
    size: number,
    gridSize = 20
): Set<number> {
    const selected = new Set<number>();
    // Map brush coordinates to grid cells
    // Since brush covers [0, size], we map that range to [0, gridSize-1]
    const startGX = Math.max(0, Math.floor((x0 / size) * gridSize));
    const endGX = Math.min(gridSize - 1, Math.ceil((x1 / size) * gridSize));
    const startGY = Math.max(0, Math.floor((y0 / size) * gridSize));
    const endGY = Math.min(gridSize - 1, Math.ceil((y1 / size) * gridSize));
    for (let gx = startGX; gx <= endGX; gx++) {
        for (let gy = startGY; gy <= endGY; gy++) {
            for (const d of grid[gx][gy]) {
                const sx = xScale(+d[xCol]);
                const sy = yScale(+d[yCol]);
                if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
                    selected.add(d.__id);
                }
            }
        }
    }
    return selected;
}
