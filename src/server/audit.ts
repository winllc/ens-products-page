/*
 * The audit trail: who did what, from where, to which account or license.
 *
 * Every event is an ens-audit/1 record (audit-format.ts) appended to the
 * audit_events table in the request that caused it, hash-chained to the one
 * before. Writers are serialized by SQLite itself: each append runs inside a
 * BEGIN IMMEDIATE transaction (the database write lock), reading and
 * updating the single audit_head row, so seq and the chain can't fork even
 * with several processes on one database file. An append inside an existing
 * transaction() shares it, so the change and its audit event land together
 * or not at all.
 *
 * Nothing here updates or deletes an event, except retention pruning.
 *
 * Customers see their own entries (by account) on their account and license
 * pages; administrators see everything at /admin/audit.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Account } from './accounts';
import {
    ACTIONS,
    PRODUCT,
    SCHEMA,
    buildVersion,
    categoryOf,
    chainVerifier,
    cleanDetails,
    defaultSeverity,
    hostName,
    seal,
    truncate,
    type ActionId,
    type Actor,
    type AuditEvent,
    type Category,
    type Outcome,
    type Severity,
    type Source,
    type Target,
    type VerifyResult,
} from './audit-format';
import { config } from './config';
import { afterCommit, db, nowIso, transaction } from './db';
import { hashToken, newId } from './secrets';

/** The actions the portal has always recorded, kept for its call sites. */
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
    | 'license.reinstated'
    | 'license.resigned'
    | 'license.extended'
    | 'release.downloaded';

/* ---- Request context ------------------------------------------------------ */

export interface RequestContext {
    ip: string | null;
    userAgent: string | null;
    requestId: string;
    /** First 16 hex of sha256(session token): the stored session hash's prefix. */
    session: string | null;
    account: Account | null;
}

const context = new AsyncLocalStorage<RequestContext>();

/** Runs a request with its audit context (client address, user agent, session). */
export function withAuditContext<T>(ctx: RequestContext, fn: () => T): T {
    return context.run(ctx, fn);
}

export function auditContext(): RequestContext | undefined {
    return context.getStore();
}

export function sessionRef(token: string | null | undefined): string | null {
    return token ? hashToken(token).slice(0, 16) : null;
}

/* ---- Actors ---------------------------------------------------------------- */

export function actorOf(account: Pick<Account, 'email' | 'name' | 'role' | 'email_verified_at'> | null | undefined): Actor {
    if (!account) return { type: 'system', id: null, name: null, roles: [] };
    const admin = account.role === 'admin' || (account.email_verified_at !== null && config().adminEmails.has(account.email));
    return { type: 'user', id: account.email, name: account.name, roles: [admin ? 'admin' : 'customer'] };
}

function accountRow(id: string): Account | null {
    return (
        (db()
            .prepare('SELECT id, email, name, organization, phone, role, email_verified_at, disabled_at, created_at, last_login_at FROM accounts WHERE id = ?')
            .get(id) as Account | undefined) ?? null
    );
}

export const SYSTEM: Actor = { type: 'system', id: null, name: null, roles: [] };

export function anonymous(attempted: string | null): Actor {
    return { type: 'anonymous', id: truncate(attempted?.trim().toLowerCase() || null, 254), name: null, roles: [] };
}

export function accountTarget(a: Pick<Account, 'id' | 'email'>): Target {
    return { type: 'account', id: a.id, name: a.email };
}

/* ---- Appending -------------------------------------------------------------- */

export interface RecordInput {
    action: ActionId | (string & {});
    category?: Category;
    outcome?: Outcome;
    severity?: Severity;
    /** Default: the signed-in account in the request context, or the system. */
    actor?: Actor;
    /** Default: the request context's client address and user agent. */
    source?: Source | null;
    target?: Target | null;
    reason?: string | null;
    details?: Record<string, unknown>;
    /** The customer account this concerns, so its owner sees it. */
    account?: string | null;
    license?: string | null;
    /** Override the request context's session reference. */
    session?: string | null;
    /**
     * A failed write throws (the action fails) when true, the default for
     * everything but system, job and delivery events, which log and go on.
     */
    critical?: boolean;
}

export interface Recorded {
    seq: number;
    id: string;
    line: string;
    event: AuditEvent;
}

/** Notified after each committed append: the outputs listen here. */
export const auditEvents = new EventEmitter();
auditEvents.setMaxListeners(20);

type LineSink = (line: string, seq: number) => void;
const sinks: LineSink[] = [];

/** Synchronous outputs (stdout, file), called after the append commits. */
export function addLineSink(sink: LineSink): () => void {
    sinks.push(sink);
    return () => {
        const i = sinks.indexOf(sink);
        if (i >= 0) sinks.splice(i, 1);
    };
}

function emit(rec: Recorded): void {
    for (const sink of sinks) {
        try {
            sink(rec.line, rec.seq);
        } catch (err) {
            console.error(`ens.audit: output failed: ${(err as Error).message}`);
        }
    }
    auditEvents.emit('appended', rec.seq);
}

function nonCritical(action: string): boolean {
    const c = categoryOf(action);
    return c === 'system' || action.startsWith('audit.delivery') || action === 'audit.pruned';
}

/** Appends one event. Throws if the store write fails and the event is critical. */
export function record(input: RecordInput): Recorded | null {
    const critical = input.critical ?? !nonCritical(input.action);
    try {
        return append(input);
    } catch (err) {
        if (critical) throw err;
        console.error(`ens.audit: could not record ${input.action}: ${(err as Error).message}`);
        return null;
    }
}

function append(input: RecordInput): Recorded {
    const ctx = context.getStore();
    const outcome = input.outcome ?? 'success';
    const actor = input.actor ?? (ctx?.account ? actorOf(ctx.account) : SYSTEM);
    const source = input.source !== undefined ? input.source : ctx ? { ip: ctx.ip, userAgent: ctx.userAgent } : null;
    const base: Omit<AuditEvent, 'seq' | 'prevHash'> = {
        schema: SCHEMA,
        id: randomUUID(),
        time: new Date().toISOString(),
        product: PRODUCT,
        version: buildVersion(),
        host: hostName(),
        installationId: null,
        category: input.category ?? categoryOf(input.action),
        action: input.action,
        outcome,
        severity: input.severity ?? defaultSeverity(input.action, outcome),
        actor: { type: actor.type, id: truncate(actor.id), name: truncate(actor.name), roles: actor.roles.map((r) => truncate(r)!) },
        source: source ? { ip: truncate(source.ip, 64), userAgent: truncate(source.userAgent) } : null,
        target: input.target ? { type: truncate(input.target.type, 64)!, id: truncate(input.target.id), name: truncate(input.target.name) } : null,
        reason: truncate(input.reason ?? null),
        details: cleanDetails(input.details),
        requestId: ctx?.requestId ?? null,
        session: input.session !== undefined ? input.session : (ctx?.session ?? null),
    };

    const d = db();
    const own = !d.isTransaction;
    if (own) d.exec('BEGIN IMMEDIATE');
    let rec: Recorded;
    try {
        const head = d.prepare('SELECT seq, hash FROM audit_head WHERE id = 1').get() as { seq: number; hash: string };
        const event: AuditEvent = { ...base, seq: head.seq + 1, prevHash: head.hash };
        const { hash, line } = seal(event);
        d.prepare(
            `INSERT INTO audit_events (seq, id, time, category, action, outcome, severity, actor_type, actor_id, actor_name,
                target_type, target_id, target_name, source_ip, account_id, license_id, line, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            event.seq,
            event.id,
            event.time,
            event.category,
            event.action,
            event.outcome,
            event.severity,
            event.actor.type,
            event.actor.id,
            event.actor.name,
            event.target?.type ?? null,
            event.target?.id ?? null,
            event.target?.name ?? null,
            event.source?.ip ?? null,
            input.account ?? null,
            input.license ?? null,
            line,
            hash,
        );
        d.prepare('UPDATE audit_head SET seq = ?, hash = ? WHERE id = 1').run(event.seq, hash);
        if (own) d.exec('COMMIT');
        rec = { seq: event.seq, id: event.id, line, event: { ...event, hash } };
    } catch (err) {
        if (own) d.exec('ROLLBACK');
        throw err;
    }
    afterCommit(() => emit(rec));
    return rec;
}

/**
 * The portal's original call: an account (by id) did something to an
 * account and maybe a license. `detail` is the line customers see.
 */
export function audit(e: {
    actor: string | null;
    account?: string | null;
    license?: string | null;
    action: AuditAction;
    detail?: string;
    details?: Record<string, unknown>;
    target?: Target | null;
    outcome?: Outcome;
    reason?: string | null;
}): void {
    const ctx = context.getStore();
    const actorAccount = e.actor ? (ctx?.account?.id === e.actor ? ctx.account : accountRow(e.actor)) : null;
    let target = e.target;
    if (target === undefined) {
        if (e.license) {
            const l = db().prepare('SELECT label FROM licenses WHERE id = ?').get(e.license) as { label: string } | undefined;
            target = { type: 'license', id: e.license, name: l?.label || null };
        } else if (e.account) {
            const owner = e.account === e.actor && actorAccount ? actorAccount : accountRow(e.account);
            target = { type: 'account', id: e.account, name: owner?.email ?? null };
        } else {
            target = null;
        }
    }
    record({
        action: e.action,
        outcome: e.outcome,
        reason: e.reason,
        actor: actorAccount ? actorOf(actorAccount) : e.actor ? { type: 'user', id: e.actor, name: null, roles: [] } : SYSTEM,
        target,
        account: e.account ?? null,
        license: e.license ?? null,
        details: { detail: e.detail || null, account: e.account ?? null, license: e.license ?? null, ...e.details },
    });
}

/* ---- Collapsing repeats ------------------------------------------------------ */

const WINDOW_MS = 60_000;
const collapsed = new Map<string, { suppressed: number; timer: NodeJS.Timeout }>();

/**
 * Records the first of a run of identical events (same key) and counts the
 * rest for 60 seconds, then records one more with details.count = how many
 * were held back. Denials and lockouts go through here so a polling client
 * or a password-guessing script can't flood the log.
 */
export function recordCollapsed(key: string, input: RecordInput): void {
    const existing = collapsed.get(key);
    if (existing) {
        existing.suppressed++;
        return;
    }
    // Resolve the request context now: the summary is written from a timer.
    const ctx = context.getStore();
    const resolved: RecordInput = {
        ...input,
        actor: input.actor ?? (ctx?.account ? actorOf(ctx.account) : SYSTEM),
        source: input.source !== undefined ? input.source : ctx ? { ip: ctx.ip, userAgent: ctx.userAgent } : null,
        session: input.session !== undefined ? input.session : (ctx?.session ?? null),
        critical: input.critical ?? false,
    };
    record({ ...resolved, details: { ...resolved.details, count: 1 } });
    const entry = {
        suppressed: 0,
        timer: setTimeout(() => {
            collapsed.delete(key);
            if (entry.suppressed > 0) {
                record({ ...resolved, details: { ...resolved.details, count: entry.suppressed, collapsed: true, windowSeconds: WINDOW_MS / 1000 } });
            }
        }, WINDOW_MS),
    };
    entry.timer.unref?.();
    collapsed.set(key, entry);
}

/** A 403: records access.denied, collapsed per actor, path and reason. */
export function recordDenied(req: { method: string; path: string; reason: string; actor?: Actor; account?: string | null }): void {
    const ctx = context.getStore();
    const actor = req.actor ?? (ctx?.account ? actorOf(ctx.account) : anonymous(null));
    recordCollapsed(`denied|${actor.id ?? ctx?.ip ?? ''}|${req.path}|${req.reason}`, {
        action: 'access.denied',
        outcome: 'denied',
        actor,
        target: { type: 'route', id: req.path, name: null },
        reason: req.reason,
        account: req.account ?? ctx?.account?.id ?? null,
        details: { method: req.method, path: req.path, reason: req.reason },
    });
}

/** A rate limit or lockout: records auth.lockout, collapsed per address, bucket and key. */
export function recordLockout(req: { bucket: string; attempted: string | null; account?: string | null; reason?: string }): void {
    const ctx = context.getStore();
    const actor = ctx?.account ? actorOf(ctx.account) : anonymous(req.attempted);
    recordCollapsed(`lockout|${ctx?.ip ?? ''}|${req.bucket}|${actor.id ?? ''}`, {
        action: 'auth.lockout',
        outcome: 'denied',
        actor,
        target: req.account ? { type: 'account', id: req.account, name: req.attempted } : null,
        reason: req.reason ?? 'too many attempts',
        account: req.account ?? null,
        details: { bucket: req.bucket },
    });
}

/* ---- Reading ------------------------------------------------------------------- */

export interface AuditEntry {
    seq: number;
    at: string;
    actor_id: string | null;
    actor_email: string | null;
    account_id: string | null;
    license_id: string | null;
    action: string;
    outcome: Outcome;
    label: string;
    detail: string;
}

interface Row {
    seq: number;
    id: string;
    time: string;
    category: Category;
    action: string;
    outcome: Outcome;
    severity: Severity;
    actor_type: string;
    actor_id: string | null;
    actor_name: string | null;
    target_type: string | null;
    target_id: string | null;
    target_name: string | null;
    source_ip: string | null;
    account_id: string | null;
    license_id: string | null;
    line: string;
    hash: string;
}

/** What a customer sees in their own history: their account, licenses and downloads, sign-ins. */
const CUSTOMER_VISIBLE = (Object.keys(ACTIONS) as string[]).filter(
    (a) => a.startsWith('account.') || a.startsWith('license.') || a.startsWith('release.') || a.startsWith('auth.'),
);

export function labelFor(action: string, outcome: Outcome): string {
    if (action === 'auth.login' && outcome !== 'success') return 'Sign-in failed';
    const base = (ACTIONS as Record<string, { label: string }>)[action]?.label ?? action;
    return outcome === 'success' || action === 'auth.lockout' ? base : `${base} (${outcome === 'denied' ? 'denied' : 'failed'})`;
}

function toEntry(r: Row): AuditEntry {
    const e = JSON.parse(r.line) as AuditEvent;
    const detail = typeof e.details.detail === 'string' ? e.details.detail : (e.reason ?? '');
    return {
        seq: r.seq,
        at: r.time,
        actor_id: r.actor_id,
        actor_email: r.actor_type === 'system' ? null : r.actor_id,
        account_id: r.account_id,
        license_id: r.license_id,
        action: r.action,
        outcome: r.outcome,
        label: labelFor(r.action, r.outcome),
        detail,
    };
}

/**
 * History for an account or a license page, newest first. `customer` limits
 * it to the entries a customer sees about themselves.
 */
export function auditFor(filter: { account?: string; license?: string; customer?: boolean }, limit = 50): AuditEntry[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.license) {
        where.push('license_id = ?');
        args.push(filter.license);
    } else if (filter.account) {
        where.push('account_id = ?');
        args.push(filter.account);
    }
    if (filter.customer) {
        where.push(`action IN (${CUSTOMER_VISIBLE.map(() => '?').join(', ')})`);
        args.push(...CUSTOMER_VISIBLE);
    }
    const rows = db()
        .prepare(`SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`)
        .all(...args, limit) as unknown as Row[];
    return rows.map(toEntry);
}

export interface AuditFilter {
    from?: string;
    to?: string;
    category?: string;
    action?: string;
    outcome?: string;
    severity?: string;
    actor?: string;
    target?: string;
    ip?: string;
    q?: string;
}

export const FILTER_KEYS: (keyof AuditFilter)[] = ['from', 'to', 'category', 'action', 'outcome', 'severity', 'actor', 'target', 'ip', 'q'];

export function filterFrom(params: URLSearchParams): AuditFilter {
    const f: AuditFilter = {};
    for (const k of FILTER_KEYS) {
        const v = params.get(k)?.trim();
        if (v) f[k] = v.slice(0, 500);
    }
    return f;
}

/** "2026-10-16", "2026-10-16T09:30" or a full ISO time, read as UTC. */
export function boundary(raw: string, end: boolean): string | null {
    let s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += end ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += end ? ':59.999Z' : ':00.000Z';
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += end ? '.999Z' : '.000Z';
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const like = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function whereOf(f: AuditFilter): { sql: string; args: string[] } {
    const where: string[] = [];
    const args: string[] = [];
    const from = f.from ? boundary(f.from, false) : null;
    const to = f.to ? boundary(f.to, true) : null;
    if (from) where.push('time >= ?'), args.push(from);
    if (to) where.push('time <= ?'), args.push(to);
    if (f.category) where.push('category = ?'), args.push(f.category);
    if (f.action) where.push('action = ?'), args.push(f.action);
    if (f.outcome) where.push('outcome = ?'), args.push(f.outcome);
    if (f.severity) where.push('severity = ?'), args.push(f.severity);
    if (f.ip) where.push('source_ip = ?'), args.push(f.ip);
    if (f.actor) {
        where.push("(lower(ifnull(actor_id, '')) LIKE ? ESCAPE '\\' OR lower(ifnull(actor_name, '')) LIKE ? ESCAPE '\\')");
        args.push(like(f.actor), like(f.actor));
    }
    if (f.target) {
        where.push(
            "(lower(ifnull(target_id, '')) LIKE ? ESCAPE '\\' OR lower(ifnull(target_name, '')) LIKE ? ESCAPE '\\' OR lower(ifnull(target_type, '')) LIKE ? ESCAPE '\\')",
        );
        args.push(like(f.target), like(f.target), like(f.target));
    }
    if (f.q) where.push("lower(line) LIKE ? ESCAPE '\\'"), args.push(like(f.q));
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

export interface AuditRow extends Row {
    event: AuditEvent;
}

export function queryAudit(f: AuditFilter, page = 1, pageSize = 50): { rows: AuditRow[]; total: number; page: number; pages: number } {
    const { sql, args } = whereOf(f);
    const total = (db().prepare(`SELECT COUNT(*) AS n FROM audit_events ${sql}`).get(...args) as { n: number }).n;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    const rows = db()
        .prepare(`SELECT * FROM audit_events ${sql} ORDER BY seq DESC LIMIT ? OFFSET ?`)
        .all(...args, pageSize, (p - 1) * pageSize) as unknown as Row[];
    return { rows: rows.map((r) => ({ ...r, event: JSON.parse(r.line) as AuditEvent })), total, page: p, pages };
}

export function auditBySeq(seq: number): AuditRow | null {
    const r = db().prepare('SELECT * FROM audit_events WHERE seq = ?').get(seq) as Row | undefined;
    return r ? { ...r, event: JSON.parse(r.line) as AuditEvent } : null;
}

/** The filtered events, oldest first, in pages of 1000, up to `max`. */
export function* exportRows(f: AuditFilter, max = 100_000, upToSeq = Number.MAX_SAFE_INTEGER): Generator<Row> {
    const { sql, args } = whereOf(f);
    let after = 0;
    let n = 0;
    const stmt = db().prepare(
        `SELECT * FROM audit_events ${sql ? `${sql} AND` : 'WHERE'} seq > ? AND seq <= ? ORDER BY seq LIMIT ?`,
    );
    while (n < max) {
        const rows = stmt.all(...args, after, upToSeq, Math.min(1000, max - n)) as unknown as Row[];
        if (!rows.length) return;
        for (const r of rows) {
            n++;
            yield r;
        }
        after = rows.at(-1)!.seq;
    }
}

export function countMatching(f: AuditFilter): number {
    const { sql, args } = whereOf(f);
    return (db().prepare(`SELECT COUNT(*) AS n FROM audit_events ${sql}`).get(...args) as { n: number }).n;
}

export function knownActions(): string[] {
    const stored = (db().prepare('SELECT DISTINCT action FROM audit_events').all() as { action: string }[]).map((r) => r.action);
    return [...new Set([...Object.keys(ACTIONS), ...stored])].sort();
}

export function headSeq(): number {
    return (db().prepare('SELECT seq FROM audit_head WHERE id = 1').get() as { seq: number }).seq;
}

/** Events after a cursor, ascending, for the pull API and the forwarders. */
export function linesAfter(after: number, limit: number): { seq: number; line: string }[] {
    return db().prepare('SELECT seq, line FROM audit_events WHERE seq > ? ORDER BY seq LIMIT ?').all(after, limit) as unknown as {
        seq: number;
        line: string;
    }[];
}

/* ---- CSV ------------------------------------------------------------------------- */

export const CSV_COLUMNS = [
    'seq', 'id', 'time', 'category', 'action', 'outcome', 'severity', 'actor_type', 'actor_id', 'actor_name', 'actor_roles',
    'source_ip', 'user_agent', 'target_type', 'target_id', 'target_name', 'reason', 'details', 'request_id', 'session', 'hash',
] as const;

function csvCell(v: unknown): string {
    let s = v === null || v === undefined ? '' : String(v);
    // Keep spreadsheets from reading a value as a formula.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(line: string): string {
    const e = JSON.parse(line) as AuditEvent;
    return [
        e.seq, e.id, e.time, e.category, e.action, e.outcome, e.severity, e.actor.type, e.actor.id, e.actor.name, e.actor.roles.join(' '),
        e.source?.ip, e.source?.userAgent, e.target?.type, e.target?.id, e.target?.name, e.reason, JSON.stringify(e.details),
        e.requestId, e.session, e.hash,
    ]
        .map(csvCell)
        .join(',');
}

/* ---- Verification ------------------------------------------------------------------ */

export function verifyAudit(): VerifyResult {
    const v = chainVerifier();
    const stmt = db().prepare('SELECT seq, line FROM audit_events WHERE seq > ? ORDER BY seq LIMIT 1000');
    let after = 0;
    for (;;) {
        const rows = stmt.all(after) as { seq: number; line: string }[];
        if (!rows.length) break;
        for (const r of rows) v.add(r.seq, r.line);
        after = rows.at(-1)!.seq;
    }
    return v.finish();
}

/* ---- API tokens --------------------------------------------------------------------- */

export interface AuditToken {
    id: string;
    name: string;
    created_by: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
    revoked_by: string | null;
}

export const TOKEN_PREFIX = 'ensat_';

/** Creates a read-only audit API token. The token itself is returned once and never stored. */
export function createAuditToken(admin: Account, rawName: string): { token: string; record: AuditToken } {
    const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!name) throw new Error('Name the token after the system that will use it');
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const t: AuditToken = { id: newId('aut'), name, created_by: admin.email, created_at: nowIso(), last_used_at: null, revoked_at: null, revoked_by: null };
    transaction(() => {
        db().prepare('INSERT INTO audit_tokens (id, name, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
            t.id,
            t.name,
            hashToken(token),
            t.created_by,
            t.created_at,
        );
        record({
            action: 'audit.token-created',
            actor: actorOf(admin),
            target: { type: 'api-token', id: t.id, name: t.name },
            details: { name: t.name, scope: 'audit:read' },
        });
    });
    return { token, record: t };
}

export function listAuditTokens(): AuditToken[] {
    return db()
        .prepare('SELECT id, name, created_by, created_at, last_used_at, revoked_at, revoked_by FROM audit_tokens ORDER BY created_at DESC')
        .all() as unknown as AuditToken[];
}

export function revokeAuditToken(admin: Account, id: string): boolean {
    const t = db().prepare('SELECT id, name FROM audit_tokens WHERE id = ? AND revoked_at IS NULL').get(id) as { id: string; name: string } | undefined;
    if (!t) return false;
    transaction(() => {
        db().prepare('UPDATE audit_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(nowIso(), admin.email, id);
        record({ action: 'audit.token-revoked', actor: actorOf(admin), target: { type: 'api-token', id: t.id, name: t.name }, details: { name: t.name } });
    });
    return true;
}

/** The live token for an Authorization header, with last-used updated; or why not. */
export function authenticateAuditToken(header: string | null): { token: AuditToken } | { error: 'missing' | 'invalid' | 'revoked' } {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
    if (!m) return { error: 'missing' };
    const raw = m[1]!;
    if (!raw.startsWith(TOKEN_PREFIX)) return { error: 'invalid' };
    const t = db()
        .prepare('SELECT id, name, created_by, created_at, last_used_at, revoked_at, revoked_by FROM audit_tokens WHERE token_hash = ?')
        .get(hashToken(raw)) as AuditToken | undefined;
    if (!t) return { error: 'invalid' };
    if (t.revoked_at) return { error: 'revoked' };
    const now = nowIso();
    db().prepare('UPDATE audit_tokens SET last_used_at = ? WHERE id = ?').run(now, t.id);
    return { token: { ...t, last_used_at: now } };
}

/* ---- Retention ------------------------------------------------------------------------ */

/**
 * Deletes events older than `days` that every enabled forwarder has
 * delivered (seq <= deliveredUpTo), never the newest one, and records
 * audit.pruned. Returns how many went.
 */
export function pruneAudit(days: number, deliveredUpTo: number, now = Date.now()): number {
    if (days <= 0) return 0;
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const head = headSeq();
    const limit = Math.min(deliveredUpTo, head - 1);
    const d = db();
    const range = d
        .prepare('SELECT COUNT(*) AS n, MIN(seq) AS lo, MAX(seq) AS hi, MIN(time) AS t0, MAX(time) AS t1 FROM audit_events WHERE time < ? AND seq <= ?')
        .get(cutoff, limit) as { n: number; lo: number | null; hi: number | null; t0: string | null; t1: string | null };
    if (!range.n) return 0;
    transaction(() => {
        d.prepare('DELETE FROM audit_events WHERE time < ? AND seq <= ?').run(cutoff, limit);
        record({
            action: 'audit.pruned',
            actor: SYSTEM,
            critical: true,
            details: { count: range.n, fromSeq: range.lo, toSeq: range.hi, fromTime: range.t0, toTime: range.t1, retentionDays: days },
        });
    });
    return range.n;
}

/** Tests: drop pending collapse windows. */
export function resetAuditForTests(): void {
    for (const c of collapsed.values()) clearTimeout(c.timer);
    collapsed.clear();
}
