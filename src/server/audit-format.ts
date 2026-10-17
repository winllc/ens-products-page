/*
 * The shared ENS audit event format, ens-audit/1: field order, the hash chain
 * and verification. Pure functions only (no database, no environment), so the
 * migration in db.ts, the store, the outputs and the tests all use the same
 * serializer.
 *
 *   body = the event as compact JSON in the fixed field order, without "hash"
 *   hash = hex SHA-256 of UTF-8(prevHash + "\n" + body)
 *   line = body with its final "}" replaced by ,"hash":"<hash>"}
 *
 * The stored line is the source of truth; verification never re-serializes.
 */

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

export const SCHEMA = 'ens-audit/1';
export const PRODUCT = 'licensing-portal';
export const ZERO_HASH = '0'.repeat(64);
export const MAX_STRING = 1000;
export const REDACTED = '[redacted]';

export type Category = 'authentication' | 'authorization' | 'account' | 'configuration' | 'data' | 'license' | 'system' | 'audit';
export type Outcome = 'success' | 'failure' | 'denied';
export type Severity = 'info' | 'notice' | 'warning' | 'alert';
export type ActorType = 'user' | 'service' | 'system' | 'anonymous';

export const CATEGORIES: Category[] = ['authentication', 'authorization', 'account', 'configuration', 'data', 'license', 'system', 'audit'];
export const OUTCOMES: Outcome[] = ['success', 'failure', 'denied'];
export const SEVERITIES: Severity[] = ['info', 'notice', 'warning', 'alert'];

export interface Actor {
    type: ActorType;
    id: string | null;
    name: string | null;
    roles: string[];
}
export interface Source {
    ip: string | null;
    userAgent: string | null;
}
export interface Target {
    type: string;
    id: string | null;
    name: string | null;
}
export type DetailValue = string | number | boolean | null;
export type Details = Record<string, DetailValue>;

export interface AuditEvent {
    schema: typeof SCHEMA;
    id: string;
    seq: number;
    time: string;
    product: string;
    version: string;
    host: string;
    installationId: string | null;
    category: Category;
    action: string;
    outcome: Outcome;
    severity: Severity;
    actor: Actor;
    source: Source | null;
    target: Target | null;
    reason: string | null;
    details: Details;
    requestId: string | null;
    session: string | null;
    prevHash: string;
    hash?: string;
}

/**
 * Every action this service records, with its category and default severity
 * (on success; failures and denials default to warning). Never rename one:
 * SIEM searches depend on them. The account.* and license.* ids are the ones
 * the portal has always written.
 */
export const ACTIONS = {
    'auth.login': { category: 'authentication', severity: 'info', label: 'Signed in' },
    'auth.logout': { category: 'authentication', severity: 'info', label: 'Signed out' },
    'auth.lockout': { category: 'authentication', severity: 'alert', label: 'Too many attempts' },
    'account.password-changed': { category: 'authentication', severity: 'notice', label: 'Password changed' },
    'account.password-reset': { category: 'authentication', severity: 'notice', label: 'Password reset' },
    'account.password-reset-requested': { category: 'authentication', severity: 'info', label: 'Password reset requested' },
    'account.created': { category: 'account', severity: 'info', label: 'Account created' },
    'account.verified': { category: 'account', severity: 'info', label: 'Email confirmed' },
    'account.updated': { category: 'account', severity: 'info', label: 'Details updated' },
    'account.role-changed': { category: 'account', severity: 'notice', label: 'Role changed' },
    'account.disabled': { category: 'account', severity: 'notice', label: 'Account disabled' },
    'account.enabled': { category: 'account', severity: 'notice', label: 'Account enabled' },
    'license.issued': { category: 'data', severity: 'notice', label: 'License issued' },
    'license.downloaded': { category: 'data', severity: 'info', label: 'License downloaded' },
    'license.bound': { category: 'data', severity: 'notice', label: 'Installation binding changed' },
    'license.renamed': { category: 'data', severity: 'info', label: 'License renamed' },
    'license.renewed': { category: 'data', severity: 'notice', label: 'License renewed' },
    'license.revoked': { category: 'data', severity: 'notice', label: 'License revoked' },
    'license.reinstated': { category: 'data', severity: 'notice', label: 'License reinstated' },
    'license.resigned': { category: 'data', severity: 'notice', label: 'License re-signed' },
    'access.denied': { category: 'authorization', severity: 'warning', label: 'Access denied' },
    'audit.exported': { category: 'audit', severity: 'info', label: 'Audit log exported' },
    'audit.verified': { category: 'audit', severity: 'info', label: 'Audit log verified' },
    'audit.token-created': { category: 'audit', severity: 'notice', label: 'Audit API token created' },
    'audit.token-revoked': { category: 'audit', severity: 'notice', label: 'Audit API token revoked' },
    'audit.pruned': { category: 'audit', severity: 'notice', label: 'Audit log pruned' },
    'audit.delivery-failed': { category: 'audit', severity: 'alert', label: 'Audit delivery failing' },
    'audit.delivery-recovered': { category: 'audit', severity: 'notice', label: 'Audit delivery recovered' },
    'system.started': { category: 'system', severity: 'info', label: 'Service started' },
    'system.stopped': { category: 'system', severity: 'info', label: 'Service stopped' },
    'job.completed': { category: 'system', severity: 'info', label: 'Job completed' },
    'job.failed': { category: 'system', severity: 'warning', label: 'Job failed' },
} as const satisfies Record<string, { category: Category; severity: Severity; label: string }>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export function defaultSeverity(action: string, outcome: Outcome): Severity {
    const meta = (ACTIONS as Record<string, { severity: Severity }>)[action];
    if (outcome !== 'success') {
        return meta?.severity === 'alert' ? 'alert' : 'warning';
    }
    return meta?.severity ?? 'info';
}

export function categoryOf(action: string): Category {
    return (ACTIONS as Record<string, { category: Category }>)[action]?.category ?? 'system';
}

/** The build version (ENS_VERSION, set in the image), or "dev". */
export function buildVersion(): string {
    return process.env.ENS_VERSION?.trim() || 'dev';
}

export function hostName(): string {
    return hostname();
}

/* ---- Sanitizing --------------------------------------------------------- */

/** Detail keys whose values are never recorded. */
const SECRET_KEY = /pass(word|phrase|code)?|secret|token|api[-_.]?key|private[-_.]?key|signing[-_.]?key|otp|\bpin\b|(^|[-_.])code$|seed|session|cookie|authorization|credential|license[-_.]?(file|text)/i;

export function truncate(s: string | null | undefined, max = MAX_STRING): string | null {
    if (s === null || s === undefined) return null;
    return s.length > max ? s.slice(0, max) : s;
}

export function isSecretKey(key: string): boolean {
    return SECRET_KEY.test(key);
}

/** A flat details object: scalar values only, strings truncated, secrets redacted. */
export function cleanDetails(input: Record<string, unknown> | undefined | null): Details {
    const out: Details = {};
    if (!input) return out;
    for (const [key, raw] of Object.entries(input)) {
        if (raw === undefined) continue;
        let v: DetailValue;
        if (raw === null || typeof raw === 'boolean') v = raw;
        else if (typeof raw === 'number') v = Number.isFinite(raw) ? raw : String(raw);
        else if (typeof raw === 'string') v = truncate(raw);
        else if (raw instanceof Date) v = raw.toISOString();
        else v = truncate(JSON.stringify(raw));
        out[truncate(key, 200)!] = isSecretKey(key) && v !== null && v !== '' ? REDACTED : v;
    }
    return out;
}

/* ---- Serializing and the chain ----------------------------------------- */

/** The event as compact JSON in the fixed field order, without "hash". */
export function serializeBody(e: AuditEvent): string {
    const ordered = {
        schema: e.schema,
        id: e.id,
        seq: e.seq,
        time: e.time,
        product: e.product,
        version: e.version,
        host: e.host,
        installationId: e.installationId,
        category: e.category,
        action: e.action,
        outcome: e.outcome,
        severity: e.severity,
        actor: { type: e.actor.type, id: e.actor.id, name: e.actor.name, roles: [...e.actor.roles] },
        source: e.source ? { ip: e.source.ip, userAgent: e.source.userAgent } : null,
        target: e.target ? { type: e.target.type, id: e.target.id, name: e.target.name } : null,
        reason: e.reason,
        details: e.details,
        requestId: e.requestId,
        session: e.session,
        prevHash: e.prevHash,
    };
    return JSON.stringify(ordered);
}

export function chainHash(prevHash: string, body: string): string {
    return createHash('sha256').update(`${prevHash}\n${body}`, 'utf8').digest('hex');
}

export function lineOf(body: string, hash: string): string {
    return `${body.slice(0, -1)},"hash":"${hash}"}`;
}

const HASH_SUFFIX = /,"hash":"([0-9a-f]{64})"\}$/;

/** Splits a stored line back into its body and hash, without re-serializing. */
export function splitLine(line: string): { body: string; hash: string } | null {
    const m = HASH_SUFFIX.exec(line);
    if (!m) return null;
    return { body: `${line.slice(0, m.index)}}`, hash: m[1]! };
}

/** Builds body, hash and line for an event whose seq and prevHash are set. */
export function seal(e: AuditEvent): { body: string; hash: string; line: string } {
    const body = serializeBody(e);
    const hash = chainHash(e.prevHash, body);
    return { body, hash, line: lineOf(body, hash) };
}

export interface VerifyResult {
    intact: boolean;
    /** The first seq whose line, hash, seq or link is wrong. */
    brokenSeq: number | null;
    problem: string | null;
    /** The first retained seq; its prevHash is taken as given when it isn't seq 1. */
    anchorSeq: number | null;
    anchorAccepted: boolean;
    lastSeq: number | null;
    checked: number;
}

/**
 * Walks stored lines in seq order and recomputes each hash. Feed it rows in
 * ascending seq; call finish() for the result.
 */
export function chainVerifier() {
    const r: VerifyResult = { intact: true, brokenSeq: null, problem: null, anchorSeq: null, anchorAccepted: false, lastSeq: null, checked: 0 };
    let prev: { seq: number; hash: string } | null = null;
    const fail = (seq: number, problem: string) => {
        if (r.intact) {
            r.intact = false;
            r.brokenSeq = seq;
            r.problem = problem;
        }
    };
    return {
        add(seq: number, line: string): void {
            r.checked++;
            r.lastSeq = seq;
            if (!r.intact) return;
            const parts = splitLine(line);
            if (!parts) return fail(seq, 'unreadable line');
            let parsed: { seq?: unknown; prevHash?: unknown };
            try {
                parsed = JSON.parse(parts.body);
            } catch {
                return fail(seq, 'unreadable line');
            }
            if (parsed.seq !== seq) return fail(seq, 'seq does not match the stored row');
            const prevHash = typeof parsed.prevHash === 'string' ? parsed.prevHash : '';
            if (prev === null) {
                r.anchorSeq = seq;
                if (seq === 1) {
                    if (prevHash !== ZERO_HASH) return fail(seq, 'seq 1 does not start from the zero hash');
                } else {
                    r.anchorAccepted = true;
                }
            } else {
                if (seq !== prev.seq + 1) return fail(prev.seq + 1, `seq ${prev.seq + 1} is missing`);
                if (prevHash !== prev.hash) return fail(seq, 'prevHash does not match the previous event');
            }
            if (chainHash(prevHash, parts.body) !== parts.hash) return fail(seq, 'hash does not match the event');
            prev = { seq, hash: parts.hash };
        },
        finish(): VerifyResult {
            return { ...r };
        },
    };
}

export function describeVerify(r: VerifyResult): string {
    if (r.checked === 0) return 'The audit log is empty.';
    const anchor =
        r.anchorSeq === null
            ? ''
            : r.anchorAccepted
              ? ` Anchored at seq ${r.anchorSeq} (earlier events were pruned; its prevHash is accepted as given).`
              : ` Anchored at seq ${r.anchorSeq}.`;
    return r.intact
        ? `Intact: ${r.checked} events, seq ${r.anchorSeq} to ${r.lastSeq}.${anchor}`
        : `Broken at seq ${r.brokenSeq}: ${r.problem}.${anchor}`;
}
