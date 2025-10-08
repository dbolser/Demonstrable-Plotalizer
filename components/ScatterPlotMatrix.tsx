import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import * as d3 from 'd3';
import { useDrag, useDrop } from 'react-dnd';
import type { DataPoint, Column, BrushSelection, FilterMode } from '../types';
import { mapVisibleColumns } from '../src/utils/columnUtils';
import { filterData } from '../src/utils/dataUtils';
import { computeSelectedStateHash, createSpatialGrid, getPointsInBrush } from '../src/utils/selectionUtils';

type NumericScale = d3.ScaleContinuousNumeric<number, number>;

const MAX_CACHE_ENTRIES_PER_CANVAS = 6;
const MAX_CACHE_PIXELS_PER_CANVAS = 400 * 400;

interface ScatterPlotMatrixProps {
  data: DataPoint[];
  columns: Column[];
  onColumnReorder: (dragIndex: number, hoverIndex: number) => void;
  brushSelection: BrushSelection;
  onBrush: (selection: BrushSelection) => void;
  filterMode: FilterMode;
  showHistograms: boolean;
  useUniformLogBins: boolean;
  labelColumn: string | null;
  onPointHover: (content: string, event: MouseEvent) => void;
  onPointLeave: () => void;
  onRenderLifecycle?: (event: { phase: 'rendering' | 'idle'; total: number; completed: number }) => void;
}

const DraggableHeader: React.FC<{
  name: string,
  index: number,
  onColumnReorder: (dragIndex: number, hoverIndex: number) => void,
  onDragStart?: () => void,
  onDragEnd?: () => void
}> = ({ name, index, onColumnReorder, onDragStart, onDragEnd }) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isOver }, drop] = useDrop({
    accept: 'column',
    drop(item: { index: number, originalIndex: number }) {
      const dragIndex = item.originalIndex;
      const hoverIndex = index;
      if (dragIndex !== hoverIndex) {
        onColumnReorder(dragIndex, hoverIndex);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  const [{ isDragging }, drag] = useDrag({
    type: 'column',
    item: () => {
      onDragStart?.();
      return { index, originalIndex: index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDragEnd?.();
    },
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      className={`w-full h-full flex items-center justify-center border rounded cursor-move select-none ${isDragging ? 'border-brand-secondary bg-gray-100' :
        isOver ? 'border-brand-primary bg-brand-primary/10' :
          'border-gray-300'
        }`}
    >
      {isDragging ? (
        <span className="font-bold text-gray-400 p-2 text-center break-all">Moving...</span>
      ) : isOver ? (
        <span className="font-bold text-brand-primary p-2 text-center break-all">Drop here</span>
      ) : (
        <span className="font-bold text-brand-dark p-2 text-center break-all">{name}</span>
      )}
    </div>
  );
};


export const ScatterPlotMatrix: React.FC<ScatterPlotMatrixProps> = ({
  data,
  columns,
  onColumnReorder,
  brushSelection,
  onBrush,
  filterMode,
  showHistograms,
  useUniformLogBins,
  labelColumn,
  onPointHover,
  onPointLeave,
  onRenderLifecycle
}) => {
  const ref = useRef<SVGSVGElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasElementsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasRenderKeyRef = useRef<Map<string, string>>(new Map());
  const renderCacheRef = useRef<Map<string, Map<string, ImageData>>>(new Map());
  const lastDataStateRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const [coordinateDisplay, setCoordinateDisplay] = useState<CoordinateDisplay>({
    visible: false,
    x: 0,
    y: 0,
    xValue: null,
    yValue: null,
    xColumn: null,
    yColumn: null
  });
  const pendingRenderCancelRef = useRef<(() => void) | null>(null);
  const size = 150;
  const padding = 20;

  // Tooltip positioning constants
  const TOOLTIP_WIDTH = 200;
  const TOOLTIP_HEIGHT = 40;
  const TOOLTIP_OFFSET = 10;

  const { visibleColumns, visibleIndexToOriginalIndex } = useMemo(
    () => mapVisibleColumns(columns),
    [columns]
  );

  const n = visibleColumns.length;
  const plotSize = showHistograms ? size * (n + 1) : size * n;

  const selectedIds = useMemo(() => {
    return brushSelection?.selectedIds || new Set<number>();
  }, [brushSelection]);

  const allowCanvasCache = selectedIds.size === 0;

  const cancelPendingRenders = useCallback(() => {
    if (pendingRenderCancelRef.current) {
      pendingRenderCancelRef.current();
      pendingRenderCancelRef.current = null;
    }
  }, []);

  // Canvas rendering function
  const renderPointsToCanvas = useCallback((canvas: HTMLCanvasElement, data: DataPoint[], xScale: NumericScale, yScale: NumericScale, xCol: string, yCol: string, selectedIds: Set<number>, filterMode: FilterMode) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    // Render non-selected points first
    if (filterMode === 'highlight' || selectedIds.size === 0) {
      ctx.fillStyle = selectedIds.size > 0 ? '#ccc' : '#4b5563';
      ctx.globalAlpha = selectedIds.size > 0 ? 0.3 : 0.7;

      data.forEach(d => {
        if (selectedIds.size > 0 && selectedIds.has(d.__id)) return;

        const x = +d[xCol];
        const y = +d[yCol];
        if (!isFinite(x) || !isFinite(y)) return;

        const screenX = xScale(x);
        const screenY = yScale(y);

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    // Render selected points on top
    if (selectedIds.size > 0) {
      ctx.fillStyle = '#1e40af';
      ctx.globalAlpha = 0.8;

      data.forEach(d => {
        if (!selectedIds.has(d.__id)) return;

        const x = +d[xCol];
        const y = +d[yCol];
        if (!isFinite(x) || !isFinite(y)) return;

        const screenX = xScale(x);
        const screenY = yScale(y);

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      });
    }

    ctx.globalAlpha = 1;
  }, [size]);

  type RenderTask = {
    canvas: HTMLCanvasElement;
    canvasKey: string;
    renderKey: string;
    xScale: NumericScale;
    yScale: NumericScale;
    xCol: string;
    yCol: string;
  };

  const scheduleCanvasRendering = useCallback((tasks: RenderTask[], totalPairs: number, dataToRender: DataPoint[], selected: Set<number>, mode: FilterMode) => {
    cancelPendingRenders();

    if (tasks.length === 0) {
      onRenderLifecycle?.({ phase: 'idle', total: totalPairs, completed: totalPairs });
      return () => { /* no-op */ };
    }

    let cancelled = false;
    let frameId: number | null = null;
    let completed = 0;
    const totalCount = totalPairs > 0 ? totalPairs : tasks.length;

    onRenderLifecycle?.({ phase: 'rendering', total: totalCount, completed: 0 });

    const processFrame = () => {
      if (cancelled) return;

      const frameStart = performance.now();
      let processedThisFrame = 0;

      while (completed < tasks.length && (processedThisFrame < 4 || performance.now() - frameStart < 12)) {
        const task = tasks[completed];
        renderPointsToCanvas(task.canvas, dataToRender, task.xScale, task.yScale, task.xCol, task.yCol, selected, mode);
        canvasRenderKeyRef.current.set(task.canvasKey, task.renderKey);
        if (selected.size === 0) {
          const ctx = task.canvas.getContext('2d');
          if (ctx) {
            try {
              const pixelCount = task.canvas.width * task.canvas.height;
              if (pixelCount <= MAX_CACHE_PIXELS_PER_CANVAS) {
                const imageData = ctx.getImageData(0, 0, size, size);
                let cacheForCanvas = renderCacheRef.current.get(task.canvasKey);
                if (!cacheForCanvas) {
                  cacheForCanvas = new Map();
                  renderCacheRef.current.set(task.canvasKey, cacheForCanvas);
                }
                cacheForCanvas.set(task.renderKey, imageData);
                if (cacheForCanvas.size > MAX_CACHE_ENTRIES_PER_CANVAS) {
                  const oldestKey = cacheForCanvas.keys().next().value;
                  cacheForCanvas.delete(oldestKey);
                }
              }
            } catch (error) {
              // Ignore caching errors (e.g., if the canvas is tainted)
            }
          }
        }
        completed += 1;
        processedThisFrame += 1;
      }

      onRenderLifecycle?.({ phase: 'rendering', total: totalCount, completed: Math.min(completed, totalCount) });

      if (completed < tasks.length) {
        frameId = requestAnimationFrame(processFrame);
      } else {
        pendingRenderCancelRef.current = null;
        onRenderLifecycle?.({ phase: 'idle', total: totalCount, completed: totalCount });
      }
    };

    frameId = requestAnimationFrame(processFrame);

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      pendingRenderCancelRef.current = null;
      onRenderLifecycle?.({ phase: 'idle', total: totalCount, completed: Math.min(completed, totalCount) });
    };

    pendingRenderCancelRef.current = cancel;
    return cancel;
  }, [cancelPendingRenders, onRenderLifecycle, renderPointsToCanvas, size]);

  const { filteredData, selectedData } = useMemo(
    () => filterData(data, selectedIds, filterMode),
    [data, selectedIds, filterMode]
  );

  const dataStateHash = useMemo(() => {
    if (data.length === 0) return 'empty';
    const firstId = data[0]?.__id ?? 0;
    const lastId = data[data.length - 1]?.__id ?? 0;
    return `${data.length}-${firstId}-${lastId}`;
  }, [data]);

  const selectedStateHash = useMemo(() => computeSelectedStateHash(selectedIds), [selectedIds]);

  useEffect(() => {
    if (lastDataStateRef.current && lastDataStateRef.current !== dataStateHash) {
      renderCacheRef.current.clear();
      canvasRenderKeyRef.current.clear();
    }
    lastDataStateRef.current = dataStateHash;
  }, [dataStateHash]);

  // Compute stats from appropriate dataset: filtered data when in filter mode with selection, otherwise full data
  const dataForStats = useMemo(() => {
    return (filterMode === 'filter' && selectedIds.size > 0) ? filteredData : data;
  }, [filterMode, selectedIds.size, filteredData, data]);

  const columnStats = useMemo(() => {
    const stats = new Map<string, { min: number; max: number; minPositive: number }>();
    visibleColumns.forEach(col => {
      stats.set(col.name, { min: Infinity, max: -Infinity, minPositive: Infinity });
    });

    if (visibleColumns.length === 0) {
      return stats;
    }

    for (const row of dataForStats) {
      for (const col of visibleColumns) {
        const value = +row[col.name];
        if (!isFinite(value)) continue;
        const columnStat = stats.get(col.name);
        if (!columnStat) continue;
        if (value < columnStat.min) columnStat.min = value;
        if (value > columnStat.max) columnStat.max = value;
        if (value > 0 && value < columnStat.minPositive) columnStat.minPositive = value;
      }
    }

    visibleColumns.forEach(col => {
      const stat = stats.get(col.name);
      if (!stat) return;
      if (!isFinite(stat.min)) stat.min = 0;
      if (!isFinite(stat.max)) stat.max = 1;
      if (!isFinite(stat.minPositive)) stat.minPositive = Math.max(1e-9, stat.max);
      if (stat.min === stat.max) {
        stat.min = stat.min - 1;
        stat.max = stat.max + 1;
      }
    });

    return stats;
  }, [dataForStats, visibleColumns]);

  const createScale = useCallback(
    (column: Column, range: [number, number]) => {
      const stat = columnStats.get(column.name);
      const defaultDomain: [number, number] = [0, 1];

      if (!stat) {
        return d3.scaleLinear().domain(defaultDomain).range(range);
      }

      if (column.scale === 'log') {
        const start = isFinite(stat.minPositive) ? stat.minPositive : 1e-9;
        const end = stat.max > start ? stat.max : start * 10;
        return d3.scaleLog().domain([start, end]).range(range);
      }

      return d3.scaleLinear().domain([stat.min, stat.max]).range(range);
    },
    [columnStats]
  );

  const xScales = useMemo(
    () => visibleColumns.map(col => createScale(col, [padding / 2, size - padding / 2])),
    [visibleColumns, createScale, padding, size]
  );

  const yScales = useMemo(
    () => visibleColumns.map(col => createScale(col, [size - padding / 2, padding / 2])),
    [visibleColumns, createScale, padding, size]
  );

  const cellCoordinates = useMemo(() => d3.cross(d3.range(n), d3.range(n)), [n]);
  const headerIndices = useMemo(() => d3.range(n), [n]);

  useEffect(() => {
    if (data.length === 0) {
      cancelPendingRenders();
      onRenderLifecycle?.({ phase: 'idle', total: 0, completed: 0 });
    }
  }, [data.length, cancelPendingRenders, onRenderLifecycle]);

  // Drag optimization callbacks
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    cancelPendingRenders();
    onRenderLifecycle?.({ phase: 'idle', total: 0, completed: 0 });
  }, [cancelPendingRenders, onRenderLifecycle]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    cancelPendingRenders();

    // Helper function to get mouse position relative to SVG
    const getMousePosition = (event: d3.D3BrushEvent<unknown>) => {
      if (!event.sourceEvent || !ref.current) return null;
      const svgRect = ref.current.getBoundingClientRect();
      return {
        x: event.sourceEvent.clientX - svgRect.left,
        y: event.sourceEvent.clientY - svgRect.top,
      };
    };

    // Typed wrapper functions for D3 brush operations
    const callBrushMove = (selection: d3.Selection<SVGGElement | d3.BaseType, unknown, null, undefined>, brush: d3.BrushBehavior<unknown>, selectionData: [[number, number], [number, number]] | null) => {
      selection.call(brush.move as any, selectionData);
    };

    const callBrushXMove = (selection: d3.Selection<SVGGElement | d3.BaseType, unknown, null, undefined>, brush: d3.BrushBehavior<unknown>, selectionData: [number, number] | null) => {
      selection.call(brush.move as any, selectionData);
    };

    const callBrushYMove = (selection: d3.Selection<SVGGElement | d3.BaseType, unknown, null, undefined>, brush: d3.BrushBehavior<unknown>, selectionData: [number, number] | null) => {
      selection.call(brush.move as any, selectionData);
    };

    // During drag, we'll update layout but skip expensive canvas re-rendering

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove(); // Clear previous render

    const createScale = (c: Column, range: [number, number]) => {
      // Force coercion to number and filter out non-finite values
      const values = data.map(d => +d[c.name]).filter(isFinite);
      const extent = d3.extent(values);

      let domain: [number, number] = [0, 1];
      if (extent[0] !== undefined && extent[1] !== undefined) {
        domain = extent as [number, number];
      }

      if (c.scale === 'log') {
        const start = Math.max(1e-9, domain[0]);
        let end = Math.max(1e-9, domain[1]);
        if (start >= end) {
          end = start * 10;
        }
        domain = [start, end];
        return d3.scaleLog().domain(domain).range(range);
      }

      if (domain[0] === domain[1]) {
        domain = [domain[0] - 1, domain[1] + 1];
      }

      return d3.scaleLinear().domain(domain).range(range);
    };

    if (n === 0) return; // Don't render if no columns are visible

    const cell = svg.append("g")
      .selectAll("g")
      .data(cellCoordinates)
      .join("g")
      .attr("transform", ([i, j]) => `translate(${i * size},${j * size})`)
      .attr("data-index-i", ([i, _]) => i)
      .attr("data-index-j", ([_, j]) => j);

    const brushableCells = cell.filter(([i, j]) => i !== j);
    let histCellsBottom: d3.Selection<SVGGElement, number, SVGGElement, unknown> | null = null;
    let histCellsRight: d3.Selection<SVGGElement, number, SVGGElement, unknown> | null = null;

    const brush = d3.brush<unknown>().extent([[0, 0], [size, size]]);
    const brushX = d3.brushX<number>().extent([[0, 0], [size, size]]);
    const brushY = d3.brushY<number>().extent([[0, 0], [size, size]]);

    brush
      .on("start", function (event) {
        if (!event.sourceEvent) return;
        setCoordinateDisplay(prev => ({ ...prev, visible: true }));
      })
      .on("brush", function (event) {
        if (!event.sourceEvent) return;

        // Get the [i, j] data bound to this cell
        const cellData = d3.select(this).datum() as [number, number];
        if (!cellData || cellData.length !== 2) return;

        const [i_visible, j_visible] = cellData;
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        const j_original = visibleIndexToOriginalIndex.get(j_visible);

        if (i_original === undefined || j_original === undefined) return;

        const colX = columns[i_original];
        const colY = columns[j_original];
        if (!colX || !colY) return;

        // Get current mouse position relative to the SVG
        const mousePos = getMousePosition(event);
        if (!mousePos) return;

        // Calculate cell position
        const cellX = i_visible * size;
        const cellY = j_visible * size;

        // Convert mouse position to cell-relative coordinates
        const cellRelativeX = mousePos.x - cellX;
        const cellRelativeY = mousePos.y - cellY;

        // Convert to data values
        const xValue = xScales[i_visible].invert(cellRelativeX);
        const yValue = yScales[j_visible].invert(cellRelativeY);

        setCoordinateDisplay({
          visible: true,
          x: mousePos.x,
          y: mousePos.y,
          xValue: xValue,
          yValue: yValue,
          xColumn: colX.name,
          yColumn: colY.name
        });
      })
      .on("end", function (event) {
        if (!event.sourceEvent) return; // Ignore programmatic brushes

        setCoordinateDisplay(prev => ({ ...prev, visible: false }));

        if (!event.selection) {
          onBrush(null);
          return;
        }

        // Get the [i, j] data bound to this cell
        const cellData = d3.select(this).datum() as [number, number];
        if (!cellData || cellData.length !== 2) return;

        const [i_visible, j_visible] = cellData;
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        const j_original = visibleIndexToOriginalIndex.get(j_visible);

        if (i_original === undefined || j_original === undefined) return;

        const [[x0, y0], [x1, y1]] = event.selection;

        const colX = columns[i_original];
        const colY = columns[j_original];
        if (!colX || !colY) return;

        // Create spatial grid for fast selection
        const grid = createSpatialGrid(data, xScales[i_visible], yScales[j_visible], colX.name, colY.name, size);
        const newSelectedIds = getPointsInBrush(grid, xScales[i_visible], yScales[j_visible], x0, y0, x1, y1, colX.name, colY.name, size);
        onBrush({ indexX: i_original, indexY: j_original, x0, y0, x1, y1, selectedIds: newSelectedIds });
      });

    brushableCells.call(brush);

    // Create canvas elements for point rendering
    if (!canvasContainerRef.current) return;

    const activeCanvases = new Set<string>();
    const container = canvasContainerRef.current;
    const renderTasks: RenderTask[] = [];

    brushableCells.each(function ([i, j]) {
      const i_original = visibleIndexToOriginalIndex.get(i);
      const j_original = visibleIndexToOriginalIndex.get(j);
      if (i_original === undefined || j_original === undefined) return;

      const colX = columns[i_original];
      const colY = columns[j_original];
      if (!colX || !colY) return;

      const canvasKey = `${colX.name}-${colY.name}`;
      activeCanvases.add(canvasKey);

      let canvas = canvasElementsRef.current.get(canvasKey);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvasElementsRef.current.set(canvasKey, canvas);
      }

      if (!canvas.isConnected) {
        container.appendChild(canvas);
      }

      canvas.style.left = `${i * size}px`;
      canvas.style.top = `${j * size}px`;

      const renderKey = `${colX.name}-${colY.name}-${colX.scale}-${colY.scale}-${filterMode}-${dataStateHash}-${selectedStateHash}-${size}`;
      const previousKey = canvasRenderKeyRef.current.get(canvasKey);

      if (!isDraggingRef.current) {
        if (previousKey === renderKey) {
          return;
        }

        const cacheForCanvas = allowCanvasCache ? renderCacheRef.current.get(canvasKey) : undefined;
        const cachedImage = cacheForCanvas?.get(renderKey);

        if (cachedImage) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.putImageData(cachedImage, 0, 0);
          }
          canvasRenderKeyRef.current.set(canvasKey, renderKey);
          if (cacheForCanvas) {
            // Refresh the entry position to preserve LRU semantics on subsequent evictions.
            cacheForCanvas.delete(renderKey);
            cacheForCanvas.set(renderKey, cachedImage);
          }
          return;
        }

        renderTasks.push({
          canvas,
          canvasKey,
          renderKey,
          xScale: xScales[i],
          yScale: yScales[j],
          xCol: colX.name,
          yCol: colY.name,
        });
      }
    });

    // Remove canvases for columns that are no longer visible
    const canvasesToRemove: string[] = [];
    canvasElementsRef.current.forEach((canvas, key) => {
      if (!activeCanvases.has(key)) {
        canvas.remove();
        canvasesToRemove.push(key);
      }
    });

    canvasesToRemove.forEach(key => {
      canvasElementsRef.current.delete(key);
      canvasRenderKeyRef.current.delete(key);
    });

    let cancelRender: () => void = () => { };
    if (!isDraggingRef.current) {
      cancelRender = scheduleCanvasRendering(renderTasks, renderTasks.length, filteredData, selectedIds, filterMode);
    } else {
      onRenderLifecycle?.({ phase: 'idle', total: 0, completed: 0 });
    }

    const diagonalCells = cell.filter(([i, j]) => i === j);

    diagonalCells.each(function ([i]) {
      const g = d3.select(this);

      // Add a data-testid to the diagonal cell for easy selection in tests
      const originalIndex = visibleIndexToOriginalIndex.get(i);
      if (originalIndex !== undefined) {
        const columnName = columns[originalIndex].name;
        g.attr('data-testid', `diagonal-cell-${columnName}`);
      }

      // Left Axis
      const leftAxis = d3.axisLeft(yScales[i]).ticks(4).tickSize(5).tickPadding(-4);
      g.append("g")
        .attr("transform", `translate(${padding / 2}, 0)`)
        .call(leftAxis)
        .call(axis => {
          axis.select(".domain").remove();
          axis.selectAll(".tick line")
            .style("stroke", "#3f3f46");
          axis.selectAll("text")
            .style("text-anchor", "start")
            .style("font-size", "10px")
            .style("fill", "#3f3f46");
        });
    });

    if (showHistograms) {
      brushX
        .on("end", function (event) {
          if (!event.sourceEvent) return;

          const i_visible = d3.select(this).datum() as number;
          if (i_visible === undefined) return;

          const i_original = visibleIndexToOriginalIndex.get(i_visible);
          if (i_original === undefined || !columns[i_original]) return;

          if (!event.selection) { onBrush(null); return; }

          const [x0, x1] = event.selection;
          // Faster selection for histogram brush
          const newSelectedIds = new Set<number>();
          const minVal = xScales[i_visible].invert(x0);
          const maxVal = xScales[i_visible].invert(x1);
          for (const d of data) {
            const val = +d[columns[i_original].name];
            if (val >= minVal && val <= maxVal) newSelectedIds.add(d.__id);
          }
          onBrush({ indexX: i_original, indexY: columns.length, x0, y0: padding / 2, x1, y1: size - padding / 2, selectedIds: newSelectedIds });
        });

      histCellsBottom = svg.append("g").selectAll("g").data(d3.range(n)).join("g")
        .attr("transform", i => `translate(${i * size}, ${n * size})`)
        .attr("data-index", i => i) as d3.Selection<SVGGElement, number, SVGGElement, unknown>;

      histCellsBottom.call(brushX);

      histCellsBottom.each(function (i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible)!;
        const column = columns[i_original];
        const allValues = filteredData.map(d => +d[column.name]).filter(isFinite);
        const selectedValues = selectedData.map(d => +d[column.name]).filter(isFinite);

        const domain = xScales[i_visible].domain();
        const minDomain = Math.min(domain[0], domain[1]);
        const maxDomain = Math.max(domain[0], domain[1]);

        // Create bin generator with uniform log bins if requested and using log scale
        let binGenerator;
        if (useUniformLogBins && column.scale === 'log') {
          // Create uniform bins in log space
          const logMin = Math.log10(Math.max(minDomain, 1e-10));
          const logMax = Math.log10(maxDomain);
          const numBins = 20;
          const logStep = (logMax - logMin) / numBins;
          const thresholds = Array.from({ length: numBins + 1 }, (_, i) => Math.pow(10, logMin + i * logStep));
          binGenerator = d3.bin().domain([minDomain, maxDomain]).thresholds(thresholds);
        } else {
          binGenerator = d3.bin().domain([minDomain, maxDomain]).thresholds(20);
        }

        const allBins = binGenerator(allValues);
        const selectedBins = binGenerator(selectedValues);

        const combinedBins: HistogramBin[] = allBins.map((bin, index) => ({
          x0: bin.x0!,
          x1: bin.x1!,
          totalLength: bin.length,
          selectedLength: selectedBins[index]?.length || 0
        }));

        const yHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([size - padding / 2, padding / 2]);

        const g = d3.select(this);
        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
          .attr("x", d => xScales[i_visible](d.x0)! + 1)
          .attr("width", d => Math.max(0, xScales[i_visible](d.x1)! - xScales[i_visible](d.x0)! - 1))
          .attr("y", d => yHist(d.totalLength)!)
          .attr("height", d => size - padding / 2 - yHist(d.totalLength)!)
          .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
          .attr("x", d => xScales[i_visible](d.x0)! + 1)
          .attr("width", d => Math.max(0, xScales[i_visible](d.x1)! - xScales[i_visible](d.x0)! - 1))
          .attr("y", d => yHist(d.selectedLength)!)
          .attr("height", d => size - padding / 2 - yHist(d.selectedLength)!)
          .attr("fill", "#1e40af");
      });

      brushY
        .on("end", function (event) {
          if (!event.sourceEvent) return;

          const j_visible = d3.select(this).datum() as number;
          if (j_visible === undefined) return;

          const j_original = visibleIndexToOriginalIndex.get(j_visible);
          if (j_original === undefined || !columns[j_original]) return;

          if (!event.selection) { onBrush(null); return; }

          const [y0, y1] = event.selection;
          const newSelectedIds = new Set<number>();
          // Faster selection for Y histogram brush
          const minVal = yScales[j_visible].invert(y1);
          const maxVal = yScales[j_visible].invert(y0);
          for (const d of data) {
            const val = +d[columns[j_original].name];
            if (val >= minVal && val <= maxVal) newSelectedIds.add(d.__id);
          }
          onBrush({ indexX: columns.length, indexY: j_original, x0: padding / 2, y0, x1: size - padding / 2, y1, selectedIds: newSelectedIds });
        });

      histCellsRight = svg.append("g").selectAll("g").data(d3.range(n)).join("g")
        .attr("transform", i => `translate(${n * size}, ${i * size})`)
        .attr("data-index", i => i) as d3.Selection<SVGGElement, number, SVGGElement, unknown>;

      histCellsRight.call(brushY);

      histCellsRight.each(function (j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible)!;
        const column = columns[j_original];
        const allValues = filteredData.map(d => +d[column.name]).filter(isFinite);
        const selectedValues = selectedData.map(d => +d[column.name]).filter(isFinite);

        const domain = yScales[j_visible].domain();
        const minDomain = Math.min(domain[0], domain[1]);
        const maxDomain = Math.max(domain[0], domain[1]);

        // Create bin generator with uniform log bins if requested and using log scale
        let binGenerator;
        if (useUniformLogBins && column.scale === 'log') {
          // Create uniform bins in log space
          const logMin = Math.log10(Math.max(minDomain, 1e-10));
          const logMax = Math.log10(maxDomain);
          const numBins = 20;
          const logStep = (logMax - logMin) / numBins;
          const thresholds = Array.from({ length: numBins + 1 }, (_, i) => Math.pow(10, logMin + i * logStep));
          binGenerator = d3.bin().domain([minDomain, maxDomain]).thresholds(thresholds);
        } else {
          binGenerator = d3.bin().domain([minDomain, maxDomain]).thresholds(20);
        }

        const allBins = binGenerator(allValues);
        const selectedBins = binGenerator(selectedValues);

        const combinedBins: HistogramBin[] = allBins.map((bin, index) => ({
          x0: bin.x0!,
          x1: bin.x1!,
          totalLength: bin.length,
          selectedLength: selectedBins[index]?.length || 0
        }));

        const xHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([padding / 2, size - padding / 2]);
        const g = d3.select(this);

        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
          .attr("y", d => yScales[j_visible](d.x1)! + 1)
          .attr("height", d => Math.max(0, yScales[j_visible](d.x0)! - yScales[j_visible](d.x1)! - 1))
          .attr("x", padding / 2)
          .attr("width", d => xHist(d.totalLength)! - padding / 2)
          .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
          .attr("y", d => yScales[j_visible](d.x1)! + 1)
          .attr("height", d => Math.max(0, yScales[j_visible](d.x0)! - yScales[j_visible](d.x1)! - 1))
          .attr("x", padding / 2)
          .attr("width", d => xHist(d.selectedLength)! - padding / 2)
          .attr("fill", "#1e40af");
      });
    }

    // Declaratively sync the brush visual state with the React state.
    brushableCells.each(function ([i_visible, j_visible]) {
      const i_original = visibleIndexToOriginalIndex.get(i_visible);
      const j_original = visibleIndexToOriginalIndex.get(j_visible);

      if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === j_original) {
        callBrushMove(d3.select(this), brush, [[brushSelection.x0, brushSelection.y0], [brushSelection.x1, brushSelection.y1]]);
      } else {
        callBrushMove(d3.select(this), brush, null);
      }
    });

    if (showHistograms && histCellsBottom) {
      histCellsBottom.each(function (i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === columns.length) {
          callBrushXMove(d3.select(this), brushX, [brushSelection.x0, brushSelection.x1]);
        } else {
          callBrushXMove(d3.select(this), brushX, null);
        }
      });
    }

    if (showHistograms && histCellsRight) {
      histCellsRight.each(function (j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible);
        if (brushSelection && brushSelection.indexX === columns.length && brushSelection.indexY === j_original) {
          callBrushYMove(d3.select(this), brushY, [brushSelection.y0, brushSelection.y1]);
        } else {
          callBrushYMove(d3.select(this), brushY, null);
        }
      });
    }

    return () => {
      cancelRender();
    };

  }, [data, columns, onBrush, filteredData, selectedData, selectedIds, size, padding, n, showHistograms, filterMode, brushSelection, visibleColumns, visibleIndexToOriginalIndex, renderPointsToCanvas, xScales, yScales, cellCoordinates, dataStateHash, selectedStateHash, scheduleCanvasRendering, cancelPendingRenders, onRenderLifecycle]);

  return (
    <div className="w-full h-full relative">
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: plotSize,
          height: plotSize,
          pointerEvents: 'none'
        }}
      >
        {headerIndices.map(i => {
          const originalIndex = visibleIndexToOriginalIndex.get(i);
          if (originalIndex === undefined) return null;
          const column = columns[originalIndex];
          return (
            <div
              key={column.name}
              style={{
                position: 'absolute',
                left: i * size,
                top: i * size,
                width: size,
                height: size,
                pointerEvents: 'auto'
              }}
            >
              <DraggableHeader
                name={column.name}
                index={originalIndex}
                onColumnReorder={onColumnReorder}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              />
            </div>
          );
        })}
      </div>
      {/* Canvas container for high-performance point rendering */}
      <div
        ref={canvasContainerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: plotSize,
          height: plotSize,
          pointerEvents: 'none'
        }}
      />
      <svg id="scatterplot-matrix-svg" ref={ref} width={plotSize} height={plotSize}></svg>

      {/* Coordinate Display */}
      {coordinateDisplay.visible && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(coordinateDisplay.x + TOOLTIP_OFFSET, plotSize - TOOLTIP_WIDTH),
            top: Math.max(coordinateDisplay.y - TOOLTIP_HEIGHT, TOOLTIP_OFFSET),
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 1000,
            minWidth: '150px'
          }}
        >
          {coordinateDisplay.xColumn && (
            <div>
              <strong>{coordinateDisplay.xColumn}:</strong> {coordinateDisplay.xValue?.toFixed(3)}
            </div>
          )}
          {coordinateDisplay.yColumn && (
            <div>
              <strong>{coordinateDisplay.yColumn}:</strong> {coordinateDisplay.yValue?.toFixed(3)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};