/*
 * Runs on the licensing pages only (prerendered marketing pages skip it):
 * loads the signed-in account from the session cookie and adds the headers
 * account pages should always carry.
 */

import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (ctx, next) => {
    ctx.locals.account = null;
    ctx.locals.sessionToken = null;
    if (ctx.isPrerendered) {
        return next();
    }

    // Imported lazily so the static build never opens the database.
    const { accountById } = await import('./server/accounts');
    const { SESSION_COOKIE, sessionAccountId } = await import('./server/sessions');

    const token = ctx.cookies.get(SESSION_COOKIE)?.value ?? null;
    const id = sessionAccountId(token ?? undefined);
    const account = id ? accountById(id) : null;
    if (account && !account.disabled_at) {
        ctx.locals.account = account;
        ctx.locals.sessionToken = token;
    }

    const response = await next();
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
    return response;
});
