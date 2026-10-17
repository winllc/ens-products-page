/*
 * The license file: what it says, how it is signed, and how it is checked.
 *
 * A license file is plain text. A readable summary at the top is for people
 * and is ignored by every verifier; the license itself is one or more armored
 * tokens below it:
 *
 *     -----BEGIN ENS LICENSE-----
 *     <key id>.<payload>.<signature>
 *     -----END ENS LICENSE-----
 *
 * <payload> is the license JSON, UTF-8, base64url without padding.
 * <signature> is over the ASCII bytes "<key id>.<payload>", base64url.
 * <key id> names the ENS signing key, so keys can be rotated: applications
 * ship with every public key they trust, keyed by id. The key, not the
 * file, says which algorithm the signature uses:
 *
 *   - Ed25519 (the signature is the 64 raw bytes), and
 *   - ECDSA P-256 with SHA-256 (the signature is DER, as Java's
 *     SHA256withECDSA and Node's default produce), for Java runtimes in
 *     FIPS mode, which have no Ed25519.
 *
 * A file may carry the same payload signed with several keys, one armored
 * block per signature, Ed25519 first. A verifier accepts the file if any
 * block verifies with a key it trusts and an algorithm it has, preferring
 * Ed25519. Every block must carry the same payload. Verifiers from before
 * ECDSA (ens-license 1.0.0) read only the first block, so a dual-signed file
 * still works there.
 *
 * Both algorithms are in the JDK (Ed25519 since Java 15) and in Node's crypto
 * module, so neither the applications nor this site need a crypto library,
 * and verification needs no network: it works on an air-gapped enclave.
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

/** The signature algorithms a license may be signed with, most preferred first. */
export const SIGNATURE_ALGORITHMS = ['Ed25519', 'ECDSA-P256'] as const;
export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

/** As people should read it. */
export const algorithmName: Record<SignatureAlgorithm, string> = { Ed25519: 'Ed25519', 'ECDSA-P256': 'ECDSA P-256' };

/** Which license signature algorithm a key is for, or null if it is for neither. */
export function keyAlgorithm(key: KeyObject): SignatureAlgorithm | null {
    if (key.asymmetricKeyType === 'ed25519') return 'Ed25519';
    if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return 'ECDSA-P256';
    return null;
}

function describeKey(key: KeyObject): string {
    const curve = key.asymmetricKeyDetails?.namedCurve;
    return curve ? `${key.asymmetricKeyType} ${curve}` : String(key.asymmetricKeyType);
}

/**
 * A key id is the first 16 hex digits of the SHA-256 of the public key's SPKI
 * encoding. The SPKI names the algorithm (and the curve), so the id
 * identifies the algorithm as well as the key.
 */
export function keyIdFor(publicKey: KeyObject): string {
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export interface SigningKey {
    id: string;
    algorithm: SignatureAlgorithm;
    privateKey: KeyObject;
    publicKey: KeyObject;
}

/** A private key, refused unless it is for the algorithm expected (Ed25519 unless told otherwise). */
export function signingKeyFromPem(pem: string, algorithm: SignatureAlgorithm = 'Ed25519'): SigningKey {
    const privateKey = createPrivateKey(pem);
    if (keyAlgorithm(privateKey) !== algorithm) {
        throw new Error(`License signing key must be ${algorithmName[algorithm]}, not ${describeKey(privateKey)}`);
    }
    const publicKey = createPublicKey(privateKey);
    return { id: keyIdFor(publicKey), algorithm, privateKey, publicKey };
}

/** A trusted public key from its base64 SPKI DER, refused unless it is Ed25519 or ECDSA P-256. */
export function publicKeyFromBase64(b64: string): KeyObject {
    const key = createPublicKey({ key: Buffer.from(b64.trim(), 'base64'), format: 'der', type: 'spki' });
    if (!keyAlgorithm(key)) {
        throw new Error(`License public keys must be Ed25519 or ECDSA P-256, not ${describeKey(key)}`);
    }
    return key;
}

/** The public half as base64 SPKI DER, the form the applications embed. */
export function publicKeyBase64(key: KeyObject): string {
    return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

/* ---------------------------------------------------------------- *
 * Encoding
 * ---------------------------------------------------------------- */

const b64url = (buf: Buffer) => buf.toString('base64url');

const preference = (a: { algorithm: SignatureAlgorithm }, b: { algorithm: SignatureAlgorithm }) =>
    SIGNATURE_ALGORITHMS.indexOf(a.algorithm) - SIGNATURE_ALGORITHMS.indexOf(b.algorithm);

function signBytes(data: Buffer, key: SigningKey): Buffer {
    return key.algorithm === 'Ed25519' ? sign(null, data, key.privateKey) : sign('sha256', data, { key: key.privateKey, dsaEncoding: 'der' });
}

function verifyBytes(data: Buffer, key: KeyObject, algorithm: SignatureAlgorithm, signature: Buffer): boolean {
    return algorithm === 'Ed25519' ? verify(null, data, key, signature) : verify('sha256', data, { key, dsaEncoding: 'der' }, signature);
}

/**
 * One token per key, all over the same payload, Ed25519 first: verifiers
 * from before ECDSA read only the first block of a file.
 */
export function signTokens(payload: LicensePayload, keys: readonly SigningKey[]): string[] {
    if (keys.length === 0) {
        throw new Error('At least one signing key is required');
    }
    const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return [...keys].sort(preference).map((key) => {
        const signed = `${key.id}.${body}`;
        return `${signed}.${b64url(signBytes(Buffer.from(signed, 'ascii'), key))}`;
    });
}

export function signToken(payload: LicensePayload, key: SigningKey): string {
    return signTokens(payload, [key])[0]!;
}

function wrap(text: string, width = 64): string {
    const lines: string[] = [];
    for (let i = 0; i < text.length; i += width) {
        lines.push(text.slice(i, i + width));
    }
    return lines.join('\n');
}

/**
 * The readable summary written above the tokens. Pass the algorithms the file
 * is signed with when there is more than one, so people can tell why.
 */
export function summaryLines(
    p: LicensePayload,
    names: { product: string; edition: string },
    signatures: readonly SignatureAlgorithm[] = [],
): string[] {
    const who = p.licensee.organization ? `${p.licensee.name}, ${p.licensee.organization}` : p.licensee.name;
    const several = signatures.length > 1;
    return [
        'ENS Solutions license file',
        `This file is signed. Any change to the ${several ? 'blocks' : 'block'} below makes it invalid.`,
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
        ...(several
            ? [
                  `Signatures:   ${signatures.map((a) => algorithmName[a]).join(', ')} (one block each, same license).`,
                  '              Java in FIPS mode uses the ECDSA P-256 one. Keep them all.',
              ]
            : []),
    ];
}

/** The file: the summary as comments, then each token in its own armored block. */
export function licenseFile(tokens: string | readonly string[], summary: string[]): string {
    const blocks = (typeof tokens === 'string' ? [tokens] : tokens).map((t) => `${BEGIN}\n${wrap(t)}\n${END}\n`);
    return `${summary.map((l) => (l ? `# ${l}` : '#')).join('\n')}\n${blocks.join('')}`;
}

/* ---------------------------------------------------------------- *
 * Verification
 * ---------------------------------------------------------------- */

export class LicenseError extends Error {
    constructor(
        readonly code: 'malformed' | 'unknown-key' | 'bad-signature' | 'unsupported-format' | 'unsupported-algorithm',
        message: string,
    ) {
        super(message);
        this.name = 'LicenseError';
    }
}

/** Pulls the tokens out of a license file, one per armored block, or accepts a bare token. */
export function extractTokens(text: string): string[] {
    const tokens: string[] = [];
    let from = 0;
    for (;;) {
        const start = text.indexOf(BEGIN, from);
        const end = start < 0 ? -1 : text.indexOf(END, start + BEGIN.length);
        if (end < 0) break;
        tokens.push(text.slice(start + BEGIN.length, end).replace(/\s+/g, ''));
        from = end + END.length;
    }
    return tokens.length > 0 ? tokens : [text.replace(/\s+/g, '')];
}

/** The first token: the one a verifier from before ECDSA reads. */
export function extractToken(text: string): string {
    return extractTokens(text)[0]!;
}

interface Token {
    kid: string;
    payload: string;
    signature: string;
}

function parseTokens(text: string): Token[] {
    return extractTokens(text).map((token) => {
        const parts = token.split('.');
        if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
            throw new LicenseError('malformed', 'Not an ENS license');
        }
        const [kid, payload, signature] = parts as [string, string, string];
        return { kid, payload, signature };
    });
}

export interface VerifiedLicense {
    payload: LicensePayload;
    /** The key whose signature was accepted. */
    keyId: string;
    algorithm: SignatureAlgorithm;
}

/**
 * Checks the signatures against the trusted public keys, by key id, and
 * returns the payload with the key that vouched for it. Ed25519 is tried
 * first; `algorithms` limits which are tried, e.g. ['ECDSA-P256'] to check a
 * file the way a Java runtime in FIPS mode will. Says nothing about dates or
 * binding: see licenseState.
 */
export function verifyLicenseDetailed(
    text: string,
    trusted: ReadonlyMap<string, KeyObject>,
    options: { algorithms?: readonly SignatureAlgorithm[] } = {},
): VerifiedLicense {
    const tokens = parseTokens(text);
    const payload = tokens[0]!.payload;
    if (tokens.some((t) => t.payload !== payload)) {
        throw new LicenseError('malformed', 'The file holds blocks for different licenses; use the file as it was issued');
    }
    const candidates = tokens
        .flatMap((t) => {
            const key = trusted.get(t.kid);
            const algorithm = key ? keyAlgorithm(key) : null;
            return key && algorithm ? [{ ...t, key, algorithm }] : [];
        })
        .sort(preference);
    if (candidates.length === 0) {
        throw new LicenseError('unknown-key', `Signed with an unknown key (${tokens.map((t) => t.kid).join(', ')})`);
    }
    const allowed = options.algorithms ?? SIGNATURE_ALGORITHMS;
    let mismatch = false;
    for (const c of candidates) {
        if (!allowed.includes(c.algorithm)) continue;
        if (verifyBytes(Buffer.from(`${c.kid}.${payload}`, 'ascii'), c.key, c.algorithm, Buffer.from(c.signature, 'base64url'))) {
            return { payload: parsePayload(payload), keyId: c.kid, algorithm: c.algorithm };
        }
        mismatch = true;
    }
    if (mismatch) {
        throw new LicenseError('bad-signature', 'The signature does not match; the file was changed or damaged');
    }
    const signedWith = [...new Set(candidates.map((c) => algorithmName[c.algorithm]))].join(' and ');
    throw new LicenseError(
        'unsupported-algorithm',
        `The file is signed only with ${signedWith}, which this check does not accept; ask ENS Solutions for a file with an ECDSA P-256 signature`,
    );
}

/** verifyLicenseDetailed, for callers that only need the payload. */
export function verifyLicense(text: string, trusted: ReadonlyMap<string, KeyObject>): LicensePayload {
    return verifyLicenseDetailed(text, trusted).payload;
}

function parsePayload(payload: string): LicensePayload {
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
