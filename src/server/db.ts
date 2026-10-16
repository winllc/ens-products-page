/*
 * The licensing database: one SQLite file, through Node's built-in
 * node:sqlite, so there is no native module to build and nothing to run
 * beside the service. Back it up by copying DATA_DIR (or with the sqlite3
 * .backup command while it runs).
 *
 * Migrations are numbered and run in order at startup; the applied number is
 * kept in PRAGMA user_version. Add a migration, never edit an old one.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config';

const migrations: string[] = [
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
];

let instance: DatabaseSync | null = null;

export function openDatabase(path: string): DatabaseSync {
    if (path !== ':memory:') {
        mkdirSync(dirname(path), { recursive: true });
    }
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let i = current; i < migrations.length; i++) {
        db.exec('BEGIN');
        try {
            db.exec(migrations[i]!);
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

/** Runs fn in a transaction: all of it lands, or none of it. */
export function transaction<T>(fn: () => T): T {
    const d = db();
    d.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        d.exec('COMMIT');
        return result;
    } catch (err) {
        d.exec('ROLLBACK');
        throw err;
    }
}

export function closeDatabaseForTests(): void {
    instance?.close();
    instance = null;
}

export const nowIso = () => new Date().toISOString();
