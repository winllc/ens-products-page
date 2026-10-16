/*
 * Sign-in sessions. The cookie holds a random token; the database holds its
 * hash and an absolute expiry. Sessions don't slide: after SESSION_HOURS the
 * user signs in again.
 */

import { db, nowIso } from './db';
import { hashToken, newToken } from './secrets';

export const SESSION_COOKIE = 'ens_session';
export const SESSION_HOURS = 12;

export function createSession(accountId: string): { token: string; expires: Date } {
    const { token, hash } = newToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
    db()
        .prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(hash, accountId, nowIso(), expires.toISOString());
    return { token, expires };
}

/** The account id for a live session, or null. Expired sessions are cleared as they're found. */
export function sessionAccountId(token: string | undefined): string | null {
    if (!token) return null;
    const hash = hashToken(token);
    const row = db().prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash = ?').get(hash) as
        | { account_id: string; expires_at: string }
        | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
        db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
        return null;
    }
    return row.account_id;
}

export function destroySession(token: string | undefined): void {
    if (token) db().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Signs an account out everywhere, optionally keeping the session making the change. */
export function destroySessions(accountId: string, keepToken?: string): void {
    if (keepToken) {
        db().prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?').run(accountId, hashToken(keepToken));
    } else {
        db().prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
    }
}
