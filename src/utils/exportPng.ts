// PNG export for the scatter-plot matrix. The points are painted on Canvas
// layers (for performance), while the SVG holds axes, labels, histograms and
// overlays — so serializing the SVG alone exports a plot with no points.
// Instead we composite: white background → cell canvases → SVG, at an
// upscaled resolution, and hand back a PNG blob.

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
  scale = 2
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

  // Points first (they sit under the SVG in the DOM), then the SVG overlay.
  for (const { canvas, left, top } of collectCanvasPlacements(canvasContainer)) {
    if (canvas.width === 0 || canvas.height === 0) continue;
    ctx.drawImage(canvas, left, top, canvas.width, canvas.height);
  }
  const svgImage = await loadImage(svgToDataUrl(svgEl));
  ctx.drawImage(svgImage, 0, 0, width, height);

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
