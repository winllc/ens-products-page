// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
    site: 'https://products.ens-solutions.com',
    // Emit /products/certalert.html rather than /products/certalert/index.html,
    // so every URL the hand-written site had keeps working unchanged.
    build: { format: 'file' },
    // The container's render script (docker/docker-entrypoint.d/30-render-site.sh)
    // works line by line on the <!--DEMO:NAME--> markers, so the output must keep
    // its line breaks. The pages are small and nginx gzips them anyway.
    compressHTML: false,
    trailingSlash: 'never',
});
