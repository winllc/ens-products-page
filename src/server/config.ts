/*
 * Licensing service configuration, from the environment. Read once, on first
 * use, so the static build never needs any of it.
 *
 *   PUBLIC_URL                  Base URL of the site, for links in emails
 *                               (default http://localhost:4321)
 *   DATA_DIR                    Where the SQLite database (and, if no key is
 *                               given, the generated signing key) live
 *                               (default ./data)
 *   LICENSE_SIGNING_KEY         Ed25519 private key, PEM
 *   LICENSE_SIGNING_KEY_FILE    ...or a path to it
 *   LICENSE_TRUSTED_KEYS        Older public keys still accepted when
 *                               checking a file, comma-separated base64 SPKI
 *   ADMIN_EMAILS                Comma-separated; these accounts are
 *                               administrators once their email is verified
 *   SMTP_URL                    e.g. smtps://user:pass@mail.example.com:465.
 *                               Unset: emails are written to the log instead
 *   MAIL_FROM                   default "ENS Solutions <licensing@ens-solutions.com>"
 *   COOKIE_SECURE               "false" to allow sessions over plain HTTP
 *                               (local development only)
 */

import { resolve } from 'node:path';

export interface Config {
    publicUrl: string;
    dataDir: string;
    databasePath: string;
    signingKeyPem: string | null;
    signingKeyFile: string | null;
    trustedKeys: string[];
    adminEmails: Set<string>;
    smtpUrl: string | null;
    mailFrom: string;
    cookieSecure: boolean;
}

const list = (v: string | undefined) =>
    (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

let cached: Config | null = null;

export function config(): Config {
    if (cached) {
        return cached;
    }
    const env = process.env;
    const dataDir = resolve(env.DATA_DIR ?? 'data');
    const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:4321').replace(/\/+$/, '');
    cached = {
        publicUrl,
        dataDir,
        databasePath: env.LICENSING_DB ?? resolve(dataDir, 'licensing.sqlite'),
        signingKeyPem: env.LICENSE_SIGNING_KEY?.trim() || null,
        signingKeyFile: env.LICENSE_SIGNING_KEY_FILE?.trim() || null,
        trustedKeys: list(env.LICENSE_TRUSTED_KEYS),
        adminEmails: new Set(list(env.ADMIN_EMAILS).map((e) => e.toLowerCase())),
        smtpUrl: env.SMTP_URL?.trim() || null,
        mailFrom: env.MAIL_FROM ?? 'ENS Solutions <licensing@ens-solutions.com>',
        cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== 'false' : publicUrl.startsWith('https:'),
    };
    return cached;
}

/** Tests change the environment between cases. */
export function resetConfigForTests(): void {
    cached = null;
}
