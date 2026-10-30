/*
 * The compliance documents' bytes, bundled into the server build: Vite reads
 * every file under compliance/ at build time and this module carries them,
 * so the licensing image needs no file access at run time and a document is
 * exactly what the repository held when the image was built.
 *
 * Keys are the paths Vite gives, "/compliance/<path>"; complianceSource()
 * looks one up by the manifest's path (relative to compliance/). The
 * rendered Markdown (Astro's Content components) is in compliance-render.ts,
 * which only pages import: that glob needs Astro's Markdown plugin, which
 * the unit tests don't run.
 */

const files = import.meta.glob('/compliance/**/*.{md,json,csv,txt}', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
>;

/** The raw text of a file under compliance/, by its path relative to that directory; undefined when the build has no such file. */
export function complianceSource(path: string): string | undefined {
    return files[`/compliance/${path}`];
}

/** Every bundled path, relative to compliance/. */
export function complianceSourcePaths(): string[] {
    return Object.keys(files).map((k) => k.replace(/^\/compliance\//, ''));
}
