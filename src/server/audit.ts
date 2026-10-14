/*
 * Who did what to which license. Every change to an account or license goes
 * through a function that writes here, and customers see their own entries
 * on their account page.
 */

import { db, nowIso } from './db';

export type AuditAction =
    | 'account.created'
    | 'account.verified'
    | 'account.updated'
    | 'account.password-changed'
    | 'account.password-reset'
    | 'account.role-changed'
    | 'account.disabled'
    | 'account.enabled'
    | 'license.issued'
    | 'license.downloaded'
    | 'license.bound'
    | 'license.renamed'
    | 'license.renewed'
    | 'license.revoked'
    | 'license.reinstated';

export interface AuditEntry {
    id: number;
    at: string;
    actor_id: string | null;
    actor_email: string | null;
    account_id: string | null;
    license_id: string | null;
    action: AuditAction;
    detail: string;
}

export function audit(e: {
    actor: string | null;
    account?: string | null;
    license?: string | null;
    action: AuditAction;
    detail?: string;
}): void {
    db()
        .prepare('INSERT INTO audit_log (at, actor_id, account_id, license_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nowIso(), e.actor, e.account ?? null, e.license ?? null, e.action, e.detail ?? '');
}

export function auditFor(filter: { account?: string; license?: string }, limit = 50): AuditEntry[] {
    const where = filter.license ? 'l.license_id = ?' : filter.account ? 'l.account_id = ?' : '1 = 1';
    const args = filter.license ? [filter.license] : filter.account ? [filter.account] : [];
    return db()
        .prepare(
            `SELECT l.*, a.email AS actor_email FROM audit_log l LEFT JOIN accounts a ON a.id = l.actor_id
             WHERE ${where} ORDER BY l.id DESC LIMIT ?`,
        )
        .all(...args, limit) as unknown as AuditEntry[];
}
