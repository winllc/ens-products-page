/*
 * Customer and administrator accounts.
 *
 * Anyone can sign up; an account can't hold a license until its email
 * address is verified. Sign-up, sign-in and reset requests answer the same
 * way whether or not the address has an account, so the forms can't be used
 * to find out who is a customer.
 *
 * Administrators are accounts with role "admin", plus any verified account
 * whose address is in ADMIN_EMAILS (which is how the first one is made).
 */

import { accountTarget, actorOf, anonymous, audit, record } from './audit';
import { config } from './config';
import { db, nowIso, transaction } from './db';
import { sendMail } from './mail';
import {
    PASSWORD_MAX,
    PASSWORD_MIN,
    checkPassword,
    dummyHash,
    hashPassword,
    hashToken,
    newId,
    newToken,
} from './secrets';
import { destroySessions } from './sessions';

export interface Account {
    id: string;
    email: string;
    name: string;
    organization: string;
    phone: string;
    role: 'customer' | 'admin';
    email_verified_at: string | null;
    disabled_at: string | null;
    created_at: string;
    last_login_at: string | null;
    /** When an administrator granted the account the compliance documentation pack; null until then. */
    compliance_access_at: string | null;
    /** The account id of the administrator who granted it. */
    compliance_access_by: string | null;
}

interface AccountRow extends Account {
    password_hash: string;
}

const COLUMNS =
    'id, email, name, organization, phone, role, email_verified_at, disabled_at, created_at, last_login_at, compliance_access_at, compliance_access_by';
const HOUR = 60 * 60 * 1000;
const VERIFY_TTL = 48 * HOUR;
const RESET_TTL = 1 * HOUR;

export class AccountError extends Error {
    constructor(
        message: string,
        readonly field?: string,
    ) {
        super(message);
        this.name = 'AccountError';
    }
}

export function isAdmin(a: Account | null | undefined): boolean {
    if (!a || a.disabled_at) return false;
    return a.role === 'admin' || (a.email_verified_at !== null && config().adminEmails.has(a.email));
}

export function normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
}

function checkEmail(email: string): void {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AccountError('Enter a valid email address', 'email');
    }
}

export function checkNewPassword(password: string, email = ''): void {
    if (password.length < PASSWORD_MIN) {
        throw new AccountError(`Use at least ${PASSWORD_MIN} characters`, 'password');
    }
    if (password.length > PASSWORD_MAX) {
        throw new AccountError(`Use at most ${PASSWORD_MAX} characters`, 'password');
    }
    if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) {
        throw new AccountError('Don’t use your email name in your password', 'password');
    }
}

function text(raw: string | undefined, max: number, field: string, required = false): string {
    const v = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (required && !v) throw new AccountError('Required', field);
    if (v.length > max) throw new AccountError(`At most ${max} characters`, field);
    return v;
}

export function accountById(id: string): Account | null {
    return (db().prepare(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`).get(id) as Account | undefined) ?? null;
}

export function accountByEmail(email: string): Account | null {
    return (
        (db().prepare(`SELECT ${COLUMNS} FROM accounts WHERE email = ?`).get(normalizeEmail(email)) as Account | undefined) ??
        null
    );
}

function link(path: string, token: string): string {
    return `${config().publicUrl}${path}?token=${encodeURIComponent(token)}`;
}

async function sendVerification(account: Account): Promise<void> {
    const { token, hash } = newToken();
    const now = Date.now();
    db()
        .prepare('INSERT INTO tokens (token_hash, account_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(hash, account.id, 'verify-email', new Date(now).toISOString(), new Date(now + VERIFY_TTL).toISOString());
    await sendMail({
        to: account.email,
        subject: 'Confirm your ENS Solutions licensing account',
        text:
            `Hello ${account.name},\n\n` +
            `Confirm your email address to finish setting up your account:\n\n${link('/account/verify', token)}\n\n` +
            `The link works for 48 hours. If you didn't sign up, ignore this message.\n\nENS Solutions licensing`,
    });
}

export interface SignUp {
    email: string;
    password: string;
    name: string;
    organization?: string;
    phone?: string;
}

/** Creates the account and emails a verification link. Returns null when the address was already taken. */
export async function signUp(input: SignUp): Promise<Account | null> {
    const email = normalizeEmail(input.email);
    checkEmail(email);
    const name = text(input.name, 120, 'name', true);
    const organization = text(input.organization, 160, 'organization');
    const phone = text(input.phone, 40, 'phone');
    checkNewPassword(input.password, email);

    const existing = accountByEmail(email);
    if (existing) {
        await sendMail({
            to: email,
            subject: 'Your ENS Solutions licensing account',
            text:
                `Someone tried to sign up with this address, which already has an account.\n\n` +
                `Sign in: ${config().publicUrl}/account/login\n` +
                `Forgot your password? ${config().publicUrl}/account/forgot\n\nENS Solutions licensing`,
        });
        return null;
    }

    const passwordHash = await hashPassword(input.password);
    const account: Account = {
        id: newId('acct'),
        email,
        name,
        organization,
        phone,
        role: 'customer',
        email_verified_at: null,
        disabled_at: null,
        created_at: nowIso(),
        last_login_at: null,
        compliance_access_at: null,
        compliance_access_by: null,
    };
    transaction(() => {
        db()
            .prepare(
                'INSERT INTO accounts (id, email, password_hash, name, organization, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(account.id, email, passwordHash, name, organization, phone, 'customer', account.created_at);
        audit({ actor: account.id, account: account.id, action: 'account.created', details: { name, organization } });
    });
    await sendVerification(account);
    return account;
}

export async function resendVerification(account: Account): Promise<void> {
    if (!account.email_verified_at) {
        await sendVerification(account);
    }
}

function consumeToken(token: string, purpose: 'verify-email' | 'reset-password'): string | null {
    const row = db()
        .prepare('SELECT account_id, expires_at, used_at FROM tokens WHERE token_hash = ? AND purpose = ?')
        .get(hashToken(token), purpose) as { account_id: string; expires_at: string; used_at: string | null } | undefined;
    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
        return null;
    }
    db().prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').run(nowIso(), hashToken(token));
    return row.account_id;
}

export function verifyEmail(token: string): Account | null {
    const account = transaction(() => {
        const id = consumeToken(token, 'verify-email');
        if (!id) return null;
        db().prepare('UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(nowIso(), id);
        audit({ actor: id, account: id, action: 'account.verified' });
        return accountById(id);
    });
    if (!account) {
        record({ action: 'account.verified', outcome: 'failure', actor: anonymous(null), reason: 'invalid, used or expired link' });
    }
    return account;
}

/**
 * The account for these credentials, or null. Same timing either way.
 * Records auth.login, success or failure; on failure the address tried is
 * the actor, and the reason says why (for administrators only).
 */
export async function authenticate(email: string, password: string): Promise<Account | null> {
    const tried = normalizeEmail(email);
    const row = db()
        .prepare(`SELECT ${COLUMNS}, password_hash FROM accounts WHERE email = ?`)
        .get(tried) as AccountRow | undefined;
    const ok = await checkPassword(password, row?.password_hash ?? (await dummyHash()));
    if (!row || !ok || row.disabled_at) {
        const reason = !row ? 'unknown account' : !ok ? 'bad credentials' : 'account disabled';
        record({
            action: 'auth.login',
            outcome: 'failure',
            actor: anonymous(tried),
            target: row ? accountTarget(row) : null,
            account: row?.id ?? null,
            reason,
            details: { method: 'password' },
        });
        return null;
    }
    const { password_hash: _, ...account } = row;
    transaction(() => {
        db().prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
        record({
            action: 'auth.login',
            actor: actorOf(account),
            target: accountTarget(account),
            account: account.id,
            details: { method: 'password' },
        });
    });
    return account;
}

export async function requestPasswordReset(email: string): Promise<void> {
    const account = accountByEmail(email);
    if (!account || account.disabled_at) {
        record({
            action: 'account.password-reset-requested',
            outcome: 'failure',
            actor: anonymous(email),
            target: account ? accountTarget(account) : null,
            reason: account ? 'account disabled' : 'unknown account',
        });
        return;
    }
    record({ action: 'account.password-reset-requested', actor: anonymous(email), target: accountTarget(account), account: account.id });
    const { token, hash } = newToken();
    const now = Date.now();
    db()
        .prepare('INSERT INTO tokens (token_hash, account_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(hash, account.id, 'reset-password', new Date(now).toISOString(), new Date(now + RESET_TTL).toISOString());
    await sendMail({
        to: account.email,
        subject: 'Reset your ENS Solutions licensing password',
        text:
            `Hello ${account.name},\n\nChoose a new password here:\n\n${link('/account/reset', token)}\n\n` +
            `The link works for one hour. If you didn't ask for this, ignore this message; your password hasn't changed.\n\n` +
            `ENS Solutions licensing`,
    });
}

export async function resetPassword(token: string, password: string): Promise<Account | null> {
    // Check what can be checked before the link is used up.
    checkNewPassword(password);
    const id = transaction(() => consumeToken(token, 'reset-password'));
    const account = id ? accountById(id) : null;
    if (!id || !account) {
        record({ action: 'account.password-reset', outcome: 'failure', actor: anonymous(null), reason: 'invalid, used or expired link' });
        return null;
    }
    try {
        checkNewPassword(password, account.email);
    } catch (err) {
        record({
            action: 'account.password-reset',
            outcome: 'failure',
            actor: actorOf(account),
            target: accountTarget(account),
            account: id,
            reason: (err as Error).message,
        });
        throw err;
    }
    const hash = await hashPassword(password);
    // A reset also proves the address, and signs out every other session.
    transaction(() => {
        db()
            .prepare('UPDATE accounts SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?')
            .run(hash, nowIso(), id);
        destroySessions(id);
        audit({ actor: id, account: id, action: 'account.password-reset' });
    });
    return accountById(id);
}

export async function changePassword(account: Account, current: string, next: string, keepSession: string): Promise<void> {
    const row = db().prepare('SELECT password_hash FROM accounts WHERE id = ?').get(account.id) as { password_hash: string };
    if (!(await checkPassword(current, row.password_hash))) {
        audit({ actor: account.id, account: account.id, action: 'account.password-changed', outcome: 'failure', reason: 'wrong current password' });
        throw new AccountError('That is not your current password', 'current');
    }
    checkNewPassword(next, account.email);
    const hash = await hashPassword(next);
    transaction(() => {
        db().prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(hash, account.id);
        destroySessions(account.id, keepSession);
        audit({ actor: account.id, account: account.id, action: 'account.password-changed' });
    });
}

export function updateProfile(account: Account, input: { name?: string; organization?: string; phone?: string }): Account {
    const name = text(input.name, 120, 'name', true);
    const organization = text(input.organization, 160, 'organization');
    const phone = text(input.phone, 40, 'phone');
    const changes: Record<string, string> = {};
    for (const [field, value] of Object.entries({ name, organization, phone })) {
        const old = account[field as 'name' | 'organization' | 'phone'];
        if (old !== value) Object.assign(changes, { [`${field}.old`]: old, [`${field}.new`]: value });
    }
    transaction(() => {
        db().prepare('UPDATE accounts SET name = ?, organization = ?, phone = ? WHERE id = ?').run(name, organization, phone, account.id);
        audit({ actor: account.id, account: account.id, action: 'account.updated', details: changes });
    });
    return accountById(account.id)!;
}

/* ---- Administration ----------------------------------------------------- */

export function listAccounts(search = ''): (Account & { license_count: number })[] {
    const q = `%${search.trim().toLowerCase()}%`;
    return db()
        .prepare(
            `SELECT ${COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}, COUNT(l.id) AS license_count
             FROM accounts a LEFT JOIN licenses l ON l.account_id = a.id
             WHERE lower(a.email) LIKE ? OR lower(a.name) LIKE ? OR lower(a.organization) LIKE ?
             GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`,
        )
        .all(q, q, q) as unknown as (Account & { license_count: number })[];
}

export function setRole(actor: Account, target: Account, role: 'customer' | 'admin'): void {
    if (actor.id === target.id && role !== 'admin') {
        throw new AccountError('You can’t remove your own administrator role');
    }
    transaction(() => {
        db().prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, target.id);
        audit({ actor: actor.id, account: target.id, action: 'account.role-changed', detail: role, details: { 'role.old': target.role, 'role.new': role } });
    });
}

export function setDisabled(actor: Account, target: Account, disabled: boolean): void {
    if (actor.id === target.id) {
        throw new AccountError('You can’t disable your own account');
    }
    transaction(() => {
        db().prepare('UPDATE accounts SET disabled_at = ? WHERE id = ?').run(disabled ? nowIso() : null, target.id);
        if (disabled) destroySessions(target.id);
        audit({ actor: actor.id, account: target.id, action: disabled ? 'account.disabled' : 'account.enabled' });
    });
}
