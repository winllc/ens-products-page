/*
 * The compliance documents rendered: Astro's Markdown modules for every
 * .md under compliance/, each with a Content component and its front
 * matter. Only pages import this: the glob needs Astro's Markdown plugin,
 * which the unit tests (plain Vite) do not run, so the access model in
 * compliance.ts never touches it.
 */

import type { MarkdownInstance } from 'astro';

const rendered = import.meta.glob('/compliance/**/*.md', { eager: true }) as Record<string, MarkdownInstance<Record<string, unknown>>>;

/** The rendered document for a path under compliance/, or undefined when the build has no such file. */
export function complianceDocument(path: string): MarkdownInstance<Record<string, unknown>> | undefined {
    return rendered[`/compliance/${path}`];
}
