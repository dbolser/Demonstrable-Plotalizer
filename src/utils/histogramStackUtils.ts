import { interpolateViridis } from 'd3';
import type { DataPoint } from '../../types';
import type { ColorState } from './colorUtils';
import { CATEGORY_PALETTE, MISSING_COLOR, MISSING_SLOT, RAINBOW_BUCKETS } from './colorUtils';

// Issue #40: with a color mode active, histogram bars become stacked bars —
// one segment per color group per bin. The continuous rainbow gradient is
// bucketed into RAINBOW_STACK_BINS stacks so segments stay legible; category
// mode stacks by palette slot (categories sharing a cycled palette color
// merge into one visually identical segment).
export const RAINBOW_STACK_BINS = 12;

export interface StackConfig {
  /** Number of color stacks, excluding the trailing missing-value stack. */
  numStacks: number;
  /** One color per stack, plus MISSING_COLOR at index numStacks. */
  stackColors: string[];
  /** Maps a ColorState slot to a stack index (MISSING_SLOT -> numStacks). */
  stackSlotFor: (slot: number) => number;
}

export function getStackConfig(colorState: ColorState): StackConfig {
  if (colorState.mode === 'category') {
    const numStacks = CATEGORY_PALETTE.length;
    return {
      numStacks,
      stackColors: [...CATEGORY_PALETTE, MISSING_COLOR],
      stackSlotFor: (slot: number) =>
        slot === MISSING_SLOT || slot >= numStacks ? numStacks : slot,
    };
  }

  const numStacks = RAINBOW_STACK_BINS;
  const stackColors = Array.from({ length: numStacks }, (_, s) =>
    interpolateViridis((s + 0.5) / numStacks)
  );
  stackColors.push(MISSING_COLOR);
  return {
    numStacks,
    stackColors,
    stackSlotFor: (slot: number) =>
      slot === MISSING_SLOT
        ? numStacks
        : Math.min(numStacks - 1, Math.floor((slot * numStacks) / RAINBOW_BUCKETS)),
  };
}

export interface StackedBinCounts {
  /** total[bin][stack] — row counts per color stack (length numStacks + 1). */
  total: number[][];
  /** Same shape, restricted to the current selection (all zeros if none). */
  selected: number[][];
}

/**
 * Count rows per (bin, color stack) for stacked histogram bars, for both the
 * full dataset and the current selection in one pass.
 */
export function computeStackedBinCounts(
  rowBins: readonly (readonly DataPoint[])[],
  colorState: ColorState,
  config: StackConfig,
  selectedIds: Set<number>
): StackedBinCounts {
  const stacksPerBin = config.numStacks + 1;
  const total = rowBins.map(() => new Array<number>(stacksPerBin).fill(0));
  const selected = rowBins.map(() => new Array<number>(stacksPerBin).fill(0));
  const { slotById } = colorState;
  const hasSelection = selectedIds.size > 0;

  rowBins.forEach((rows, binIndex) => {
    for (const row of rows) {
      const id = row.__id;
      const slot = id >= 0 && id < slotById.length ? slotById[id] : MISSING_SLOT;
      const stack = config.stackSlotFor(slot);
      total[binIndex][stack]++;
      if (hasSelection && selectedIds.has(id)) {
        selected[binIndex][stack]++;
      }
    }
  });

  return { total, selected };
}

export interface StackSegment {
  binIndex: number;
  stackIndex: number;
  /** Cumulative count where this segment starts (from the bar's baseline). */
  start: number;
  /** Cumulative count where this segment ends. */
  end: number;
  color: string;
}

/**
 * Flatten per-bin stack counts into cumulative segments, ordered from the
 * baseline upward by stack index (gradient start first; missing-value gray
 * last, at the top of the bar). Empty stacks are skipped.
 */
export function buildStackSegments(
  counts: readonly (readonly number[])[],
  stackColors: readonly string[]
): StackSegment[] {
  const segments: StackSegment[] = [];
  counts.forEach((stacks, binIndex) => {
    let cumulative = 0;
    stacks.forEach((count, stackIndex) => {
      if (count > 0) {
        segments.push({
          binIndex,
          stackIndex,
          start: cumulative,
          end: cumulative + count,
          color: stackColors[stackIndex],
        });
        cumulative += count;
      }
    });
  });
  return segments;
}
