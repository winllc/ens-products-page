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
 *   LICENSE_SIGNING_KEY_P256    Optional ECDSA P-256 private key, PEM. When
 *                               set, every license is also signed with it,
 *                               for Java runtimes in FIPS mode
 *   LICENSE_SIGNING_KEY_P256_FILE ...or a path to it
 *   LICENSE_TRUSTED_KEYS        Older public keys still accepted when
 *                               checking a file, comma-separated base64 SPKI
 *                               (Ed25519 or ECDSA P-256)
 *   ADMIN_EMAILS                Comma-separated; these accounts are
 *                               administrators once their email is verified
 *   SMTP_URL                    e.g. smtps://user:pass@mail.example.com:465.
 *                               Unset: emails are written to the log instead
 *   MAIL_FROM                   default "ENS Solutions <licensing@ens-solutions.com>"
 *   COOKIE_SECURE               "false" to allow sessions over plain HTTP
 *                               (local development only)
 *
 * The audit trail's outputs (see README, "Audit logging"):
 *
 *   ENS_AUDIT_STDOUT            "false" to stop writing events to stdout
 *   ENS_AUDIT_FILE              e.g. /var/log/ens/licensing-portal/audit.jsonl
 *   ENS_AUDIT_FILE_KEEP         rotated files to keep (default 30)
 *   ENS_AUDIT_SPLUNK_URL        Splunk HEC base URL, e.g. https://splunk:8088
 *   ENS_AUDIT_SPLUNK_TOKEN      HEC token, or ENS_AUDIT_SPLUNK_TOKEN_FILE
 *   ENS_AUDIT_SPLUNK_INDEX      optional
 *   ENS_AUDIT_SPLUNK_SOURCETYPE default ens:audit
 *   ENS_AUDIT_SPLUNK_INSECURE   "true" skips TLS verification (test setups only)
 *   ENS_AUDIT_SYSLOG_HOST       syslog receiver
 *   ENS_AUDIT_SYSLOG_PORT       default 514 (udp, tcp) or 6514 (tls)
 *   ENS_AUDIT_SYSLOG_PROTOCOL   udp, tcp or tls (default tcp)
 *   ENS_AUDIT_SYSLOG_FACILITY   default local0
 *   ENS_AUDIT_RETENTION_DAYS    0 (default) keeps events forever
 *
 * Release downloads (see README, "Release downloads"). Credentials come from
 * the AWS SDK's standard chain (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY,
 * or an instance or task role), never from here:
 *
 *   RELEASES_S3_BUCKET          The private bucket CI publishes releases to.
 *                               Unset: downloads are off
 *   RELEASES_S3_REGION          default us-east-1 (auto for R2)
 *   RELEASES_S3_ENDPOINT        For S3-compatible stores (R2, MinIO), e.g.
 *                               https://<account>.r2.cloudflarestorage.com
 *   RELEASES_S3_FORCE_PATH_STYLE "true" for path-style URLs (MinIO)
 *   RELEASES_URL_TTL            Seconds a download link works (default 300)
 *   RELEASES_LISTING_TTL        Seconds a bucket listing is cached (default 300)
 *   RELEASES_GPG_PUBLIC_KEY_URL Where customers get the key SHA256SUMS.asc is
 *                               signed with; linked from the downloads page
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AuditConfig {
    stdout: boolean;
    file: string | null;
    fileKeep: number;
    splunk: {
        url: string;
        token: string;
        index: string | null;
        sourcetype: string;
        insecure: boolean;
    } | null;
    syslog: {
        host: string;
        port: number;
        protocol: 'udp' | 'tcp' | 'tls';
        facility: string;
    } | null;
    retentionDays: number;
}

export interface ReleasesConfig {
    bucket: string;
    region: string;
    endpoint: string | null;
    forcePathStyle: boolean;
    /** Seconds. */
    urlTtl: number;
    /** Seconds. */
    listingTtl: number;
    gpgPublicKeyUrl: string | null;
}

export interface Config {
    publicUrl: string;
    dataDir: string;
    databasePath: string;
    signingKeyPem: string | null;
    signingKeyFile: string | null;
    signingKeyP256Pem: string | null;
    signingKeyP256File: string | null;
    trustedKeys: string[];
    adminEmails: Set<string>;
    smtpUrl: string | null;
    mailFrom: string;
    cookieSecure: boolean;
    audit: AuditConfig;
    /** Null when RELEASES_S3_BUCKET is unset: no downloads. */
    releases: ReleasesConfig | null;
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
        signingKeyP256Pem: env.LICENSE_SIGNING_KEY_P256?.trim() || null,
        signingKeyP256File: env.LICENSE_SIGNING_KEY_P256_FILE?.trim() || null,
        trustedKeys: list(env.LICENSE_TRUSTED_KEYS),
        adminEmails: new Set(list(env.ADMIN_EMAILS).map((e) => e.toLowerCase())),
        smtpUrl: env.SMTP_URL?.trim() || null,
        mailFrom: env.MAIL_FROM ?? 'ENS Solutions <licensing@ens-solutions.com>',
        cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== 'false' : publicUrl.startsWith('https:'),
        audit: auditConfig(env),
        releases: releasesConfig(env),
    };
    return cached;
}

const flag = (v: string | undefined, fallback: boolean) => (v === undefined || v.trim() === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim()));
const int = (v: string | undefined, fallback: number) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function auditConfig(env: NodeJS.ProcessEnv): AuditConfig {
    const splunkUrl = env.ENS_AUDIT_SPLUNK_URL?.trim().replace(/\/+$/, '') || '';
    let splunkToken = env.ENS_AUDIT_SPLUNK_TOKEN?.trim() || '';
    const tokenFile = env.ENS_AUDIT_SPLUNK_TOKEN_FILE?.trim();
    if (!splunkToken && tokenFile) {
        splunkToken = readFileSync(tokenFile, 'utf8').trim();
    }
    const syslogHost = env.ENS_AUDIT_SYSLOG_HOST?.trim() || '';
    const protocol = (env.ENS_AUDIT_SYSLOG_PROTOCOL?.trim().toLowerCase() || 'tcp') as 'udp' | 'tcp' | 'tls';
    if (!['udp', 'tcp', 'tls'].includes(protocol)) {
        throw new Error(`ENS_AUDIT_SYSLOG_PROTOCOL must be udp, tcp or tls, not ${protocol}`);
    }
    return {
        stdout: flag(env.ENS_AUDIT_STDOUT, true),
        file: env.ENS_AUDIT_FILE?.trim() || null,
        fileKeep: int(env.ENS_AUDIT_FILE_KEEP, 30),
        splunk: splunkUrl
            ? {
                  url: splunkUrl,
                  token: splunkToken,
                  index: env.ENS_AUDIT_SPLUNK_INDEX?.trim() || null,
                  sourcetype: env.ENS_AUDIT_SPLUNK_SOURCETYPE?.trim() || 'ens:audit',
                  insecure: flag(env.ENS_AUDIT_SPLUNK_INSECURE, false),
              }
            : null,
        syslog: syslogHost
            ? {
                  host: syslogHost,
                  port: int(env.ENS_AUDIT_SYSLOG_PORT, protocol === 'tls' ? 6514 : 514),
                  protocol,
                  facility: env.ENS_AUDIT_SYSLOG_FACILITY?.trim().toLowerCase() || 'local0',
              }
            : null,
        retentionDays: int(env.ENS_AUDIT_RETENTION_DAYS, 0),
    };
}

/** A presigned URL can't outlive seven days (SigV4). */
const MAX_URL_TTL = 7 * 24 * 60 * 60;

function releasesConfig(env: NodeJS.ProcessEnv): ReleasesConfig | null {
    const bucket = env.RELEASES_S3_BUCKET?.trim();
    if (!bucket) return null;
    const seconds = (v: string | undefined, fallback: number) => {
        const n = int(v, fallback);
        return n > 0 ? n : fallback;
    };
    return {
        bucket,
        region: env.RELEASES_S3_REGION?.trim() || 'us-east-1',
        endpoint: env.RELEASES_S3_ENDPOINT?.trim().replace(/\/+$/, '') || null,
        forcePathStyle: flag(env.RELEASES_S3_FORCE_PATH_STYLE, false),
        urlTtl: Math.min(seconds(env.RELEASES_URL_TTL, 300), MAX_URL_TTL),
        listingTtl: seconds(env.RELEASES_LISTING_TTL, 300),
        gpgPublicKeyUrl: env.RELEASES_GPG_PUBLIC_KEY_URL?.trim() || null,
    };
}

/** Tests change the environment between cases. */
export function resetConfigForTests(): void {
    cached = null;
}
