/**
 * Detects column groups by finding alphabetic tokens shared across multiple columns.
 *
 * Algorithm:
 * 1. Extract maximal alphabetic substrings (tokens) from each column name.
 * 2. Keep tokens appearing in >=2 columns and <100% of all columns.
 * 3. Return a Map of token → column names, sorted by descending group size.
 */
export function detectColumnGroups(columnNames: string[]): Map<string, string[]> {
    const totalCols = columnNames.length;
    if (totalCols === 0) return new Map();

    const tokenToColumns = new Map<string, Set<string>>();

    for (const name of columnNames) {
        // Extract maximal alphabetic substrings
        const tokens = name.match(/[a-zA-Z]+/g) || [];
        for (const token of tokens) {
            const lowerToken = token.toLowerCase();
            if (!tokenToColumns.has(lowerToken)) {
                tokenToColumns.set(lowerToken, new Set());
            }
            tokenToColumns.get(lowerToken)!.add(name);
        }
    }

    // Filter: appear in >=2 columns AND <100% of all columns
    const groups = new Map<string, string[]>();
    for (const [token, cols] of tokenToColumns) {
        if (cols.size >= 2 && cols.size < totalCols) {
            groups.set(token, Array.from(cols));
        }
    }

    // Sort by descending group size
    const sortedEntries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    return new Map(sortedEntries);
}
