/**
 * Minimal hand-rolled WebGL1 point-sprite renderer for the scatter matrix
 * (issue #33). No external dependencies (only the HIDDEN_SLOT sentinel
 * from colorUtils).
 *
 * Architecture — "render one cell, blit into its 2D canvas":
 *
 * - ONE shared WebGL context/canvas for the whole matrix (contexts are a
 *   scarce resource), sized to a single cell. Each cell render draws the
 *   points into it, and the caller `drawImage`s the result into the cell's
 *   existing Canvas 2D element. That keeps the entire downstream pipeline —
 *   reference-line overlays, the per-cell ImageData snapshot LRU, PNG
 *   export, the fluid-zoom CSS transform and DOM z-order — working
 *   verbatim, at the cost of one GPU→canvas blit per cell paint. (The
 *   alternative, a matrix-sized WebGL layer under the 2D canvases, would
 *   have required compositing changes in exportPng, a rethink of the
 *   snapshot LRU, and scissor bookkeeping; with per-cell blitting a
 *   matrix-sized canvas buys nothing, so the shared canvas is cell-sized.)
 *
 * - Positions are pre-transformed CPU-side into normalized [0, 1] "t"
 *   values per (column × scale-type × domain) and cached as GPU buffers.
 *   The vertex shader only lerps t into the cell's pixel range, so
 *   linear/log is NOT a shader path: log10 happens once per column when the
 *   domain or scale actually changes, not per point per frame. This also
 *   gives robust missing-value handling — NaN (and non-positive values
 *   under a log scale, which Canvas 2D silently dropped via NaN coords)
 *   become a sentinel t that the shader pushes outside the clip volume, so
 *   the point is culled. GLSL ES 1.0 has no isnan(), so the sentinel
 *   approach beats uploading raw values.
 *
 * - Per-point color comes from a small palette texture (≤ 65 texels: 10
 *   category colors or 64 rainbow buckets, + 1 missing-color texel) indexed
 *   by a per-point slot attribute derived from ColorState.slotById
 *   (Uint16 → Float32 attribute, same bucket rules as the 2D path).
 *
 * - Selection dimming uses a per-point flag attribute (the Uint8Array of
 *   selection flags already built per selection change for the columnar
 *   store). Two draw passes keep the 2D path's z-order: unselected
 *   (dimmed gray) beneath, selected on top; filter mode skips the first
 *   pass entirely.
 *
 * - Premultiplied-alpha blending (ONE, ONE_MINUS_SRC_ALPHA into a
 *   transparent buffer) so the blit composites exactly like source-over.
 *   Round points via gl_PointCoord distance with a 1px smoothstep edge to
 *   approximate Canvas 2D's antialiased arcs.
 */

import { HIDDEN_SLOT } from './colorUtils';

/** Sentinel t for missing values; the vertex shader culls anything ≤ -9. */
export const MISSING_T = -10;

/** Point radius in px — matches the Canvas 2D `arc(x, y, 2.5, …)` path. */
export const POINT_RADIUS = 2.5;
// Sprite quad size: diameter + 1px of antialiasing margin on each side.
const POINT_SPRITE_SIZE = POINT_RADIUS * 2 + 1;

// Cap on cached position/slot GPU buffers. Each is 4 bytes × rows; at 1M
// rows a full cache is ~24 × 4MB = 96MB GPU memory worst-case.
const BUFFER_CACHE_CAPACITY = 24;

const VERTEX_SHADER = `
attribute float aX;
attribute float aY;
attribute float aSlot;
attribute float aFlag;
uniform vec2 uXRange;      // pixel range for t=0..1 (pad/2 .. size-pad/2)
uniform vec2 uYRange;      // pixel range, y-down like canvas
uniform float uCanvasSize;
// mediump to match the fragment shader's default precision — a highp/mediump
// mismatch on a shared uniform is a LINK ERROR on some drivers (SwiftShader).
uniform mediump float uPointSize;
varying float vSlot;
varying float vFlag;
void main() {
  vSlot = aSlot;
  vFlag = aFlag;
  gl_PointSize = uPointSize;
  if (aX <= -9.0 || aY <= -9.0 || aSlot < -0.5) {
    // Missing value or hidden category (slot -1): outside the clip
    // volume -> the point is culled.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float px = mix(uXRange.x, uXRange.y, aX);
  float py = mix(uYRange.x, uYRange.y, aY);
  vec2 ndc = vec2(px, uCanvasSize - py) / uCanvasSize * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying float vSlot;
varying float vFlag;
uniform float uPass;        // 0: unselected only, 1: selected only, 2: all
uniform float uUseTexture;  // 1: palette texture by vSlot, 0: uColor.rgb
uniform vec4 uColor;        // straight (non-premultiplied) rgba
uniform sampler2D uPalette;
uniform float uPaletteSize;
uniform float uPointRadius;
uniform float uPointSize;
uniform float uSlotFilter;  // >= 0: draw only points of this slot (z-order passes)
void main() {
  if (uPass < 0.5 && vFlag > 0.5) discard;
  if (uPass > 0.5 && uPass < 1.5 && vFlag < 0.5) discard;
  if (uSlotFilter > -0.5 && abs(vSlot - uSlotFilter) > 0.25) discard;
  vec2 c = (gl_PointCoord - 0.5) * uPointSize;
  float dist = length(c);
  float mask = 1.0 - smoothstep(uPointRadius - 1.0, uPointRadius, dist);
  if (mask <= 0.004) discard;
  vec3 rgb = uColor.rgb;
  if (uUseTexture > 0.5) {
    rgb = texture2D(uPalette, vec2((vSlot + 0.5) / uPaletteSize, 0.5)).rgb;
  }
  float alpha = uColor.a * mask;
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;

// ---------------------------------------------------------------------------
// CPU-side helpers (shader-independent; unit-tested without a GL context)
// ---------------------------------------------------------------------------

/**
 * Normalize a column's values into [0, 1] against a domain, matching what
 * d3.scaleLinear / d3.scaleLog do before their range lerp. NaN — and, under
 * log, non-positive values (Canvas 2D dropped those via NaN screen coords) —
 * become MISSING_T so the shader culls them.
 */
export function buildNormalizedPositions(
  values: Float64Array,
  domainMin: number,
  domainMax: number,
  log: boolean
): Float32Array {
  const out = new Float32Array(values.length);
  if (log) {
    const logMin = Math.log10(domainMin);
    const span = Math.log10(domainMax) - logMin;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!(v > 0)) { // NaN and v <= 0
        out[i] = MISSING_T;
      } else {
        out[i] = span === 0 ? 0.5 : (Math.log10(v) - logMin) / span;
      }
    }
    return out;
  }
  const span = domainMax - domainMin;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== v) {
      out[i] = MISSING_T;
    } else {
      out[i] = span === 0 ? 0.5 : (v - domainMin) / span;
    }
  }
  return out;
}

/**
 * Per-point palette slot attribute from ColorState.slotById (indexed by
 * __id) via the store's rowIds. Bucket rules mirror the 2D paint loop:
 * MISSING_SLOT, out-of-palette and out-of-bounds ids all land in the last
 * texel (the missing color); HIDDEN_SLOT becomes -1, which the vertex
 * shader culls entirely.
 */
export function buildSlotAttribute(
  slotById: Uint16Array,
  rowIds: Int32Array,
  numSlots: number
): Float32Array {
  const out = new Float32Array(rowIds.length);
  for (let i = 0; i < rowIds.length; i++) {
    const slot = slotById[rowIds[i]]; // undefined when __id out of bounds
    out[i] = slot === HIDDEN_SLOT
      ? -1
      : slot === undefined || slot >= numSlots ? numSlots : slot;
  }
  return out;
}

/**
 * Palette texture pixels: one RGBA texel per slot color plus a final texel
 * for the missing color. Accepts #rgb/#rrggbb and rgb()/rgba() strings
 * (d3 interpolators return the latter).
 */
export function paletteToRgba(slotColors: string[], missingColor: string): Uint8Array {
  const colors = [...slotColors, missingColor];
  const out = new Uint8Array(colors.length * 4);
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = parseColor(colors[i]);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Parse '#rgb', '#rrggbb', 'rgb(r, g, b)' or 'rgba(r, g, b, a)' to [r, g, b]. */
export function parseColor(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return [0, 0, 0];
}

/**
 * Feature detection. Returns false where WebGL1 is unavailable — including
 * jsdom, whose canvas mock returns a context-like object for any type
 * string, hence the method probe rather than a simple truthiness check.
 */
export function isWebGLAvailable(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): boolean {
  try {
    const canvas = createCanvas();
    const gl =
      canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    return !!gl && typeof (gl as WebGLRenderingContext).createShader === 'function';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export interface BufferSource {
  /** Cache key; MUST change whenever the produced data would change. */
  key: string;
  /** Called only on cache miss. */
  build: () => Float32Array;
}

export interface CellRenderOptions {
  /** Number of points (rows) in the buffers. */
  count: number;
  /** Cell edge in px; the shared canvas is resized on change. */
  size: number;
  /** Pixel range for t=0..1 on x (padding/2 .. size - padding/2). */
  xRange: [number, number];
  /** Pixel range for t=0..1 on y (size - padding/2 .. padding/2). */
  yRange: [number, number];
  x: BufferSource;
  y: BufferSource;
  /** Per-point selection flags (1 = selected); null when nothing selected. */
  flags: { key: string; data: Uint8Array } | null;
  /** Per-point palette coloring; null for the classic flat colors. */
  color: {
    slots: BufferSource;
    /** RGBA texels incl. trailing missing-color texel (paletteToRgba). */
    paletteKey: string;
    palette: Uint8Array;
    /** Texel count == palette.length / 4. */
    paletteSize: number;
    /**
     * Category mode: draw one pass per slot, slot 0 first, so bigger
     * categories (lower slots by construction) sit beneath rarer ones —
     * matching the 2D path's batched-by-slot paint order. Off for rainbow
     * (64 passes for an order that follows the gradient anyway).
     */
    zOrderBySlot?: boolean;
  } | null;
  filterMode: 'highlight' | 'filter';
}

interface CachedBuffer {
  buffer: WebGLBuffer;
  lastUse: number;
}

/**
 * The shared point renderer. Create via WebGLPointRenderer.create(); a null
 * result means no usable WebGL — callers keep the Canvas 2D path.
 */
export class WebGLPointRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private attribs: { aX: number; aY: number; aSlot: number; aFlag: number };
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private positionBuffers = new Map<string, CachedBuffer>();
  private useTick = 0;
  private flagBuffer: WebGLBuffer | null = null;
  private flagKey = '';
  private paletteTexture: WebGLTexture | null = null;
  private paletteKey = '';
  private contextLost = false;
  private size = 0;

  static create(size: number): WebGLPointRenderer | null {
    try {
      const canvas = document.createElement('canvas');
      const attrs: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true,
        // The caller drawImage-blits right after the draw calls; preserve
        // the buffer so the blit can never race the compositor's clear.
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
      };
      const gl = (canvas.getContext('webgl', attrs) ??
        canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
      if (!gl || typeof gl.createShader !== 'function') return null;
      return new WebGLPointRenderer(canvas, gl, size);
    } catch (err) {
      console.info('[webglPoints] create failed:', err);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, size: number) {
    this.canvas = canvas;
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.contextLost = true;
    });

    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Flag shaders for deletion now that the program holds them; otherwise
    // they outlive deleteProgram() and leak across dispose/recreate cycles.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    gl.useProgram(program);

    this.attribs = {
      aX: gl.getAttribLocation(program, 'aX'),
      aY: gl.getAttribLocation(program, 'aY'),
      aSlot: gl.getAttribLocation(program, 'aSlot'),
      aFlag: gl.getAttribLocation(program, 'aFlag'),
    };
    this.uniforms = Object.fromEntries(
      [
        'uXRange', 'uYRange', 'uCanvasSize', 'uPointSize', 'uPass',
        'uUseTexture', 'uColor', 'uPalette', 'uPaletteSize', 'uPointRadius',
        'uSlotFilter',
      ].map(name => [name, gl.getUniformLocation(program, name)])
    );

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Premultiplied-alpha source-over, matching Canvas 2D compositing.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(this.uniforms.uPointSize, POINT_SPRITE_SIZE);
    gl.uniform1f(this.uniforms.uPointRadius, POINT_RADIUS);

    this.setSize(size);
  }

  get isContextLost(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  setSize(size: number): void {
    if (this.size === size) return;
    this.size = size;
    this.canvas.width = size;
    this.canvas.height = size;
    this.gl.viewport(0, 0, size, size);
    this.gl.uniform1f(this.uniforms.uCanvasSize, size);
  }

  /**
   * Draw one cell's points into the shared canvas. Returns false when the
   * context is unusable (caller should fall back to Canvas 2D).
   */
  renderCell(opts: CellRenderOptions): boolean {
    if (this.isContextLost) return false;
    const { gl } = this;
    this.setSize(opts.size);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (opts.count === 0) return true;

    gl.uniform2f(this.uniforms.uXRange, opts.xRange[0], opts.xRange[1]);
    gl.uniform2f(this.uniforms.uYRange, opts.yRange[0], opts.yRange[1]);

    this.bindPositionAttribute(this.attribs.aX, opts.x);
    this.bindPositionAttribute(this.attribs.aY, opts.y);

    // Selection flags: shared buffer, re-uploaded only when the key changes.
    if (opts.flags) {
      if (!this.flagBuffer) this.flagBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.flagBuffer);
      if (this.flagKey !== opts.flags.key) {
        gl.bufferData(gl.ARRAY_BUFFER, opts.flags.data, gl.STATIC_DRAW);
        this.flagKey = opts.flags.key;
      }
      gl.enableVertexAttribArray(this.attribs.aFlag);
      gl.vertexAttribPointer(this.attribs.aFlag, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(this.attribs.aFlag);
      gl.vertexAttrib1f(this.attribs.aFlag, 0);
    }

    // Palette coloring: slot attribute + palette texture.
    if (opts.color) {
      this.bindPositionAttribute(this.attribs.aSlot, opts.color.slots);
      this.uploadPalette(opts.color.paletteKey, opts.color.palette, opts.color.paletteSize);
      gl.uniform1f(this.uniforms.uPaletteSize, opts.color.paletteSize);
    } else {
      gl.disableVertexAttribArray(this.attribs.aSlot);
      gl.vertexAttrib1f(this.attribs.aSlot, 0);
    }

    const hasSelection = opts.flags !== null;
    if (!hasSelection) {
      // Single pass over every point (per-slot passes in category mode).
      if (opts.color) {
        this.drawColored(2, 0.7, opts);
      } else {
        this.draw(2, false, colorToVec4('#4b5563', 0.7), opts.count);
      }
      return true;
    }

    // Selection z-order matches the 2D path: dimmed unselected beneath
    // (highlight mode only), selected on top.
    if (opts.filterMode === 'highlight') {
      this.draw(0, false, colorToVec4('#ccc', 0.3), opts.count);
    }
    if (opts.color) {
      this.drawColored(1, 0.8, opts);
    } else {
      this.draw(1, false, colorToVec4('#1e40af', 0.8), opts.count);
    }
    return true;
  }

  /**
   * Textured (palette-colored) draw. With zOrderBySlot, one pass per
   * palette texel in ascending slot order — slots are count-ranked in
   * category mode, so the biggest categories are painted first and rare
   * ones land on top (the missing-color texel last, like the 2D path).
   */
  private drawColored(pass: number, alpha: number, opts: CellRenderOptions): void {
    const color = opts.color!;
    if (!color.zOrderBySlot) {
      this.draw(pass, true, [0, 0, 0, alpha], opts.count);
      return;
    }
    for (let slot = 0; slot < color.paletteSize; slot++) {
      this.draw(pass, true, [0, 0, 0, alpha], opts.count, slot);
    }
  }

  dispose(): void {
    const { gl } = this;
    this.positionBuffers.forEach(({ buffer }) => gl.deleteBuffer(buffer));
    this.positionBuffers.clear();
    if (this.flagBuffer) gl.deleteBuffer(this.flagBuffer);
    if (this.paletteTexture) gl.deleteTexture(this.paletteTexture);
    gl.deleteProgram(this.program);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }

  /** Cached position/slot buffer keys, oldest first (for tests). */
  cachedBufferKeys(): string[] {
    return Array.from(this.positionBuffers.keys());
  }

  private draw(
    pass: number,
    useTexture: boolean,
    rgba: [number, number, number, number],
    count: number,
    slotFilter: number = -1
  ): void {
    const { gl } = this;
    gl.uniform1f(this.uniforms.uPass, pass);
    gl.uniform1f(this.uniforms.uUseTexture, useTexture ? 1 : 0);
    gl.uniform1f(this.uniforms.uSlotFilter, slotFilter);
    gl.uniform4f(this.uniforms.uColor, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  private bindPositionAttribute(location: number, source: BufferSource): void {
    const { gl } = this;
    let cached = this.positionBuffers.get(source.key);
    if (!cached) {
      const buffer = gl.createBuffer();
      if (!buffer) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, source.build(), gl.STATIC_DRAW);
      // Stamp before evicting: with lastUse 0 a full cache would evict the
      // buffer just uploaded (it has the minimum tick), deleting it out from
      // under the draw call below and forcing a rebuild on every frame.
      cached = { buffer, lastUse: ++this.useTick };
      this.positionBuffers.set(source.key, cached);
      this.evictStaleBuffers();
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, cached.buffer);
      cached.lastUse = ++this.useTick;
    }
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0);
  }

  private evictStaleBuffers(): void {
    while (this.positionBuffers.size > BUFFER_CACHE_CAPACITY) {
      let oldestKey: string | null = null;
      let oldestUse = Infinity;
      this.positionBuffers.forEach((entry, key) => {
        if (entry.lastUse < oldestUse) {
          oldestUse = entry.lastUse;
          oldestKey = key;
        }
      });
      if (oldestKey === null) return;
      const evicted = this.positionBuffers.get(oldestKey)!;
      this.gl.deleteBuffer(evicted.buffer);
      this.positionBuffers.delete(oldestKey);
    }
  }

  private uploadPalette(key: string, palette: Uint8Array, texels: number): void {
    const { gl } = this;
    if (!this.paletteTexture) this.paletteTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    if (this.paletteKey !== key) {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, texels, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.paletteKey = key;
    }
    gl.uniform1i(this.uniforms.uPalette, 0);
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function colorToVec4(color: string, alpha: number): [number, number, number, number] {
  const [r, g, b] = parseColor(color);
  return [r / 255, g / 255, b / 255, alpha];
}
