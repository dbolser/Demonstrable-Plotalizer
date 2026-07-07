export type DataPoint = {
  [key: string]: number | string;
  __id: number;
};

export type ScaleType = 'linear' | 'log';

export type Column = {
  name: string;
  scale: ScaleType;
  visible: boolean;
};

export type BrushSelection = {
  // Indices to identify the cell containing the brush
  indexX: number;
  indexY: number;

  // Screen coordinates of the brush rectangle
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  
  // The data points selected by the brush
  selectedIds: Set<number>;
} | null;

export type FilterMode = 'highlight' | 'filter';

// Point coloring: flat selected/unselected ('none'), categorical palette by
// a string column ('category'), or a viridis gradient by row order or by a
// numeric column's rank ('rainbow').
export type ColorMode = 'none' | 'category' | 'rainbow';