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
