// @ts-check
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
    site: 'https://products.ens-solutions.com',
    // Marketing pages are prerendered to static HTML, as before. The licensing
    // pages (/account, /admin, /api/licensing) opt out with
    // `export const prerender = false` and are served by the Node server this
    // adapter builds into dist/server/.
    adapter: node({ mode: 'standalone', bodySizeLimit: 256 * 1024 }),
    // Emit /products/certalert.html rather than /products/certalert/index.html,
    // so every URL the hand-written site had keeps working unchanged.
    build: { format: 'file' },
    // The container's render script (docker/docker-entrypoint.d/30-render-site.sh)
    // works line by line on the <!--DEMO:NAME--> markers, so the output must keep
    // its line breaks. The pages are small and nginx gzips them anyway.
    compressHTML: false,
    trailingSlash: 'never',
    security: {
        // Rejects cross-site form posts to the licensing pages.
        checkOrigin: true,
        // The licensing server only listens on the internal Docker network,
        // behind nginx, which sets X-Forwarded-Proto/Host/For. Trust them so
        // the origin check and client addresses see the browser's view.
        allowedDomains: [{}],
    },
});
