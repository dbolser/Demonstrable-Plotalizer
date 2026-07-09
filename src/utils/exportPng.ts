// PNG export for the scatter-plot matrix. The points are painted on Canvas
// layers (for performance), the SVG holds axes, ticks, histograms and
// overlays, and the diagonal column labels are HTML drag-handles positioned
// over the plot — so no single layer contains the whole picture. We
// composite: white background → cell canvases → SVG → column labels (the
// labels are positioned elements, so they paint above the static SVG in the
// live view), at an upscaled resolution, and hand back a PNG blob.

export interface CanvasPlacement {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

export function collectCanvasPlacements(container: HTMLElement): CanvasPlacement[] {
  return Array.from(container.querySelectorAll('canvas')).map(canvas => ({
    canvas,
    left: parseFloat(canvas.style.left) || 0,
    top: parseFloat(canvas.style.top) || 0,
  }));
}

export function svgToDataUrl(svgEl: SVGSVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // Text styling is inherited from the page CSS, which a standalone SVG
  // loses — inline the computed font so labels keep their face and size.
  if (typeof window !== 'undefined' && svgEl.isConnected) {
    const cs = window.getComputedStyle(svgEl);
    clone.style.fontFamily = cs.fontFamily;
    clone.style.fontSize = cs.fontSize;
  }
  const source = new XMLSerializer().serializeToString(clone);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
}

export interface LabelPlacement {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  font: string;
  color: string;
  background: string;
  borderRadius: number;
  paddingX: number;
  lineHeight: number;
}

// The diagonal column labels live in an HTML overlay, not the SVG, so the
// exporter re-draws them from measured DOM geometry and computed styles.
// Each label span carries data-column-label with the column name (the span's
// text content may include extra badges we don't want in the export).
export function collectLabelPlacements(
  headerContainer: HTMLElement,
  origin: { left: number; top: number },
  // Viewport rects are scaled by any active CSS transform (e.g. the fluid
  // zoom gesture); divide by domScale to get back to layout pixels.
  domScale = 1
): LabelPlacement[] {
  return Array.from(
    headerContainer.querySelectorAll<HTMLElement>('[data-column-label]')
  ).map(el => {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const parsedLineHeight = parseFloat(cs.lineHeight);
    // A unitless line-height computes to a multiplier in some engines.
    const lineHeight = Number.isNaN(parsedLineHeight)
      ? fontSize * 1.2
      : parsedLineHeight < fontSize
        ? parsedLineHeight * fontSize
        : parsedLineHeight;
    return {
      text: el.dataset.columnLabel || el.textContent || '',
      left: (rect.left - origin.left) / domScale,
      top: (rect.top - origin.top) / domScale,
      width: rect.width / domScale,
      height: rect.height / domScale,
      font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
      color: cs.color,
      background: cs.backgroundColor,
      borderRadius: parseFloat(cs.borderRadius) || 0,
      paddingX: parseFloat(cs.paddingLeft) || 0,
      lineHeight,
    };
  });
}

// Canvas has no text wrapping, so mirror the label's CSS `break-all`: break
// at any character once the line exceeds maxWidth.
export function wrapTextBreakAll(
  measure: (text: string) => number,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const ch of paragraph) {
      if (current !== '' && measure(current + ch) > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    lines.push(current);
  }
  return lines;
}

export function drawLabelPlacements(
  ctx: CanvasRenderingContext2D,
  placements: LabelPlacement[]
): void {
  for (const p of placements) {
    ctx.save();
    ctx.font = p.font;
    const maxWidth = Math.max(1, p.width - 2 * p.paddingX);
    const lines = wrapTextBreakAll(t => ctx.measureText(t).width, p.text, maxWidth);
    ctx.fillStyle = p.background;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(p.left, p.top, p.width, p.height, p.borderRadius);
    } else {
      ctx.rect(p.left, p.top, p.width, p.height);
    }
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = p.left + p.width / 2;
    const firstLineY = p.top + p.height / 2 - ((lines.length - 1) * p.lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, centerX, firstLineY + i * p.lineHeight);
    });
    ctx.restore();
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to rasterize the SVG layer.'));
    img.src = url;
  });
}

export async function renderMatrixToPngBlob(
  svgEl: SVGSVGElement,
  canvasContainer: HTMLElement,
  scale = 2,
  headerContainer?: HTMLElement | null
): Promise<Blob> {
  const width = Number(svgEl.getAttribute('width')) || svgEl.clientWidth;
  const height = Number(svgEl.getAttribute('height')) || svgEl.clientHeight;
  if (!width || !height) throw new Error('Matrix has no size to export.');

  const out = document.createElement('canvas');
  out.width = Math.round(width * scale);
  out.height = Math.round(height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not create an export canvas context.');

  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Match the live painting order: points, then the SVG overlay, then the
  // HTML column labels (positioned elements paint above the static SVG).
  for (const { canvas, left, top } of collectCanvasPlacements(canvasContainer)) {
    if (canvas.width === 0 || canvas.height === 0) continue;
    ctx.drawImage(canvas, left, top, canvas.width, canvas.height);
  }
  const svgImage = await loadImage(svgToDataUrl(svgEl));
  ctx.drawImage(svgImage, 0, 0, width, height);
  if (headerContainer) {
    const origin = svgEl.getBoundingClientRect();
    const domScale = origin.width / width || 1;
    drawLabelPlacements(ctx, collectLabelPlacements(headerContainer, origin, domScale));
  }

  return new Promise((resolve, reject) => {
    out.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
      'image/png'
    );
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
