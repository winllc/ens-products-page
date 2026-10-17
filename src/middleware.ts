/*
 * Runs on the licensing pages only (prerendered marketing pages skip it):
 * loads the signed-in account from the session cookie, sets up the audit
 * context (client address, user agent, session) for the request, and adds
 * the headers account pages should always carry.
 *
 * The audit pull API (/api/audit) authenticates with a bearer token, not a
 * session, so no session is loaded for it.
 */

import { randomUUID } from 'node:crypto';
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
    const { sessionRef, withAuditContext } = await import('./server/audit');
    const { startAudit } = await import('./server/audit-outputs');
    // Normally already started with the server (audit-startup.ts); this covers `astro dev`.
    startAudit();

    const tokenApi = ctx.url.pathname === '/api/audit' || ctx.url.pathname.startsWith('/api/audit/');
    const token = tokenApi ? null : (ctx.cookies.get(SESSION_COOKIE)?.value ?? null);
    const id = sessionAccountId(token ?? undefined);
    const account = id ? accountById(id) : null;
    if (account && !account.disabled_at) {
        ctx.locals.account = account;
        ctx.locals.sessionToken = token;
    }

    let ip: string | null = null;
    try {
        ip = ctx.clientAddress ?? null;
    } catch {
        ip = null;
    }
    const auditCtx = {
        ip,
        userAgent: ctx.request.headers.get('user-agent'),
        requestId: randomUUID(),
        session: ctx.locals.account ? sessionRef(token) : null,
        account: ctx.locals.account,
    };

    const response = await withAuditContext(auditCtx, () => next());
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
