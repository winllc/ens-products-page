import type { APIRoute } from 'astro';
import { products, type ProductId } from '../../data/products';
import { form, requireAccount, withNotice } from '../../server/http';
import { issueEvaluation, LicenseActionError } from '../../server/licenses';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const account = requireAccount(ctx);
    if (account instanceof Response) return account;
    const id = (await form(ctx))('product');
    if (!products.some((p) => p.id === id)) {
        return new Response('Unknown product', { status: 400 });
    }
    try {
        const license = issueEvaluation(account, id as ProductId);
        return ctx.redirect(withNotice(`/account/licenses/${license.id}`, 'evaluation-issued'), 303);
    } catch (err) {
        if (err instanceof LicenseActionError) {
            return new Response(err.message, { status: 409 });
        }
        throw err;
    }
};
