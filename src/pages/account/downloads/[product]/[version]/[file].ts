/*
 * GET /account/downloads/<product>/<version>/<file>: a 302 to a short-lived
 * presigned S3 URL for one release file. The portal never streams the bytes.
 *
 * Entitlement is checked on every request, not only when the page is drawn.
 * Anything that isn't a known product, a version name, a plain file name
 * that is in that version's listing, is a 404; signed in without a license
 * for the product is a 403, recorded as access.denied like every other.
 */

import type { APIRoute } from 'astro';
import { products, type ProductId } from '../../../../../data/products';
import { recordDenied } from '../../../../../server/audit';
import { requireAccount } from '../../../../../server/http';
import { canDownload } from '../../../../../server/licenses';
import { downloadLimited, findFile, presignedUrl, recordDownload, releasesEnabled } from '../../../../../server/releases';
import { isFileName, isVersion } from '../../../../../lib/releases';

export const prerender = false;

const notFound = () => new Response('Not found', { status: 404 });

export const GET: APIRoute = async (ctx) => {
    const account = requireAccount(ctx);
    if (account instanceof Response) return account;

    const product = products.find((p) => p.id === ctx.params.product)?.id as ProductId | undefined;
    if (!product) return notFound();

    if (downloadLimited(account)) {
        return new Response('Too many downloads. Try again in an hour.', { status: 429, headers: { 'Retry-After': '3600' } });
    }

    if (!canDownload(account, product)) {
        recordDenied({ method: ctx.request.method, path: ctx.url.pathname, reason: 'release_not_entitled' });
        return new Response('You need a license for this product to download its releases', { status: 403 });
    }

    const version = ctx.params.version ?? '';
    const file = ctx.params.file ?? '';
    if (!releasesEnabled() || !isVersion(version) || !isFileName(file)) return notFound();

    let url: string;
    try {
        if (!(await findFile(product, version, file))) return notFound();
        url = await presignedUrl(product, version, file);
    } catch (err) {
        console.error(`releases: ${product} ${version} ${file}: ${(err as Error).message}`);
        return new Response('Downloads are unavailable right now. Try again in a few minutes.', { status: 503 });
    }

    recordDownload(account, product, version, file);
    return new Response(null, { status: 302, headers: { Location: url } });
};
