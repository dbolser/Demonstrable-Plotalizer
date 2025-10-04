import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useDrag, useDrop } from 'react-dnd';
import type { DataPoint, Column, BrushSelection, FilterMode } from '../types';
import { mapVisibleColumns } from '../src/utils/columnUtils';
import { filterData } from '../src/utils/dataUtils';
import { computeSelectedStateHash } from '../src/utils/selectionUtils';

interface ScatterPlotMatrixProps {
  data: DataPoint[];
  columns: Column[];
  onColumnReorder: (dragIndex: number, hoverIndex: number) => void;
  brushSelection: BrushSelection;
  onBrush: (selection: BrushSelection) => void;
  filterMode: FilterMode;
  showHistograms: boolean;
  labelColumn: string | null;
  onPointHover: (content: string, event: MouseEvent) => void;
  onPointLeave: () => void;
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
  labelColumn,
  onPointHover,
  onPointLeave
}) => {
  const ref = useRef<SVGSVGElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasElementsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const canvasRenderKeyRef = useRef<Map<string, string>>(new Map());
  const isDraggingRef = useRef(false);
  const size = 150;
  const padding = 20;

  const { visibleColumns, visibleIndexToOriginalIndex } = useMemo(
    () => mapVisibleColumns(columns),
    [columns]
  );

  const n = visibleColumns.length;
  const plotSize = showHistograms ? size * (n + 1) : size * n;

  const selectedIds = useMemo(() => {
    return brushSelection?.selectedIds || new Set<number>();
  }, [brushSelection]);

  // Spatial grid for fast brush selection
  const createSpatialGrid = useCallback((data: DataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, xCol: string, yCol: string) => {
    const gridSize = 20; // 20x20 grid
    const grid: DataPoint[][][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(null).map(() => []));

    data.forEach(d => {
      const x = +d[xCol];
      const y = +d[yCol];
      if (!isFinite(x) || !isFinite(y)) return;

      const screenX = xScale(x);
      const screenY = yScale(y);
      // Map screen coordinates [0, size] to grid cells [0, gridSize-1]
      const gridX = Math.floor((screenX / size) * gridSize);
      const gridY = Math.floor((screenY / size) * gridSize);

      if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
        grid[gridX][gridY].push(d);
      }
    });

    return grid;
  }, [size]);

  // Fast brush selection using spatial grid
  const getPointsInBrush = useCallback((grid: DataPoint[][][], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, x0: number, y0: number, x1: number, y1: number, xCol: string, yCol: string) => {
    const gridSize = 20;
    const selectedIds = new Set<number>();

    // Map brush coordinates to grid cells
    // Since brush now covers [0, size], we need to map that range to [0, gridSize-1]
    const startGridX = Math.max(0, Math.floor((x0 / size) * gridSize));
    const endGridX = Math.min(gridSize - 1, Math.ceil((x1 / size) * gridSize));
    const startGridY = Math.max(0, Math.floor((y0 / size) * gridSize));
    const endGridY = Math.min(gridSize - 1, Math.ceil((y1 / size) * gridSize));

    for (let gx = startGridX; gx <= endGridX; gx++) {
      for (let gy = startGridY; gy <= endGridY; gy++) {
        grid[gx][gy].forEach(d => {
          const x = +d[xCol];
          const y = +d[yCol];
          const screenX = xScale(x);
          const screenY = yScale(y);

          if (screenX >= x0 && screenX <= x1 && screenY >= y0 && screenY <= y1) {
            selectedIds.add(d.__id);
          }
        });
      }
    }

    return selectedIds;
  }, [size]);

  // Canvas rendering function
  const renderPointsToCanvas = useCallback((canvas: HTMLCanvasElement, data: DataPoint[], xScale: d3.ScaleLinear<number, number>, yScale: d3.ScaleLinear<number, number>, xCol: string, yCol: string, selectedIds: Set<number>, filterMode: FilterMode) => {
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

  const columnStats = useMemo(() => {
    const stats = new Map<string, { min: number; max: number; minPositive: number }>();
    visibleColumns.forEach(col => {
      stats.set(col.name, { min: Infinity, max: -Infinity, minPositive: Infinity });
    });

    if (visibleColumns.length === 0) {
      return stats;
    }

    for (const row of data) {
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
  }, [data, visibleColumns]);

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

  // Drag optimization callbacks
  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    // During drag, we'll update layout but skip expensive canvas re-rendering

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove(); // Clear previous render

    const createScale = (c: Column, range: [number, number]) => {
      // Force coercion to number and filter out non-finite values
      const values = data.map(d => +d[c.name]).filter(isFinite);
      const extent = d3.extent(values);

      let domain: [number, number] = [0, 1];
      if (extent[0] !== undefined && extent[1] !== undefined) {
        domain = extent;
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

    const brush = d3.brush().extent([[0, 0], [size, size]]);
    const brushX = d3.brushX().extent([[0, 0], [size, size]]);
    const brushY = d3.brushY().extent([[0, 0], [size, size]]);

    brush
      .on("end", function (event) {
        if (!event.sourceEvent) return; // Ignore programmatic brushes

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
        const grid = createSpatialGrid(data, xScales[i_visible], yScales[j_visible], colX.name, colY.name);
        const newSelectedIds = getPointsInBrush(grid, xScales[i_visible], yScales[j_visible], x0, y0, x1, y1, colX.name, colY.name);
        onBrush({ indexX: i_original, indexY: j_original, x0, y0, x1, y1, selectedIds: newSelectedIds });
      });

    brushableCells.call(brush);

    // Create canvas elements for point rendering
    if (!canvasContainerRef.current) return;

    const activeCanvases = new Set<string>();
    const container = canvasContainerRef.current;

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

      const renderKey = `${colX.name}-${colY.name}-${colX.scale}-${colY.scale}-${filterMode}-${dataStateHash}-${selectedStateHash}`;
      const previousKey = canvasRenderKeyRef.current.get(canvasKey);

      if (!isDraggingRef.current && previousKey !== renderKey) {
        renderPointsToCanvas(
          canvas,
          filteredData,
          xScales[i],
          yScales[j],
          colX.name,
          colY.name,
          selectedIds,
          filterMode
        );
        canvasRenderKeyRef.current.set(canvasKey, renderKey);
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
        .attr("data-index", i => i)
        .call(brushX);

      histCellsBottom.each(function (i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible)!;
        const allValues = filteredData.map(d => +d[columns[i_original].name]).filter(isFinite);
        const selectedValues = selectedData.map(d => +d[columns[i_original].name]).filter(isFinite);

        const domain = xScales[i_visible].domain();
        const binGenerator = d3.bin().domain([Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])]).thresholds(20);

        const allBins = binGenerator(allValues);
        const selectedBins = binGenerator(selectedValues);

        const combinedBins = allBins.map((bin, index) => ({
          x0: bin.x0, x1: bin.x1,
          totalLength: bin.length,
          selectedLength: selectedBins[index]?.length || 0
        }));

        const yHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([size - padding / 2, padding / 2]);

        const g = d3.select(this);
        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
          .attr("x", d => xScales[i_visible](d.x0!)! + 1)
          .attr("width", d => Math.max(0, xScales[i_visible](d.x1!)! - xScales[i_visible](d.x0!)! - 1))
          .attr("y", d => yHist(d.totalLength)!)
          .attr("height", d => size - padding / 2 - yHist(d.totalLength)!)
          .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
          .attr("x", d => xScales[i_visible](d.x0!)! + 1)
          .attr("width", d => Math.max(0, xScales[i_visible](d.x1!)! - xScales[i_visible](d.x0!)! - 1))
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
        .attr("data-index", i => i)
        .call(brushY);

      histCellsRight.each(function (j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible)!;
        const allValues = filteredData.map(d => +d[columns[j_original].name]).filter(isFinite);
        const selectedValues = selectedData.map(d => +d[columns[j_original].name]).filter(isFinite);

        const domain = yScales[j_visible].domain();
        const binGenerator = d3.bin().domain([Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])]).thresholds(20);

        const allBins = binGenerator(allValues);
        const selectedBins = binGenerator(selectedValues);

        const combinedBins = allBins.map((bin, index) => ({
          x0: bin.x0, x1: bin.x1,
          totalLength: bin.length,
          selectedLength: selectedBins[index]?.length || 0
        }));

        const xHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([padding / 2, size - padding / 2]);
        const g = d3.select(this);

        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
          .attr("y", d => yScales[j_visible](d.x1!)! + 1)
          .attr("height", d => Math.max(0, yScales[j_visible](d.x0!)! - yScales[j_visible](d.x1!)! - 1))
          .attr("x", padding / 2)
          .attr("width", d => xHist(d.totalLength)! - padding / 2)
          .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
          .attr("y", d => yScales[j_visible](d.x1!)! + 1)
          .attr("height", d => Math.max(0, yScales[j_visible](d.x0!)! - yScales[j_visible](d.x1!)! - 1))
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
        d3.select(this).call(brush.move, [[brushSelection.x0, brushSelection.y0], [brushSelection.x1, brushSelection.y1]]);
      } else {
        d3.select(this).call(brush.move, null);
      }
    });

    if (showHistograms && histCellsBottom) {
      histCellsBottom.each(function (i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === columns.length) {
          d3.select(this).call(brushX.move, [brushSelection.x0, brushSelection.x1]);
        } else {
          d3.select(this).call(brushX.move, null);
        }
      });
    }

    if (showHistograms && histCellsRight) {
      histCellsRight.each(function (j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible);
        if (brushSelection && brushSelection.indexX === columns.length && brushSelection.indexY === j_original) {
          d3.select(this).call(brushY.move, [brushSelection.y0, brushSelection.y1]);
        } else {
          d3.select(this).call(brushY.move, null);
        }
      });
    }

  }, [data, columns, onBrush, filteredData, selectedData, selectedIds, size, padding, n, showHistograms, filterMode, brushSelection, visibleColumns, visibleIndexToOriginalIndex, createSpatialGrid, getPointsInBrush, renderPointsToCanvas, xScales, yScales, cellCoordinates, dataStateHash, selectedStateHash]);

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
    </div>
  );
};