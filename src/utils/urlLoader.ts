/**
 * Utilities for loading CSV/TSV data from a remote URL (issue #42).
 *
 * The fetched text is fed through the same PapaParse configuration as file
 * uploads (header + dynamicTyping, delimiter auto-detect), so .csv and .tsv
 * both work without any special handling here.
 */

/** True if the string is a well-formed http(s) URL. */
export function isValidDataUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Extract the `data` query parameter from a search string (e.g.
 * `window.location.search`). Returns the trimmed value, or null when the
 * parameter is absent or empty. Validation happens in fetchCsvFromUrl so an
 * invalid value can still surface a visible error to the user.
 */
export function getDataUrlFromQuery(search: string): string | null {
    const params = new URLSearchParams(search);
    const value = params.get('data');
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Heuristic: does the response body look like an HTML page rather than CSV/TSV? */
export function looksLikeHtml(text: string): boolean {
    const head = text.slice(0, 500).trimStart().toLowerCase();
    return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body');
}

/**
 * Fetch CSV/TSV text from a remote URL.
 *
 * Throws an Error with a user-presentable message on: invalid URL, network /
 * CORS failure, non-2xx response, empty body, or a body that looks like HTML
 * (e.g. a GitHub page linked instead of its raw file).
 */
export async function fetchCsvFromUrl(url: string): Promise<string> {
    if (!isValidDataUrl(url)) {
        throw new Error(`"${url}" is not a valid http(s) URL.`);
    }

    let response: Response;
    try {
        response = await fetch(url);
    } catch {
        throw new Error(
            `Could not fetch "${url}". The server may be unreachable or may not allow cross-origin (CORS) requests.`
        );
    }

    if (!response.ok) {
        throw new Error(`Failed to load "${url}": ${response.status} ${response.statusText}`.trim());
    }

    const text = await response.text();
    if (text.trim().length === 0) {
        throw new Error(`"${url}" returned an empty response.`);
    }
    if (looksLikeHtml(text)) {
        throw new Error(
            `"${url}" returned an HTML page, not CSV/TSV data. If this is a GitHub link, use the "Raw" file URL.`
        );
    }

    return text;
}
