/*
 * The licensing database: one SQLite file, through Node's built-in
 * node:sqlite, so there is no native module to build and nothing to run
 * beside the service. Back it up by copying DATA_DIR (or with the sqlite3
 * .backup command while it runs).
 *
 * Migrations are numbered and run in order at startup; the applied number is
 * kept in PRAGMA user_version. Add a migration, never edit an old one. A
 * migration is SQL, or a function for one that has to compute something
 * (the audit hash chain).
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
    PRODUCT,
    SCHEMA,
    ZERO_HASH,
    buildVersion,
    categoryOf,
    cleanDetails,
    defaultSeverity,
    hostName,
    seal,
    type AuditEvent,
} from './audit-format';
import { config } from './config';

type Migration = string | ((db: DatabaseSync) => void);

const migrations: Migration[] = [
    // 1: accounts, sessions, one-time tokens, licenses, audit log
    `
    CREATE TABLE accounts (
        id                TEXT PRIMARY KEY,
        email             TEXT NOT NULL UNIQUE,
        password_hash     TEXT NOT NULL,
        name              TEXT NOT NULL,
        organization      TEXT NOT NULL DEFAULT '',
        phone             TEXT NOT NULL DEFAULT '',
        role              TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
        email_verified_at TEXT,
        disabled_at       TEXT,
        created_at        TEXT NOT NULL,
        last_login_at     TEXT
    );

    CREATE TABLE sessions (
        token_hash  TEXT PRIMARY KEY,
        account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
    );
    CREATE INDEX sessions_account ON sessions(account_id);

    CREATE TABLE tokens (
        token_hash  TEXT PRIMARY KEY,
        account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        purpose     TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        used_at     TEXT
    );

    CREATE TABLE licenses (
        id                TEXT PRIMARY KEY,
        account_id        TEXT NOT NULL REFERENCES accounts(id),
        product           TEXT NOT NULL,
        edition           TEXT NOT NULL,
        label             TEXT NOT NULL DEFAULT '',
        revision          INTEGER NOT NULL,
        payload           TEXT NOT NULL,
        token             TEXT NOT NULL,
        key_id            TEXT NOT NULL,
        issued_at         TEXT NOT NULL,
        expires_at        TEXT,
        revoked_at        TEXT,
        revoked_reason    TEXT,
        order_reference   TEXT NOT NULL DEFAULT '',
        created_by        TEXT REFERENCES accounts(id)
    );
    CREATE INDEX licenses_account ON licenses(account_id);

    CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          TEXT NOT NULL,
        actor_id    TEXT REFERENCES accounts(id),
        account_id  TEXT REFERENCES accounts(id),
        license_id  TEXT REFERENCES licenses(id),
        action      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX audit_account ON audit_log(account_id);
    CREATE INDEX audit_license ON audit_log(license_id);
    `,

    // 2: the audit trail moves to the shared ens-audit/1 format, hash-chained.
    // The old audit_log rows are carried over in time order with new seq
    // numbers and hashes, their time kept and details.migrated = true; then
    // the old table goes.
    (d) => {
        d.exec(`
        CREATE TABLE audit_events (
            seq          INTEGER PRIMARY KEY,
            id           TEXT NOT NULL UNIQUE,
            time         TEXT NOT NULL,
            category     TEXT NOT NULL,
            action       TEXT NOT NULL,
            outcome      TEXT NOT NULL,
            severity     TEXT NOT NULL,
            actor_type   TEXT NOT NULL,
            actor_id     TEXT,
            actor_name   TEXT,
            target_type  TEXT,
            target_id    TEXT,
            target_name  TEXT,
            source_ip    TEXT,
            account_id   TEXT,
            license_id   TEXT,
            line         TEXT NOT NULL,
            hash         TEXT NOT NULL
        );
        CREATE INDEX audit_events_time ON audit_events(time);
        CREATE INDEX audit_events_action ON audit_events(action);
        CREATE INDEX audit_events_category ON audit_events(category);
        CREATE INDEX audit_events_outcome ON audit_events(outcome);
        CREATE INDEX audit_events_severity ON audit_events(severity);
        CREATE INDEX audit_events_actor ON audit_events(actor_id);
        CREATE INDEX audit_events_target ON audit_events(target_id);
        CREATE INDEX audit_events_ip ON audit_events(source_ip);
        CREATE INDEX audit_events_account ON audit_events(account_id);
        CREATE INDEX audit_events_license ON audit_events(license_id);

        -- The chain head: the last seq and hash. Writers update it in the
        -- same write transaction as the insert.
        CREATE TABLE audit_head (
            id    INTEGER PRIMARY KEY CHECK (id = 1),
            seq   INTEGER NOT NULL,
            hash  TEXT NOT NULL
        );

        -- Delivery cursors for the HEC and syslog forwarders.
        CREATE TABLE audit_outputs (
            output         TEXT PRIMARY KEY,
            seq            INTEGER NOT NULL DEFAULT 0,
            delivered_at   TEXT,
            last_error     TEXT,
            last_error_at  TEXT,
            failing_since  TEXT,
            alerted        INTEGER NOT NULL DEFAULT 0
        );

        -- Bearer tokens for GET /api/audit/events. Only the SHA-256 is kept.
        CREATE TABLE audit_tokens (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            token_hash    TEXT NOT NULL UNIQUE,
            created_by    TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            last_used_at  TEXT,
            revoked_at    TEXT,
            revoked_by    TEXT
        );
        `);

        const accounts = new Map(
            (d.prepare('SELECT id, email, name, role FROM accounts').all() as { id: string; email: string; name: string; role: string }[]).map(
                (a) => [a.id, a],
            ),
        );
        const labels = new Map(
            (d.prepare('SELECT id, label FROM licenses').all() as { id: string; label: string }[]).map((l) => [l.id, l.label]),
        );
        const legacy = d.prepare('SELECT * FROM audit_log ORDER BY at, id').all() as {
            id: number;
            at: string;
            actor_id: string | null;
            account_id: string | null;
            license_id: string | null;
            action: string;
            detail: string;
        }[];
        const insert = d.prepare(
            `INSERT INTO audit_events (seq, id, time, category, action, outcome, severity, actor_type, actor_id, actor_name,
                target_type, target_id, target_name, source_ip, account_id, license_id, line, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        let prevHash = ZERO_HASH;
        let seq = 0;
        for (const row of legacy) {
            seq++;
            const who = row.actor_id ? accounts.get(row.actor_id) : undefined;
            const owner = row.account_id ? accounts.get(row.account_id) : undefined;
            const target = row.license_id
                ? { type: 'license', id: row.license_id, name: labels.get(row.license_id) || null }
                : row.account_id
                  ? { type: 'account', id: row.account_id, name: owner?.email ?? null }
                  : null;
            const e: AuditEvent = {
                schema: SCHEMA,
                id: randomUUID(),
                seq,
                time: new Date(row.at).toISOString(),
                product: PRODUCT,
                version: buildVersion(),
                host: hostName(),
                installationId: null,
                category: categoryOf(row.action),
                action: row.action,
                outcome: 'success',
                severity: defaultSeverity(row.action, 'success'),
                actor: who
                    ? { type: 'user', id: who.email, name: who.name, roles: [who.role] }
                    : { type: 'system', id: row.actor_id, name: null, roles: [] },
                source: null,
                target,
                reason: null,
                details: cleanDetails({
                    detail: row.detail || null,
                    account: row.account_id,
                    license: row.license_id,
                    legacyId: row.id,
                    migrated: true,
                }),
                requestId: null,
                session: null,
                prevHash,
            };
            const { hash, line } = seal(e);
            insert.run(
                seq,
                e.id,
                e.time,
                e.category,
                e.action,
                e.outcome,
                e.severity,
                e.actor.type,
                e.actor.id,
                e.actor.name,
                target?.type ?? null,
                target?.id ?? null,
                target?.name ?? null,
                null,
                row.account_id,
                row.license_id,
                line,
                hash,
            );
            prevHash = hash;
        }
        d.prepare('INSERT INTO audit_head (id, seq, hash) VALUES (1, ?, ?)').run(seq, prevHash);
        d.exec('DROP TABLE audit_log');
    },

    // 3: when a customer extended their evaluation themselves (once per license).
    `ALTER TABLE licenses ADD COLUMN extended_at TEXT;`,
];

let instance: DatabaseSync | null = null;

/** Opens (and migrates) a database. `upTo` stops at an older schema, for migration tests. */
export function openDatabase(path: string, upTo = migrations.length): DatabaseSync {
    if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true });
    }
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let i = current; i < upTo; i++) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const m = migrations[i]!;
            if (typeof m === 'string') db.exec(m);
            else m(db);
            db.exec(`PRAGMA user_version = ${i + 1}`);
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }
    return db;
}

export function db(): DatabaseSync {
    instance ??= openDatabase(config().databasePath);
    return instance;
}

let pendingAfterCommit: (() => void)[] | null = null;

/** Runs fn in a transaction: all of it lands, or none of it. */
export function transaction<T>(fn: () => T): T {
    const d = db();
    d.exec('BEGIN IMMEDIATE');
    const outer = pendingAfterCommit;
    pendingAfterCommit = [];
    try {
        const result = fn();
        d.exec('COMMIT');
        const run = pendingAfterCommit;
        pendingAfterCommit = outer;
        for (const f of run) f();
        return result;
    } catch (err) {
        pendingAfterCommit = outer;
        d.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Runs fn once the current transaction() commits (and never if it rolls
 * back), or now when there is none. The audit trail's stdout and file lines
 * go out this way, so nothing is emitted for a change that didn't happen.
 */
export function afterCommit(fn: () => void): void {
    if (pendingAfterCommit) pendingAfterCommit.push(fn);
    else fn();
}

export function closeDatabaseForTests(): void {
    instance?.close();
    instance = null;
}

export const nowIso = () => new Date().toISOString();
