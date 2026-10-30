/*
 * Helpers for the licensing pages: sessions in cookies, form fields, notices
 * carried across a redirect, and sign-in gates.
 */

import type { AstroGlobal, APIContext } from 'astro';
import { accountTarget, actorOf, record, recordDenied, recordLockout } from './audit';
import { config } from './config';
import { allow } from './rate-limit';
import { createSession, destroySession, SESSION_COOKIE, SESSION_HOURS } from './sessions';
import { isAdmin, type Account } from './accounts';

type Ctx = AstroGlobal | APIContext;

export function startSession(ctx: Ctx, accountId: string): void {
    const { token } = createSession(accountId);
    ctx.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: config().cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_HOURS * 60 * 60,
    });
}

export function endSession(ctx: Ctx): void {
    const account = ctx.locals.account;
    if (account) {
        record({ action: 'auth.logout', actor: actorOf(account), target: accountTarget(account), account: account.id });
    }
    destroySession(ctx.cookies.get(SESSION_COOKIE)?.value);
    ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function form(ctx: Ctx): Promise<(name: string) => string> {
    const data = await ctx.request.formData();
    return (name) => {
        const v = data.get(name);
        return typeof v === 'string' ? v : '';
    };
}

/** Where to go after signing in: a local path only, never another site. */
export function safeNext(raw: string | null | undefined, fallback = '/account'): string {
    return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : fallback;
}

/** Fixed messages shown after a redirect, by key, so nothing user-supplied is reflected. */
export const notices = {
    'signed-out': 'You are signed out.',
    'check-email': 'Check your email for a link to confirm your address.',
    verified: 'Your email address is confirmed. You can take licenses now.',
    'verified-sign-in': 'Your email address is confirmed. Sign in to take licenses.',
    'reset-sent': 'If that address has an account, we have emailed it a link to reset the password.',
    'password-reset': 'Your password is changed. Sign in with the new one.',
    'password-changed': 'Your password is changed, and every other session is signed out.',
    'profile-saved': 'Your details are saved. Licenses you take from now on use them.',
    'evaluation-issued': 'Your evaluation license is ready to download.',
    'evaluation-downloads': 'Your evaluation license is issued: its releases are below, and the license file is on the Licenses page.',
    'license-updated': 'The license is updated. Download the new file and install it in place of the old one.',
    'evaluation-extended': 'Your evaluation is extended. Download the new file and install it in place of the old one.',
    'lead-updated': 'The lead is updated.',
    'license-issued': 'The license is issued.',
    'license-revoked': 'The license is revoked.',
    'license-reinstated': 'The license is reinstated.',
    'account-updated': 'The account is updated.',
    'verification-sent': 'We have sent you another confirmation link.',
    'compliance-granted': 'The account can now read the compliance documentation pack.',
    'compliance-revoked': 'The account can no longer read the compliance documentation pack.',
    'compliance-published': 'The artifact is published: accounts with access can download it.',
    'compliance-unpublished': 'The artifact is unpublished: only administrators see it now.',
} as const;

export type NoticeKey = keyof typeof notices;

export function noticeFrom(url: URL): string | null {
    const key = url.searchParams.get('notice');
    return key && Object.prototype.hasOwnProperty.call(notices, key) ? notices[key as NoticeKey] : null;
}

export function withNotice(path: string, key: NoticeKey): string {
    return `${path}${path.includes('?') ? '&' : '?'}notice=${key}`;
}

/** Redirect to sign-in unless someone is signed in. */
export function requireAccount(ctx: Ctx): Account | Response {
    const account = ctx.locals.account;
    if (account) return account;
    const next = ctx.url.pathname + ctx.url.search;
    return ctx.redirect(`/account/login?next=${encodeURIComponent(next)}`, 303);
}

export function requireAdmin(ctx: Ctx): Account | Response {
    const account = requireAccount(ctx);
    if (account instanceof Response) return account;
    if (!isAdmin(account)) {
        recordDenied({ method: ctx.request.method, path: ctx.url.pathname, reason: 'admin_required' });
        return new Response('Administrators only', { status: 403 });
    }
    return account;
}

/**
 * Rate limit by client address and an extra key (the email being tried, say).
 * A hit is recorded as auth.lockout (collapsed, so a script hammering the
 * form makes a couple of events a minute, not one per try).
 */
export function limited(ctx: Ctx, bucket: string, extra: string, limit: number, minutes: number): boolean {
    const ip = ctx.clientAddress ?? 'unknown';
    const hit = !allow(`${bucket}:${ip}`, limit * 4, minutes * 60_000) || !allow(`${bucket}:${ip}:${extra}`, limit, minutes * 60_000);
    if (hit) {
        recordLockout({ bucket, attempted: extra || null, reason: `rate limited: more than ${limit} ${bucket} attempts in ${minutes} minutes` });
    }
    return hit;
}

export function dateOnly(iso: string | null): string {
    return iso ? iso.slice(0, 10) : '—';
}
