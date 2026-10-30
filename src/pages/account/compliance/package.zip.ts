/*
 * GET /account/compliance/package.zip: every file of every artifact the
 * account may see, each under its artifact's folder, with a README.txt
 * naming the versions and the date. Built in memory on each request (the
 * pack is small), served as an attachment, never cached.
 *
 * Same gates as a single file: sign-in, access (403 recorded), the hourly
 * limit; an account that may see nothing gets a 404.
 */

import type { APIRoute } from 'astro';
import { recordDenied } from '../../../server/audit';
import {
    COMPLIANCE_DOWNLOAD_LIMIT,
    COMPLIANCE_DOWNLOAD_WINDOW_MINUTES,
    PACKAGE_NAME,
    canRead,
    packageZip,
    recordDownload,
    visibleArtifacts,
} from '../../../server/compliance';
import { limited, requireAccount } from '../../../server/http';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
    const account = requireAccount(ctx);
    if (account instanceof Response) return account;

    if (limited(ctx, 'compliance-download', account.id, COMPLIANCE_DOWNLOAD_LIMIT, COMPLIANCE_DOWNLOAD_WINDOW_MINUTES)) {
        return new Response('Too many downloads. Try again in an hour.', { status: 429, headers: { 'Retry-After': '3600' } });
    }

    if (!canRead(account)) {
        recordDenied({ method: ctx.request.method, path: ctx.url.pathname, reason: 'compliance_not_granted' });
        return new Response('The compliance documentation pack is not enabled for this account', { status: 403 });
    }

    const artifacts = visibleArtifacts(account);
    if (!artifacts.length) return new Response('Not found', { status: 404 });

    const bytes = packageZip(artifacts);
    recordDownload(account, 'package', PACKAGE_NAME, { artifacts: artifacts.map((a) => a.id).join(' ') });
    return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(bytes.length),
            'Content-Disposition': `attachment; filename="ens-compliance-${PACKAGE_NAME}"`,
            'Cache-Control': 'private, no-store',
        },
    });
};
