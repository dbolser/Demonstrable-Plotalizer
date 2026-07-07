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

/** Abort a URL data fetch if the server hasn't responded within this window. */
export const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch CSV/TSV text from a remote URL.
 *
 * Throws an Error with a user-presentable message on: invalid URL, network /
 * CORS failure, timeout, non-2xx response, empty body, or a response that
 * looks like HTML (e.g. a GitHub page linked instead of its raw file), based
 * on the Content-Type header or the body itself.
 */
export async function fetchCsvFromUrl(url: string): Promise<string> {
    if (!isValidDataUrl(url)) {
        throw new Error(`"${url}" is not a valid http(s) URL.`);
    }

    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        response = await fetch(url, { signal: controller.signal });
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new Error(`Timed out waiting for "${url}" to respond.`);
        }
        throw new Error(
            `Could not fetch "${url}". The server may be unreachable or may not allow cross-origin (CORS) requests.`
        );
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        throw new Error(`Failed to load "${url}": ${response.status} ${response.statusText}`.trim());
    }

    const htmlError = new Error(
        `"${url}" returned an HTML page, not CSV/TSV data. If this is a GitHub link, use the "Raw" file URL.`
    );

    // Reject HTML by Content-Type before downloading the body (catches error
    // pages that the body heuristic below would miss).
    const contentType = response.headers?.get('content-type');
    if (contentType && contentType.toLowerCase().includes('text/html')) {
        throw htmlError;
    }

    const text = await response.text();
    if (!/\S/.test(text)) {
        throw new Error(`"${url}" returned an empty response.`);
    }
    if (looksLikeHtml(text)) {
        throw htmlError;
    }

    return text;
}
