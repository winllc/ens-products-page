/*
 * GET /account/compliance/<artifact>/<file>: one file of the pack, served
 * from the bytes bundled into the build (or generated from the control
 * matrix and the manifest), as an attachment with the manifest's content
 * type.
 *
 * Signed out: to sign-in. Signed in without access: 403, recorded as
 * access.denied. Unknown artifact or file, or an artifact not yet published
 * for a customer: 404. More than COMPLIANCE_DOWNLOAD_LIMIT in an hour: 429.
 * Every download is compliance.downloaded.
 */

import type { APIRoute } from 'astro';
import { recordDenied } from '../../../../server/audit';
import {
    COMPLIANCE_DOWNLOAD_LIMIT,
    COMPLIANCE_DOWNLOAD_WINDOW_MINUTES,
    canRead,
    fileContent,
    findFile,
    recordDownload,
    visibleArtifact,
} from '../../../../server/compliance';
import { limited, requireAccount } from '../../../../server/http';

export const prerender = false;

const notFound = () => new Response('Not found', { status: 404 });

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

    const artifact = visibleArtifact(account, ctx.params.id ?? '');
    if (!artifact) return notFound();
    const file = findFile(artifact, ctx.params.file ?? '');
    if (!file) return notFound();

    const bytes = fileContent(file);
    if (!bytes) {
        console.error(`compliance: ${artifact.id}/${file.name} is in the manifest but not in this build`);
        return notFound();
    }

    recordDownload(account, artifact.id, file.name);
    return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
            'Content-Type': file.contentType,
            'Content-Length': String(bytes.length),
            'Content-Disposition': `attachment; filename="${file.name}"`,
            'Cache-Control': 'private, no-store',
        },
    });
};
