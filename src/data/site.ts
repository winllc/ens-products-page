/*
 * Site-wide links that are not products.
 *
 * The documentation site defaults to the published one. A deployment that
 * mirrors it (an air-gapped network, say) sets DOCS_URL: the licensing pages
 * read it when they render, and the web container's render script swaps the
 * default for it in the prerendered pages at start, the same way it fills in
 * the demo URLs.
 */

export const DEFAULT_DOCS_URL = 'https://winllc.github.io/ens-apps-documentation';

/** The documentation site, or a page on it: docsUrl('cert-alert/install/'). */
export function docsUrl(path = ''): string {
    const configured = typeof process !== 'undefined' ? process.env.DOCS_URL?.trim() : undefined;
    const base = (configured || DEFAULT_DOCS_URL).replace(/\/+$/, '');
    return `${base}/${path.replace(/^\/+/, '')}`;
}
