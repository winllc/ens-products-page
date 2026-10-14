import type { APIRoute } from 'astro';
import { requireAccount } from '../../../../server/http';
import { downloadLicense, licenseFor } from '../../../../server/licenses';

export const prerender = false;

export const GET: APIRoute = (ctx) => {
    const account = requireAccount(ctx);
    if (account instanceof Response) return account;
    const license = licenseFor(account, ctx.params.id ?? '');
    if (!license) return new Response('Not found', { status: 404 });
    if (license.status === 'revoked') return new Response('This license is revoked', { status: 410 });

    const { filename, content } = downloadLicense(account, license);
    return new Response(content, {
        headers: {
            'Content-Type': 'application/x-ens-license; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    });
};
