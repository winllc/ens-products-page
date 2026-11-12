/*
 * syncd's license file. syncd does not read the ENS format the other
 * applications share: it reads its own, specified for the issuer in
 * ldap-sync-merge-view's docs/LICENSE-FORMAT.md (reference implementation
 * engine/crates/licensing/src/format.rs). This writes and checks that format;
 * everything else about a syncd license (the payload the portal stores, its
 * revisions, binding, renewal) is the same as for any other product.
 *
 * The file is a JSON envelope:
 *
 *   { "syncd_license": 1, "key_id": "...", "payload": "<base64>", "signature": "<base64>" }
 *
 * `payload` is the claims JSON, base64 with the standard alphabet and padding;
 * `signature` is ECDSA P-256 / SHA-256, DER, over exactly the decoded payload
 * bytes. syncd verifies only P-256, so a syncd license needs the portal's
 * P-256 key (LICENSE_SIGNING_KEY_P256). The key id is computed the same way
 * as for ENS files.
 *
 * syncd ignores claims and envelope fields it does not know. The portal uses
 * that to carry the ENS payload in the claims (`ens`), so the account pages
 * can say which license and revision a file is, and the readable summary in
 * the envelope (`summary`), which is not signed.
 */

import { sign, verify, type KeyObject } from 'node:crypto';
import { productFeatures } from '../../data/licensing';
import { keyAlgorithm, LicenseError, type LicensePayload, type SigningKey } from './license';

export const SYNCD_ENVELOPE_VERSION = 1;
export const SYNCD_CLAIMS_FORMAT = 1;
/** syncd refuses larger files. */
export const SYNCD_MAX_FILE_BYTES = 64 * 1024;
/**
 * syncd needs an expiry on every license; a perpetual one gets this far date
 * ("issue a far date for a perpetual term", LICENSE-FORMAT.md).
 */
export const SYNCD_PERPETUAL_EXPIRY = '9999-12-31T00:00:00Z';

export interface SyncdClaims {
    format: typeof SYNCD_CLAIMS_FORMAT;
    product: 'syncd';
    /** A new id for every revision: syncd treats a change as a new license. */
    license_id: string;
    customer: string;
    issued_at: string;
    not_before: string;
    expires_at: string;
    managed_identities: number;
    /** Pack ids beyond Core. */
    packs: string[];
    installation_id?: string;
    evaluation: boolean;
    /** Informational for syncd: the portal's own record of the license. */
    ens: LicensePayload;
}

export interface SyncdEnvelope {
    syncd_license: typeof SYNCD_ENVELOPE_VERSION;
    key_id: string;
    payload: string;
    signature: string;
    /** Informational, not signed: what the ENS file has as comments. */
    summary?: string[];
}

/** The id syncd shows for one revision of a license. */
export function syncdLicenseId(p: LicensePayload): string {
    return `${p.id}-r${p.revision}`;
}

/**
 * The packs a license names: its enterprise syncd features, whose ids are
 * syncd's pack ids. The standard features are syncd's Core, which every
 * license includes and none names.
 */
export function syncdPacks(p: LicensePayload): string[] {
    const packs = new Set(productFeatures.syncd.filter((f) => f.enterprise).map((f) => f.id));
    return p.features
        .filter((f) => f.startsWith('syncd.'))
        .map((f) => f.slice('syncd.'.length))
        .filter((id) => packs.has(id));
}

export function syncdClaims(p: LicensePayload): SyncdClaims {
    if (p.product !== 'syncd') {
        throw new Error(`Not a syncd license: ${p.product}`);
    }
    return {
        format: SYNCD_CLAIMS_FORMAT,
        product: 'syncd',
        license_id: syncdLicenseId(p),
        customer: p.licensee.organization || p.licensee.name,
        issued_at: p.issuedAt,
        not_before: p.notBefore,
        expires_at: p.expiresAt ?? SYNCD_PERPETUAL_EXPIRY,
        managed_identities: p.limit.quantity,
        packs: syncdPacks(p),
        ...(p.installationId ? { installation_id: p.installationId } : {}),
        evaluation: p.edition === 'evaluation',
        ens: p,
    };
}

/** The signed envelope, as one line of JSON (what the portal stores). */
export function signSyncd(p: LicensePayload, key: SigningKey): string {
    if (key.algorithm !== 'ECDSA-P256') {
        throw new Error('syncd licenses are signed with the ECDSA P-256 key');
    }
    const payload = Buffer.from(JSON.stringify(syncdClaims(p)), 'utf8');
    const envelope: SyncdEnvelope = {
        syncd_license: SYNCD_ENVELOPE_VERSION,
        key_id: key.id,
        payload: payload.toString('base64'),
        signature: sign('sha256', payload, { key: key.privateKey, dsaEncoding: 'der' }).toString('base64'),
    };
    return JSON.stringify(envelope);
}

/** The file: the envelope with the readable summary added, pretty-printed. */
export function syncdLicenseFile(envelope: string, summary: string[]): string {
    const parsed = JSON.parse(envelope) as SyncdEnvelope;
    return `${JSON.stringify({ ...parsed, summary }, null, 2)}\n`;
}

/** Whether `text` is a syncd license file rather than an ENS one. */
export function isSyncdFile(text: string): boolean {
    const t = text.replace(/^﻿/, '').trim();
    if (!t.startsWith('{')) return false;
    try {
        const v = JSON.parse(t) as Record<string, unknown>;
        return v !== null && typeof v === 'object' && 'syncd_license' in v;
    } catch {
        return false;
    }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decode(field: string, value: unknown): Buffer {
    const v = typeof value === 'string' ? value.replace(/[\t\n\f\r ]+/g, '') : null;
    if (v === null || v.length % 4 !== 0 || !BASE64.test(v)) {
        throw new LicenseError('malformed', `The ${field} is not base64`);
    }
    return Buffer.from(v, 'base64');
}

export interface VerifiedSyncdLicense {
    claims: SyncdClaims;
    keyId: string;
}

/**
 * Checks a syncd file as syncd does: the envelope version, a P-256 key it
 * trusts, the signature over the payload bytes, the claims format and
 * product. It also needs the `ens` claim, which only the portal writes.
 */
export function verifySyncdLicense(text: string, trusted: ReadonlyMap<string, KeyObject>): VerifiedSyncdLicense {
    const t = text.replace(/^﻿/, '').trim();
    if (Buffer.byteLength(t, 'utf8') > SYNCD_MAX_FILE_BYTES) {
        throw new LicenseError('malformed', 'The file is too large to be a license');
    }
    let envelope: Partial<SyncdEnvelope>;
    try {
        envelope = JSON.parse(t) as Partial<SyncdEnvelope>;
    } catch {
        throw new LicenseError('malformed', 'Not a syncd license: not JSON');
    }
    if (envelope.syncd_license !== SYNCD_ENVELOPE_VERSION) {
        throw new LicenseError('unsupported-format', `Unsupported syncd license format ${String(envelope.syncd_license)}`);
    }
    const keyId = typeof envelope.key_id === 'string' ? envelope.key_id : '';
    const key = trusted.get(keyId);
    if (!key) {
        throw new LicenseError('unknown-key', `Signed with an unknown key (${keyId || 'none'})`);
    }
    if (keyAlgorithm(key) !== 'ECDSA-P256') {
        throw new LicenseError('unsupported-algorithm', 'A syncd license must be signed with an ECDSA P-256 key');
    }
    const payload = decode('payload', envelope.payload);
    const signature = decode('signature', envelope.signature);
    if (!verify('sha256', payload, { key, dsaEncoding: 'der' }, signature)) {
        throw new LicenseError('bad-signature', 'The signature does not match; the file was changed or damaged');
    }
    let claims: SyncdClaims;
    try {
        claims = JSON.parse(payload.toString('utf8')) as SyncdClaims;
    } catch {
        throw new LicenseError('malformed', 'The license claims are not valid JSON');
    }
    if (claims.format !== SYNCD_CLAIMS_FORMAT) {
        throw new LicenseError('unsupported-format', `Unsupported syncd claims format ${String(claims.format)}`);
    }
    if (claims.product !== 'syncd' || claims.ens?.product !== 'syncd') {
        throw new LicenseError('malformed', 'Not a syncd license');
    }
    return { claims, keyId };
}
