import type { Column, ScaleType, FilterMode, ColorMode } from '../../types';
import type { CorrelationKind } from './correlationUtils';
import type { FacetSelections } from './facetUtils';
import { getFacetValue } from './facetUtils';
import { clampCellSize } from './zoomUtils';
import type { DataPoint } from '../../types';

/**
 * Shareable view-state links (issue #43).
 *
 * The whole configurable view — data source URL, column order/visibility/
 * scales, color mode, facets, toggles — is serialized to a compact JSON
 * payload, base64url-encoded, and carried in the URL *fragment* as
 * `#view=<encoded>`. The fragment (rather than a query param) keeps the
 * state out of server logs and survives the GitHub Pages 404 redirect. A
 * full share link composes with the existing `?data=` query param:
 *
 *   https://host/path/?data=<csv-url>#view=<encoded>
 *
 * Wire schema (version 1) — short keys keep typical views well under 2KB:
 *
 *   v   1                       schema version (required)
 *   u   string                  data source URL (only when loaded via URL)
 *   c   [name, flags][]         columns in display order;
 *                               flags bit0 = visible, bit1 = log scale
 *   cf  string                  column name filter text
 *   fm  'h' | 'f'               filterMode highlight | filter
 *   h   0 | 1                   show histograms
 *   ub  0 | 1                   uniform log bins
 *   gl  0 | 1                   global log scale toggle
 *   cm  'n' | 'c' | 'r'         colorMode none | category | rainbow
 *   cc  string                  categoryColorColumn
 *   ro  string                  rainbowOrderColumn
 *   fs  { col: string[] }       facet selections (Map -> plain object)
 *   il  0 | 1                   show identity line
 *   rl  0 | 1                   show regression line
 *   sc  0 | 1                   show correlation values
 *   tb  0 | 1                   tint cell borders by correlation
 *   me  'p' | 's'               correlation metric pearson | spearman
 *   cs  number                  cell size (px; clamped to zoom bounds on parse)
 *   tv  0 | 1                   data table toggle
 *
 * Parsing is tolerant by design: `parseViewState` never throws; garbage or
 * an unknown version yields null, and unknown fields (or fields with the
 * wrong shape) are silently ignored so payloads from future versions that
 * merely ADD fields remain loadable.
 *
 * Deliberately NOT captured: the brush selection (transient screen-space
 * interaction) and PCA columns (derived data — the recipient can re-run
 * "Add PCA Columns"; a saved scale/visibility for PC1..PC3 simply finds no
 * matching column and is ignored).
 */

export const VIEW_STATE_VERSION = 1;

export interface ViewStateColumn {
  name: string;
  visible: boolean;
  scale: ScaleType;
}

/** Fully-named view state. Every field optional: absent = leave app default. */
export interface ViewState {
  dataUrl?: string;
  columns?: ViewStateColumn[];
  columnFilter?: string;
  filterMode?: FilterMode;
  showHistograms?: boolean;
  useUniformLogBins?: boolean;
  globalLogScale?: boolean;
  colorMode?: ColorMode;
  categoryColorColumn?: string;
  rainbowOrderColumn?: string;
  facetSelections?: Record<string, string[]>;
  showIdentityLine?: boolean;
  showRegressionLine?: boolean;
  showCorrelation?: boolean;
  tintCellBorders?: boolean;
  correlationMetric?: CorrelationKind;
  cellSize?: number;
  showDataTable?: boolean;
}

// ---------------------------------------------------------------------------
// base64url encoding (unicode-safe)

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// serialize

const COLUMN_VISIBLE_BIT = 1;
const COLUMN_LOG_BIT = 2;

/** Serialize a view state to its compact base64url wire form. */
export function serializeViewState(state: ViewState): string {
  const wire: Record<string, unknown> = { v: VIEW_STATE_VERSION };
  if (state.dataUrl) wire.u = state.dataUrl;
  if (state.columns && state.columns.length > 0) {
    wire.c = state.columns.map(col => [
      col.name,
      (col.visible ? COLUMN_VISIBLE_BIT : 0) | (col.scale === 'log' ? COLUMN_LOG_BIT : 0),
    ]);
  }
  if (state.columnFilter) wire.cf = state.columnFilter;
  if (state.filterMode !== undefined) wire.fm = state.filterMode === 'filter' ? 'f' : 'h';
  if (state.showHistograms !== undefined) wire.h = state.showHistograms ? 1 : 0;
  if (state.useUniformLogBins !== undefined) wire.ub = state.useUniformLogBins ? 1 : 0;
  if (state.globalLogScale !== undefined) wire.gl = state.globalLogScale ? 1 : 0;
  if (state.colorMode !== undefined) wire.cm = state.colorMode.charAt(0); // n | c | r
  if (state.categoryColorColumn) wire.cc = state.categoryColorColumn;
  if (state.rainbowOrderColumn) wire.ro = state.rainbowOrderColumn;
  if (state.facetSelections && Object.keys(state.facetSelections).length > 0) {
    wire.fs = state.facetSelections;
  }
  if (state.showIdentityLine !== undefined) wire.il = state.showIdentityLine ? 1 : 0;
  if (state.showRegressionLine !== undefined) wire.rl = state.showRegressionLine ? 1 : 0;
  if (state.showCorrelation !== undefined) wire.sc = state.showCorrelation ? 1 : 0;
  if (state.tintCellBorders !== undefined) wire.tb = state.tintCellBorders ? 1 : 0;
  if (state.correlationMetric !== undefined) {
    wire.me = state.correlationMetric === 'spearman' ? 's' : 'p';
  }
  if (state.cellSize !== undefined) wire.cs = state.cellSize;
  if (state.showDataTable !== undefined) wire.tv = state.showDataTable ? 1 : 0;
  return toBase64Url(JSON.stringify(wire));
}

// ---------------------------------------------------------------------------
// parse (never throws)

function asBool(value: unknown): boolean | undefined {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseColumns(value: unknown): ViewStateColumn[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const columns: ViewStateColumn[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const flags = typeof entry[1] === 'number' ? entry[1] : COLUMN_VISIBLE_BIT;
    columns.push({
      name: entry[0],
      visible: (flags & COLUMN_VISIBLE_BIT) !== 0,
      scale: (flags & COLUMN_LOG_BIT) !== 0 ? 'log' : 'linear',
    });
  }
  return columns.length > 0 ? columns : undefined;
}

function parseFacets(value: unknown): Record<string, string[]> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const facets: Record<string, string[]> = {};
  for (const [column, values] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue;
    const strings = values.filter((v): v is string => typeof v === 'string');
    if (strings.length > 0) facets[column] = strings;
  }
  return Object.keys(facets).length > 0 ? facets : undefined;
}

/**
 * Parse the base64url wire form back into a ViewState. Returns null for
 * anything unusable (bad base64, non-JSON, non-object, unknown version).
 * Individual fields with unexpected shapes — and any unknown fields — are
 * ignored, so future additive schema versions stay loadable.
 */
export function parseViewState(encoded: string): ViewState | null {
  if (!encoded) return null;
  const json = fromBase64Url(encoded);
  if (json === null) return null;
  let wire: unknown;
  try {
    wire = JSON.parse(json);
  } catch {
    return null;
  }
  if (wire === null || typeof wire !== 'object' || Array.isArray(wire)) return null;
  const w = wire as Record<string, unknown>;
  if (w.v !== VIEW_STATE_VERSION) return null;

  const state: ViewState = {};
  const dataUrl = asString(w.u);
  if (dataUrl !== undefined) state.dataUrl = dataUrl;
  const columns = parseColumns(w.c);
  if (columns !== undefined) state.columns = columns;
  const columnFilter = asString(w.cf);
  if (columnFilter !== undefined) state.columnFilter = columnFilter;
  if (w.fm === 'h') state.filterMode = 'highlight';
  else if (w.fm === 'f') state.filterMode = 'filter';
  const h = asBool(w.h);
  if (h !== undefined) state.showHistograms = h;
  const ub = asBool(w.ub);
  if (ub !== undefined) state.useUniformLogBins = ub;
  const gl = asBool(w.gl);
  if (gl !== undefined) state.globalLogScale = gl;
  if (w.cm === 'n') state.colorMode = 'none';
  else if (w.cm === 'c') state.colorMode = 'category';
  else if (w.cm === 'r') state.colorMode = 'rainbow';
  const cc = asString(w.cc);
  if (cc !== undefined) state.categoryColorColumn = cc;
  const ro = asString(w.ro);
  if (ro !== undefined) state.rainbowOrderColumn = ro;
  const fs = parseFacets(w.fs);
  if (fs !== undefined) state.facetSelections = fs;
  const il = asBool(w.il);
  if (il !== undefined) state.showIdentityLine = il;
  const rl = asBool(w.rl);
  if (rl !== undefined) state.showRegressionLine = rl;
  const sc = asBool(w.sc);
  if (sc !== undefined) state.showCorrelation = sc;
  const tb = asBool(w.tb);
  if (tb !== undefined) state.tintCellBorders = tb;
  if (w.me === 'p') state.correlationMetric = 'pearson';
  else if (w.me === 's') state.correlationMetric = 'spearman';
  // Clamp to the app's committed zoom bounds: a crafted/corrupt payload with
  // a huge cs would otherwise size every canvas in the matrix off it and can
  // hang the tab.
  if (typeof w.cs === 'number' && Number.isFinite(w.cs) && w.cs > 0) {
    state.cellSize = clampCellSize(w.cs);
  }
  const tv = asBool(w.tv);
  if (tv !== undefined) state.showDataTable = tv;
  return state;
}

// ---------------------------------------------------------------------------
// URL composition / extraction

/**
 * Extract the encoded `view` value from a location hash (e.g.
 * `window.location.hash`). Accepts `#view=...` and `#a=b&view=...` forms.
 */
export function getViewParamFromHash(hash: string): string | null {
  if (!hash) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const value = params.get('view');
  return value && value.length > 0 ? value : null;
}

/**
 * Build a full share link. `baseUrl` is origin + pathname (no query/hash).
 * The data URL — when the current dataset came from a URL — travels in the
 * `?data=` query param (matching the existing load-from-URL entry point);
 * everything else travels in the `#view=` fragment.
 */
export function buildShareLink(baseUrl: string, state: ViewState): string {
  const query = state.dataUrl ? `?data=${encodeURIComponent(state.dataUrl)}` : '';
  return `${baseUrl}${query}#view=${serializeViewState(state)}`;
}

// ---------------------------------------------------------------------------
// Applying a parsed view to a freshly loaded dataset (pure helpers)

/**
 * Apply a view's column list (by NAME) to freshly detected columns.
 *
 * - Saved names that exist take the saved order/visibility/scale.
 * - Saved names with no matching detected column are ignored.
 * - Detected columns not named in the view are appended after the saved
 *   ones, visible, in their natural (detected) order.
 * - Without a usable view column list, the detected columns pass through.
 */
export function applyViewToColumns(
  detected: Column[],
  viewColumns: ViewStateColumn[] | undefined
): Column[] {
  if (!viewColumns || viewColumns.length === 0) return detected;
  // Spread the DETECTED column and override only what the view carries, so
  // any future Column fields survive having a saved view applied.
  const detectedByName = new Map(detected.map(col => [col.name, col]));
  const applied = new Set<string>();
  const result: Column[] = [];
  for (const vc of viewColumns) {
    const original = detectedByName.get(vc.name);
    if (!original || applied.has(vc.name)) continue;
    applied.add(vc.name);
    result.push({ ...original, visible: vc.visible, scale: vc.scale });
  }
  if (result.length === 0) return detected; // nothing matched: keep defaults
  for (const col of detected) {
    if (!applied.has(col.name)) result.push({ ...col, visible: true });
  }
  return result;
}

/** FacetSelections Map -> plain-object wire form. */
export function facetSelectionsToRecord(facets: FacetSelections): Record<string, string[]> {
  const record: Record<string, string[]> = {};
  for (const [column, values] of facets) {
    if (values.size > 0) record[column] = [...values];
  }
  return record;
}

/**
 * Wire-form facets -> FacetSelections Map, validated against the loaded
 * dataset: columns must be current string columns and each value must
 * actually occur in that column (missing-sentinel included via
 * getFacetValue). Vanished columns/values are dropped; a column whose
 * selected values all vanished places no facet at all.
 */
export function sanitizeFacetSelections(
  record: Record<string, string[]> | undefined,
  data: DataPoint[],
  stringColumns: string[]
): FacetSelections {
  const facets: FacetSelections = new Map();
  if (!record) return facets;
  const stringColumnSet = new Set(stringColumns);
  for (const [column, values] of Object.entries(record)) {
    // The isArray check is belt-and-braces for callers that pass wire-form
    // data that didn't come through parseViewState (which already filters
    // non-array values).
    if (!stringColumnSet.has(column) || !Array.isArray(values)) continue;
    const existing = new Set<string>();
    for (const row of data) existing.add(getFacetValue(row, column));
    const kept = new Set(values.filter(value => existing.has(value)));
    if (kept.size > 0) facets.set(column, kept);
  }
  return facets;
}
