import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { useDrag, useDrop } from 'react-dnd';
import type { DataPoint, Column, BrushSelection, FilterMode } from '../types';

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

const DraggableHeader: React.FC<{ name: string, index: number, onColumnReorder: (dragIndex: number, hoverIndex: number) => void }> = ({ name, index, onColumnReorder }) => {
  const ref = useRef<HTMLDivElement>(null);

  const [, drop] = useDrop({
    accept: 'column',
    hover(item: { index: number }) {
      if (!ref.current) return;
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;
      onColumnReorder(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  const [{ isDragging }, drag] = useDrag({
    type: 'column',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      style={{ opacity: isDragging ? 0 : 1 }}
      className="w-full h-full flex items-center justify-center border border-gray-300 rounded cursor-move select-none"
    >
      <span className="font-bold text-brand-dark p-2 text-center break-all">{name}</span>
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
  const size = 150;
  const padding = 20;

  const { visibleColumns, visibleIndexToOriginalIndex, originalIndexToVisibleIndex } = useMemo(() => {
    const visibleCols: Column[] = [];
    const visibleToOrig = new Map<number, number>();
    const origToVisible = new Map<number, number>();
    
    columns.forEach((col, originalIndex) => {
      if (col.visible) {
        const visibleIndex = visibleCols.length;
        visibleToOrig.set(visibleIndex, originalIndex);
        origToVisible.set(originalIndex, visibleIndex);
        visibleCols.push(col);
      }
    });

    return { 
      visibleColumns: visibleCols, 
      visibleIndexToOriginalIndex: visibleToOrig, 
      originalIndexToVisibleIndex: origToVisible 
    };
  }, [columns]);
  
  const n = visibleColumns.length;
  const plotSize = showHistograms ? size * (n + 1) : size * n;
  
  const selectedIds = useMemo(() => {
    return brushSelection?.selectedIds || new Set<number>();
  }, [brushSelection]);

  const { filteredData, selectedData } = useMemo(() => {
    const selected = data.filter(d => selectedIds.has(d.__id));
    if (filterMode === 'filter' && selectedIds.size > 0) {
      return { filteredData: selected, selectedData: selected };
    }
    return { filteredData: data, selectedData: selected };
  }, [data, filterMode, selectedIds]);

  useEffect(() => {
    if (!ref.current || data.length === 0) return;

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove(); // Clear previous render

    const createScale = (c: Column, range: [number, number]) => {
      // Force coersion to number and filter out non-finite values
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

    const xScales = visibleColumns.map(c => createScale(c, [padding / 2, size - padding / 2]));
    const yScales = visibleColumns.map(c => createScale(c, [size - padding / 2, padding / 2]));
    
    const cell = svg.append("g")
      .selectAll("g")
      .data(d3.cross(d3.range(n), d3.range(n)))
      .join("g")
      .attr("transform", ([i, j]) => `translate(${i * size},${j * size})`)
      .attr("data-index-i", ([i, _]) => i)
      .attr("data-index-j", ([_, j]) => j);

    const brushableCells = cell.filter(([i, j]) => i !== j);
    let histCellsBottom: d3.Selection<SVGGElement, number, SVGGElement, unknown> | null = null;
    let histCellsRight: d3.Selection<SVGGElement, number, SVGGElement, unknown> | null = null;
    
    const brush = d3.brush().extent([[padding/2, padding/2], [size-padding/2, size-padding/2]]);
    const brushX = d3.brushX().extent([[padding/2, padding/2], [size - padding/2, size - padding/2]]);
    const brushY = d3.brushY().extent([[padding/2, padding/2], [size - padding/2, size - padding/2]]);

    brush
      .on("end", function(event) {
        if (!event.sourceEvent) return; // Ignore programmatic brushes

        const parentNode = this.parentNode as Element;
        if (!parentNode) return;

        if (!event.selection) {
            onBrush(null);
            return;
        }

        const i_visible = parseInt(d3.select(parentNode).attr("data-index-i")!, 10);
        const j_visible = parseInt(d3.select(parentNode).attr("data-index-j")!, 10);
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        const j_original = visibleIndexToOriginalIndex.get(j_visible);
        
        if (i_original === undefined || j_original === undefined) return;

        const [[x0, y0], [x1, y1]] = event.selection;
        
        const colX = columns[i_original];
        const colY = columns[j_original];
        if (!colX || !colY) return;

        const newSelectedIds = new Set<number>();
        for (const d of data) {
            const valX = +d[colX.name];
            const valY = +d[colY.name];
            if (valX >= xScales[i_visible].invert(x0) && valX <= xScales[i_visible].invert(x1) &&
                valY >= yScales[j_visible].invert(y1) && valY <= yScales[j_visible].invert(y0)) {
                newSelectedIds.add(d.__id);
            }
        }
        onBrush({ indexX: i_original, indexY: j_original, x0, y0, x1, y1, selectedIds: newSelectedIds });
    });

    brushableCells.call(brush);
    
    brushableCells.each(function ([i, j]) {
        const i_original = visibleIndexToOriginalIndex.get(i);
        const j_original = visibleIndexToOriginalIndex.get(j);
        if (i_original === undefined || j_original === undefined) return;
        
        d3.select(this).selectAll("circle")
          .data(filteredData)
          .join("circle")
          .attr("cx", d => xScales[i](+d[columns[i_original].name])!)
          .attr("cy", d => yScales[j](+d[columns[j_original].name])!)
          .attr("r", 2.5)
          .attr("fill", d => selectedIds.size > 0 ? (selectedIds.has(d.__id) ? '#1e40af' : '#ccc') : '#4b5563')
          .attr("fill-opacity", d => selectedIds.size > 0 ? (selectedIds.has(d.__id) ? 0.8 : 0.3) : 0.7)
          .on('mouseover', (event, d) => {
              if (labelColumn) {
                  onPointHover(String(d[labelColumn]), event);
              }
          })
          .on('mouseout', () => {
              onPointLeave();
          });
      });
      
    const diagonalCells = cell.filter(([i, j]) => i === j);
    
    diagonalCells.each(function([i]) {
      const g = d3.select(this);
      g.append("g").attr("transform", `translate(0, ${size - padding / 2})`).call(d3.axisBottom(xScales[i]).ticks(4).tickSize(0).tickPadding(5)).call(g => g.select(".domain").remove()).selectAll("text").style("font-size", "9px").style("fill", "#4b5563");
      g.append("g").attr("transform", `translate(${padding / 2}, 0)`).call(d3.axisLeft(yScales[i]).ticks(4).tickSize(0).tickPadding(5)).call(g => g.select(".domain").remove()).selectAll("text").style("font-size", "9px").style("fill", "#4b5563");
    });
    
    if (showHistograms) {
        brushX
          .on("end", function(event) {
            if (!event.sourceEvent) return;
            const parentNode = this.parentNode as Element;
            if (!parentNode) return;
            const i_visible = parseInt(d3.select(parentNode).attr("data-index")!, 10);
            const i_original = visibleIndexToOriginalIndex.get(i_visible);
            
            if (i_original === undefined || !columns[i_original]) return;

            if (!event.selection) { onBrush(null); return; }

            const [x0, x1] = event.selection;
            const newSelectedIds = new Set<number>();
            for (const d of data) {
                const val = +d[columns[i_original].name];
                if (val >= xScales[i_visible].invert(x0) && val <= xScales[i_visible].invert(x1)) newSelectedIds.add(d.__id);
            }
            onBrush({ indexX: i_original, indexY: columns.length, x0, y0: padding/2, x1, y1: size - padding/2, selectedIds: newSelectedIds });
        });

      histCellsBottom = svg.append("g").selectAll("g").data(d3.range(n)).join("g")
        .attr("transform", i => `translate(${i * size}, ${n * size})`)
        .attr("data-index", i => i)
        .call(brushX);
        
      histCellsBottom.each(function(i_visible) {
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

        const yHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([size - padding/2, padding/2]);
        
        const g = d3.select(this);
        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
            .attr("x", d => xScales[i_visible](d.x0!)! + 1)
            .attr("width", d => Math.max(0, xScales[i_visible](d.x1!)! - xScales[i_visible](d.x0!)! - 1))
            .attr("y", d => yHist(d.totalLength)!)
            .attr("height", d => size - padding/2 - yHist(d.totalLength)!)
            .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");

        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
            .attr("x", d => xScales[i_visible](d.x0!)! + 1)
            .attr("width", d => Math.max(0, xScales[i_visible](d.x1!)! - xScales[i_visible](d.x0!)! - 1))
            .attr("y", d => yHist(d.selectedLength)!)
            .attr("height", d => size - padding/2 - yHist(d.selectedLength)!)
            .attr("fill", "#1e40af");
      });
      
      brushY
        .on("end", function(event) {
          if (!event.sourceEvent) return;
          const parentNode = this.parentNode as Element;
          if (!parentNode) return;
          const j_visible = parseInt(d3.select(parentNode).attr("data-index")!, 10);
          const j_original = visibleIndexToOriginalIndex.get(j_visible);

          if (j_original === undefined || !columns[j_original]) return;
          
          if (!event.selection) { onBrush(null); return; }

          const [y0, y1] = event.selection;
          const newSelectedIds = new Set<number>();
          for (const d of data) {
              const val = +d[columns[j_original].name];
              if (val >= yScales[j_visible].invert(y1) && val <= yScales[j_visible].invert(y0)) newSelectedIds.add(d.__id);
          }
          onBrush({ indexX: columns.length, indexY: j_original, x0: padding/2, y0, x1: size - padding/2, y1, selectedIds: newSelectedIds });
      });

      histCellsRight = svg.append("g").selectAll("g").data(d3.range(n)).join("g")
        .attr("transform", i => `translate(${n * size}, ${i * size})`)
        .attr("data-index", i => i)
        .call(brushY);

      histCellsRight.each(function(j_visible) {
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
        
        const xHist = d3.scaleLinear().domain([0, d3.max(combinedBins, d => d.totalLength) || 1]).range([padding/2, size - padding/2]);
        const g = d3.select(this);

        g.selectAll("rect.total").data(combinedBins).join("rect").attr("class", "total")
            .attr("y", d => yScales[j_visible](d.x1!)! + 1)
            .attr("height", d => Math.max(0, yScales[j_visible](d.x0!)! - yScales[j_visible](d.x1!)! - 1))
            .attr("x", padding/2)
            .attr("width", d => xHist(d.totalLength)! - padding/2)
            .attr("fill", selectedIds.size > 0 ? "#ccc" : "#60a5fa");
        
        g.selectAll("rect.selected").data(combinedBins).join("rect").attr("class", "selected")
            .attr("y", d => yScales[j_visible](d.x1!)! + 1)
            .attr("height", d => Math.max(0, yScales[j_visible](d.x0!)! - yScales[j_visible](d.x1!)! - 1))
            .attr("x", padding/2)
            .attr("width", d => xHist(d.selectedLength)! - padding/2)
            .attr("fill", "#1e40af");
      });
    }
    
    // Declaratively sync the brush visual state with the React state.
    brushableCells.each(function([i_visible, j_visible]) {
      const i_original = visibleIndexToOriginalIndex.get(i_visible);
      const j_original = visibleIndexToOriginalIndex.get(j_visible);
      
      if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === j_original) {
        d3.select(this).call(brush.move, [[brushSelection.x0, brushSelection.y0], [brushSelection.x1, brushSelection.y1]]);
      } else {
        d3.select(this).call(brush.move, null);
      }
    });

    if (showHistograms && histCellsBottom) {
      histCellsBottom.each(function(i_visible) {
        const i_original = visibleIndexToOriginalIndex.get(i_visible);
        if (brushSelection && brushSelection.indexX === i_original && brushSelection.indexY === columns.length) {
          d3.select(this).call(brushX.move, [brushSelection.x0, brushSelection.x1]);
        } else {
          d3.select(this).call(brushX.move, null);
        }
      });
    }
    
    if (showHistograms && histCellsRight) {
       histCellsRight.each(function(j_visible) {
        const j_original = visibleIndexToOriginalIndex.get(j_visible);
        if (brushSelection && brushSelection.indexX === columns.length && brushSelection.indexY === j_original) {
          d3.select(this).call(brushY.move, [brushSelection.y0, brushSelection.y1]);
        } else {
          d3.select(this).call(brushY.move, null);
        }
      });
    }

  }, [data, columns, onBrush, filteredData, selectedData, selectedIds, size, padding, n, showHistograms, filterMode, labelColumn, onPointHover, onPointLeave, brushSelection, visibleColumns, visibleIndexToOriginalIndex, originalIndexToVisibleIndex]);

  return (
    <div className="w-full h-full relative">
       <div style={{
          position: 'absolute',
          display: 'grid',
          gridTemplateColumns: `repeat(${showHistograms ? n + 1 : n}, ${size}px)`,
          gridTemplateRows: `repeat(${showHistograms ? n + 1 : n}, ${size}px)`,
          gap: '0px',
          pointerEvents: 'none'
        }}>
          {n > 0 && d3.cross(d3.range(n), d3.range(n)).map(([i, j]) => {
              if (i === j) {
                  const originalIndex = visibleIndexToOriginalIndex.get(i)!;
                  const column = columns[originalIndex];
                  return (
                    <div key={column.name} style={{ gridColumn: i + 1, gridRow: j + 1, pointerEvents: 'auto' }}>
                        <DraggableHeader name={column.name} index={originalIndex} onColumnReorder={onColumnReorder} />
                    </div>
                  );
              }
              return <div key={`${i}-${j}`} style={{ gridColumn: i + 1, gridRow: j + 1 }}></div>
          })}
        </div>
      <svg id="scatterplot-matrix-svg" ref={ref} width={plotSize} height={plotSize}></svg>
    </div>
  );
};