import { isFiniteCellValue } from './cellValueUtils';

// Column type detection over ALL rows, not just the first one. Sniffing only
// row 0 drops any column whose first cell is empty (PapaParse dynamicTyping
// turns empty cells into null, and `typeof null` is neither 'number' nor
// 'string'), which silently discarded sparse columns like PCA scores whose
// leading rows are blank.
//
// Rules per column:
// - any non-empty string value  -> string column (dynamicTyping already
//   converted parseable numbers, so a surviving string means real text)
// - otherwise, any numeric value -> numeric column
// - only nulls/blanks throughout -> empty column (reported, not plotted)

export interface ColumnTypeDetection {
  numericColumns: string[];
  stringColumns: string[];
  emptyColumns: string[];
}

type RawRow = Record<string, number | string | null | undefined>;

export function detectColumnTypes(rows: RawRow[], fields?: string[]): ColumnTypeDetection {
  const numericColumns: string[] = [];
  const stringColumns: string[] = [];
  const emptyColumns: string[] = [];
  if (rows.length === 0) {
    return { numericColumns, stringColumns, emptyColumns };
  }

  const columnNames = (fields ?? Object.keys(rows[0])).filter(f => f !== '__id');
  for (const name of columnNames) {
    let sawNumber = false;
    let sawString = false;
    for (const row of rows) {
      const value = row[name];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string') {
        if (value.trim() === '') continue;
        sawString = true;
        break; // string evidence wins immediately
      }
      if (typeof value === 'number') {
        if (isFiniteCellValue(value)) sawNumber = true;
      }
    }
    if (sawString) stringColumns.push(name);
    else if (sawNumber) numericColumns.push(name);
    else emptyColumns.push(name);
  }
  return { numericColumns, stringColumns, emptyColumns };
}

// User-facing notice for columns that were blank in every row (and therefore
// silently excluded from the matrix). Returns null when there is nothing to
// report. Long column lists are truncated so the banner stays one line-ish.
export function buildEmptyColumnsNotice(
  emptyColumns: string[],
  maxNames = 5
): string | null {
  const count = emptyColumns.length;
  if (count === 0) return null;
  const noun = count === 1 ? 'empty column' : 'empty columns';
  const shown = emptyColumns.slice(0, maxNames).join(', ');
  const rest = count - Math.min(count, maxNames);
  const suffix = rest > 0 ? ` and ${rest} more` : '';
  return `${count} ${noun} hidden: ${shown}${suffix}`;
}
