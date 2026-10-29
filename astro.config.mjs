// @ts-check
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

/**
 * Starts the audit trail's outputs (and records system.started) when the
 * built server starts, by importing src/server/audit-startup.ts from the
 * Node adapter's server entry. Build only: `astro dev` starts them from the
 * middleware on the first request instead.
 */
/** @returns {import('astro').AstroIntegration} */
function auditStartup() {
    const startup = fileURLToPath(new URL('./src/server/audit-startup.ts', import.meta.url));
    return {
        name: 'ens-audit-startup',
        hooks: {
            'astro:config:setup': ({ command, updateConfig }) => {
                if (command !== 'build') return;
                updateConfig({
                    vite: {
                        plugins: [
                            {
                                name: 'ens-audit-startup',
                                enforce: 'post',
                                /** @param {string} code @param {string} id */
                                transform(code, id) {
                                    if (/@astrojs[\\/]node[\\/]dist[\\/]server\.js$/.test(id)) {
                                        return { code: `import ${JSON.stringify(startup)};\n${code}`, map: null };
                                    }
                                    return null;
                                },
                            },
                        ],
                    },
                });
            },
        },
    };
}

export default defineConfig({
    site: 'https://products.ens-solutions.com',
    // Marketing pages are prerendered to static HTML, as before. The licensing
    // pages (/account, /admin, /api/licensing) opt out with
    // `export const prerender = false` and are served by the Node server this
    // adapter builds into dist/server/.
    adapter: node({ mode: 'standalone', bodySizeLimit: 256 * 1024 }),
    integrations: [
        auditStartup(),
        // /sitemap-index.xml and /sitemap-0.xml, for the marketing pages only:
        // the licensing pages are behind a sign-in (robots.txt keeps crawlers
        // out of them too), and the 404 and "licensing unavailable" pages are
        // not destinations. Astro lists a page as /pricing; the file is
        // /pricing.html (build.format 'file'), which is what the page's
        // canonical link says, so the extension is put back.
        sitemap({
            filter: (page) => !/\/(account|admin|api|404|licensing-unavailable)(\/|$)/.test(page),
            serialize: (item) => (item.url.endsWith('/') ? item : { ...item, url: `${item.url}.html` }),
        }),
    ],
    // Emit /products/certalert.html rather than /products/certalert/index.html,
    // so every URL the hand-written site had keeps working unchanged.
    build: { format: 'file' },
    // The container's render script (docker/docker-entrypoint.d/30-render-site.sh)
    // works line by line on the <!--DEMO:NAME--> markers, so the output must keep
    // its line breaks. The pages are small and nginx gzips them anyway.
    compressHTML: false,
    trailingSlash: 'never',
    vite: {
        // Never inline a page's scripts or styles into the HTML, however small:
        // nginx sends the static pages with a Content-Security-Policy of
        // script-src 'self' and style-src 'self' (nginx/default.conf.template),
        // which an inline <script> or <style> would fall foul of. Everything
        // goes to /_astro/ as a hashed file instead.
        build: { assetsInlineLimit: 0 },
    },
    security: {
        // Rejects cross-site form posts to the licensing pages.
        checkOrigin: true,
        // The licensing server only listens on the internal Docker network,
        // behind nginx, which sets X-Forwarded-Proto/Host/For. Trust them so
        // the origin check and client addresses see the browser's view.
        allowedDomains: [{}],
    },
});
