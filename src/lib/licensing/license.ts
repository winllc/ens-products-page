/*
 * The license file: what it says, how it is signed, and how it is checked.
 *
 * A license file is plain text. A readable summary at the top is for people
 * and is ignored by every verifier; the license itself is the armored token
 * below it:
 *
 *     -----BEGIN ENS LICENSE-----
 *     <key id>.<payload>.<signature>
 *     -----END ENS LICENSE-----
 *
 * <payload> is the license JSON, UTF-8, base64url without padding.
 * <signature> is Ed25519 over the ASCII bytes "<key id>.<payload>", base64url.
 * <key id> names the ENS signing key, so keys can be rotated: applications
 * ship with every public key they trust, keyed by id.
 *
 * Ed25519 is in the JDK since Java 15 and in Node's crypto module, so neither
 * the applications nor this site need a crypto library, and verification
 * needs no network: it works on an air-gapped enclave.
 *
 * The Java verifier in licensing/java/ implements the same format; the tests
 * check that it accepts what this file signs.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { Edition } from '../../data/licensing';
import type { SupportTierId } from '../../data/pricing';
import type { ProductId } from '../../data/products';

export const LICENSE_FORMAT = 'ens-license/1';
const BEGIN = '-----BEGIN ENS LICENSE-----';
const END = '-----END ENS LICENSE-----';

export interface LicensePayload {
    format: typeof LICENSE_FORMAT;
    /** Stable for the life of the license; every re-issue keeps it. */
    id: string;
    /** Goes up each time the file is re-issued (binding changed, renewed, extended). */
    revision: number;
    issuer: string;
    product: ProductId;
    edition: Edition;
    licensee: { name: string; organization: string; email: string };
    /** Size the license covers, in the product's unit ("directory users"). */
    limit: { quantity: number; unit: string };
    /** Feature ids it unlocks, "<product>.<feature>". */
    features: string[];
    support: SupportTierId;
    issuedAt: string;
    notBefore: string;
    /** null for a perpetual license. */
    expiresAt: string | null;
    /** Days the application keeps working after expiresAt, with a warning. */
    graceDays: number;
    /** Perpetual: releases built after this date are not covered. null otherwise. */
    maintenanceUntil: string | null;
    /** When set, only the installation reporting this id accepts the file. */
    installationId: string | null;
    /** The application shows an evaluation banner. */
    watermark: boolean;
}

/* ---------------------------------------------------------------- *
 * Keys
 * ---------------------------------------------------------------- */

/** A key id is the first 16 hex digits of the SHA-256 of the public key's SPKI encoding. */
export function keyIdFor(publicKey: KeyObject): string {
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export interface SigningKey {
    id: string;
    privateKey: KeyObject;
    publicKey: KeyObject;
}

export function signingKeyFromPem(pem: string): SigningKey {
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error(`License signing key must be Ed25519, not ${privateKey.asymmetricKeyType}`);
    }
    const publicKey = createPublicKey(privateKey);
    return { id: keyIdFor(publicKey), privateKey, publicKey };
}

/** The public half as base64 SPKI DER, the form the applications embed. */
export function publicKeyBase64(key: KeyObject): string {
    return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

/* ---------------------------------------------------------------- *
 * Encoding
 * ---------------------------------------------------------------- */

const b64url = (buf: Buffer) => buf.toString('base64url');

export function signToken(payload: LicensePayload, key: SigningKey): string {
    const body = `${key.id}.${b64url(Buffer.from(JSON.stringify(payload), 'utf8'))}`;
    const signature = sign(null, Buffer.from(body, 'ascii'), key.privateKey);
    return `${body}.${b64url(signature)}`;
}

function wrap(text: string, width = 64): string {
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += width) {
        lines.push(text.slice(i, i + width));
    }
    return lines.join('\n');
}

/** The readable summary written above the token. */
export function summaryLines(p: LicensePayload, names: { product: string; edition: string }): string[] {
    const who = p.licensee.organization ? `${p.licensee.name}, ${p.licensee.organization}` : p.licensee.name;
    return [
        'ENS Solutions license file',
        'This file is signed. Any change to the block below makes it invalid.',
        '',
        `Product:      ${names.product}`,
        `Edition:      ${names.edition}`,
        `Licensee:     ${who}`,
        `Covers:       ${p.limit.quantity.toLocaleString('en-US')} ${p.limit.unit}`,
        `Valid from:   ${p.notBefore.slice(0, 10)}`,
        `Expires:      ${p.expiresAt ? p.expiresAt.slice(0, 10) : 'never (perpetual)'}`,
        ...(p.maintenanceUntil ? [`Maintenance:  releases up to ${p.maintenanceUntil.slice(0, 10)}`] : []),
        ...(p.installationId ? [`Installation: ${p.installationId}`] : []),
        `License id:   ${p.id} (revision ${p.revision})`,
    ];
}

export function licenseFile(token: string, summary: string[]): string {
    return `${summary.map((l) => (l ? `# ${l}` : '#')).join('\n')}\n${BEGIN}\n${wrap(token)}\n${END}\n`;
}

/* ---------------------------------------------------------------- *
 * Verification
 * ---------------------------------------------------------------- */

export class LicenseError extends Error {
    constructor(
        readonly code: 'malformed' | 'unknown-key' | 'bad-signature' | 'unsupported-format',
        message: string,
    ) {
        super(message);
        this.name = 'LicenseError';
    }
}

/** Pulls the token out of a license file, or accepts a bare token. */
export function extractToken(text: string): string {
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END);
    const inner = start >= 0 && end > start ? text.slice(start + BEGIN.length, end) : text;
    return inner.replace(/\s+/g, '');
}

/**
 * Checks the signature against the trusted public keys, by key id, and
 * returns the payload. Says nothing about dates or binding: see licenseStatus.
 */
export function verifyLicense(text: string, trusted: ReadonlyMap<string, KeyObject>): LicensePayload {
    const token = extractToken(text);
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
        throw new LicenseError('malformed', 'Not an ENS license');
    }
    const [kid, payload, signature] = parts as [string, string, string];
    const key = trusted.get(kid);
    if (!key) {
        throw new LicenseError('unknown-key', `Signed with an unknown key (${kid})`);
    }
    const ok = verify(null, Buffer.from(`${kid}.${payload}`, 'ascii'), key, Buffer.from(signature, 'base64url'));
    if (!ok) {
        throw new LicenseError('bad-signature', 'The signature does not match; the file was changed or damaged');
    }
    let parsed: LicensePayload;
    try {
        parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LicensePayload;
    } catch {
        throw new LicenseError('malformed', 'The license payload is not valid JSON');
    }
    if (parsed.format !== LICENSE_FORMAT) {
        throw new LicenseError('unsupported-format', `Unsupported license format ${String(parsed.format)}`);
    }
    return parsed;
}

export type LicenseState = 'valid' | 'grace' | 'expired' | 'not-yet-valid';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Where a license stands on a given date. The applications apply the same
 * rules (see licensing/java/), so the portal and the app always agree.
 */
export function licenseState(p: LicensePayload, now = new Date()): { state: LicenseState; daysLeft: number | null } {
    const t = now.getTime();
    if (t < Date.parse(p.notBefore)) {
        return { state: 'not-yet-valid', daysLeft: null };
    }
    if (p.expiresAt === null) {
        return { state: 'valid', daysLeft: null };
    }
    const expires = Date.parse(p.expiresAt);
    if (t < expires) {
        return { state: 'valid', daysLeft: Math.ceil((expires - t) / DAY) };
    }
    if (t < expires + p.graceDays * DAY) {
        return { state: 'grace', daysLeft: Math.ceil((expires + p.graceDays * DAY - t) / DAY) };
    }
    return { state: 'expired', daysLeft: 0 };
}
