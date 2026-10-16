import type { APIRoute } from 'astro';
import { endSession, withNotice } from '../../server/http';

export const prerender = false;

export const POST: APIRoute = (ctx) => {
    endSession(ctx);
    return ctx.redirect(withNotice('/account/login', 'signed-out'), 303);
};
