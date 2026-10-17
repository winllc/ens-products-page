import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { featuresFor } from '../../data/licensing';
import { buildPayload, normalizeInstallationId } from './issue';
import {
    LicenseError,
    extractTokens,
    licenseFile,
    licenseState,
    publicKeyBase64,
    publicKeyFromBase64,
    signToken,
    signTokens,
    signingKeyFromPem,
    summaryLines,
    verifyLicense,
    verifyLicenseDetailed,
} from './license';

function key() {
    const { privateKey } = generateKeyPairSync('ed25519');
    return signingKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
}

function p256Key() {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    return signingKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'ECDSA-P256');
}

const licensee = { name: 'Pat Rivera', organization: 'Example Agency', email: 'Pat@Example.gov ' };
const now = new Date('2026-10-14T12:00:00Z');

describe('license files', () => {
    const k = key();
    const trusted = new Map([[k.id, k.publicKey]]);
    const payload = buildPayload({ product: 'certalert', edition: 'evaluation', licensee }, { id: 'lic_test', revision: 1, now });
    const file = licenseFile(signToken(payload, k), summaryLines(payload, { product: 'CertAlert', edition: 'Evaluation' }));

    it('round-trips through the armored file', () => {
        expect(file).toContain('-----BEGIN ENS LICENSE-----');
        expect(file).toContain('# Product:      CertAlert');
        expect(verifyLicense(file, trusted)).toEqual(payload);
    });

    it('ignores the readable summary, so editing it changes nothing', () => {
        expect(verifyLicense(file.replace('Example Agency', 'Someone Else'), trusted).licensee.organization).toBe('Example Agency');
    });

    it('rejects a changed payload', () => {
        const token = signToken(payload, k);
        const [kid, body, sig] = token.split('.') as [string, string, string];
        const forged = Buffer.from(JSON.stringify({ ...payload, limit: { ...payload.limit, quantity: 1_000_000 } })).toString('base64url');
        expect(() => verifyLicense(`${kid}.${forged}.${sig}`, trusted)).toThrow(LicenseError);
        expect(() => verifyLicense(`${kid}.${body}.${sig}`, trusted)).not.toThrow();
    });

    it('rejects a key it does not trust', () => {
        const other = key();
        expect(() => verifyLicense(signToken(payload, other), trusted)).toThrow(/unknown key/);
    });

    it('rejects junk', () => {
        expect(() => verifyLicense('hello', trusted)).toThrow(/Not an ENS license/);
    });
});

describe('ECDSA P-256 signatures, for Java in FIPS mode', () => {
    const ed = key();
    const ec = p256Key();
    const trusted = new Map([
        [ed.id, ed.publicKey],
        [ec.id, ec.publicKey],
    ]);
    const payload = buildPayload({ product: 'certalert', edition: 'subscription', licensee, quantity: 10_000 }, { id: 'lic_p256', revision: 1, now });
    const names = { product: 'CertAlert', edition: 'Subscription' };
    const dual = licenseFile(signTokens(payload, [ec, ed]), summaryLines(payload, names, ['Ed25519', 'ECDSA-P256']));

    it('signs with each key over the same payload, Ed25519 first whatever the order given', () => {
        const tokens = extractTokens(dual);
        expect(tokens.map((t) => t.split('.')[0])).toEqual([ed.id, ec.id]);
        expect(new Set(tokens.map((t) => t.split('.')[1])).size).toBe(1);
        expect(dual.match(/-----BEGIN ENS LICENSE-----/g)).toHaveLength(2);
        // DER-encoded ECDSA, as Java's SHA256withECDSA expects.
        expect(Buffer.from(tokens[1]!.split('.')[2]!, 'base64url')[0]).toBe(0x30);
    });

    it('prefers Ed25519 and falls back to P-256', () => {
        expect(verifyLicenseDetailed(dual, trusted)).toMatchObject({ keyId: ed.id, algorithm: 'Ed25519', payload });
        expect(verifyLicenseDetailed(dual, trusted, { algorithms: ['ECDSA-P256'] })).toMatchObject({ keyId: ec.id, algorithm: 'ECDSA-P256', payload });
        expect(verifyLicenseDetailed(dual, new Map([[ec.id, ec.publicKey]])).keyId).toBe(ec.id);
        expect(verifyLicense(signToken(payload, ec), trusted)).toEqual(payload);
    });

    it('says why an Ed25519-only file fails without Ed25519', () => {
        expect(() => verifyLicenseDetailed(signToken(payload, ed), trusted, { algorithms: ['ECDSA-P256'] })).toThrow(/ECDSA P-256 signature/);
    });

    it('rejects a changed payload or signature', () => {
        const [kid, , sig] = signToken(payload, ec).split('.') as [string, string, string];
        const forged = Buffer.from(JSON.stringify({ ...payload, limit: { ...payload.limit, quantity: 1_000_000 } })).toString('base64url');
        expect(() => verifyLicense(`${kid}.${forged}.${sig}`, trusted)).toThrow(expect.objectContaining({ code: 'bad-signature' }));
        const [, body] = signToken(payload, ec).split('.');
        const other = signToken({ ...payload, id: 'lic_other' }, ec).split('.')[2];
        expect(() => verifyLicense(`${kid}.${body}.${other}`, trusted)).toThrow(expect.objectContaining({ code: 'bad-signature' }));
    });

    it('accepts any good signature from a trusted key', () => {
        const [first, second] = extractTokens(dual) as [string, string];
        const broken = first.replace(/\.[^.]+$/, `.${Buffer.alloc(64).toString('base64url')}`);
        expect(verifyLicenseDetailed(licenseFile([broken, second], []), trusted).keyId).toBe(ec.id);
        expect(() => verifyLicense(licenseFile([broken, second], []), new Map([[ed.id, ed.publicKey]]))).toThrow(/does not match/);
    });

    it('refuses blocks for different licenses in one file', () => {
        const other = signToken({ ...payload, id: 'lic_other' }, ec);
        expect(() => verifyLicense(licenseFile([signToken(payload, ed), other], []), trusted)).toThrow(/different licenses/);
    });

    it('accepts only Ed25519 and P-256 keys, each where it is expected', () => {
        const ed25519Pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const p384Pem = generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        expect(() => signingKeyFromPem(ed25519Pem, 'ECDSA-P256')).toThrow(/must be ECDSA P-256, not ed25519/);
        expect(() => signingKeyFromPem(p384Pem, 'ECDSA-P256')).toThrow(/secp384r1/);
        expect(() => signingKeyFromPem(ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow(/must be Ed25519/);
        const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
        expect(() => publicKeyFromBase64(publicKeyBase64(rsa))).toThrow(/Ed25519 or ECDSA P-256/);
        expect(publicKeyFromBase64(publicKeyBase64(ec.publicKey)).asymmetricKeyType).toBe('ec');
    });

    it('names the signatures in the summary only when there are several', () => {
        expect(summaryLines(payload, names).join('\n')).not.toContain('Signatures');
        expect(summaryLines(payload, names, ['Ed25519']).join('\n')).not.toContain('Signatures');
        expect(dual).toContain('# Signatures:   Ed25519, ECDSA P-256');
        expect(dual).toContain('Any change to the blocks below');
    });
});

describe('issuing', () => {
    it('sizes an evaluation at the smallest band, for 30 days, watermarked, with every feature', () => {
        const p = buildPayload({ product: 'certalert', edition: 'evaluation', licensee, quantity: 99_999 }, { id: 'x', revision: 1, now });
        expect(p.limit).toEqual({ quantity: 2_500, unit: 'directory users' });
        expect(p.expiresAt).toBe('2026-11-13T12:00:00.000Z');
        expect(p.watermark).toBe(true);
        expect(p.features).toContain('certalert.multi-directory');
        expect(p.licensee.email).toBe('pat@example.gov');
    });

    it('keeps Enterprise features for the Enterprise band', () => {
        const small = buildPayload({ product: 'certalert', edition: 'subscription', licensee, quantity: 10_000 }, { id: 'x', revision: 1, now });
        const big = buildPayload({ product: 'certalert', edition: 'subscription', licensee, quantity: 80_000 }, { id: 'x', revision: 1, now });
        expect(small.features).not.toContain('certalert.multi-directory');
        expect(big.features).toContain('certalert.multi-directory');
        expect(small.graceDays).toBe(30);
    });

    it('gives a perpetual license no expiry and a year of maintenance', () => {
        const p = buildPayload({ product: 'readyroom', edition: 'perpetual', licensee, quantity: 400 }, { id: 'x', revision: 1, now });
        expect(p.expiresAt).toBeNull();
        expect(p.maintenanceUntil).toBe('2027-10-14T12:00:00.000Z');
        expect(licenseState(p, new Date('2040-01-01')).state).toBe('valid');
    });

    it('counts subscription terms in calendar years', () => {
        const leap = buildPayload(
            { product: 'certalert', edition: 'subscription', licensee, quantity: 100, years: 1, start: new Date('2028-02-29T00:00:00Z') },
            { id: 'x', revision: 1, now },
        );
        expect(leap.expiresAt).toBe('2029-02-28T00:00:00.000Z');
        const days = buildPayload({ product: 'certalert', edition: 'subscription', licensee, quantity: 100, days: 45 }, { id: 'x', revision: 1, now });
        expect(days.expiresAt).toBe('2026-11-28T12:00:00.000Z');
        expect(() => buildPayload({ product: 'certalert', edition: 'subscription', licensee, quantity: 100, years: 0 }, { id: 'x', revision: 1, now })).toThrow();
    });

    it('normalizes installation ids', () => {
        expect(normalizeInstallationId(' ca-7f3k-29qd ')).toBe('CA-7F3K-29QD');
        expect(normalizeInstallationId('')).toBeNull();
        expect(() => normalizeInstallationId('no spaces allowed')).toThrow();
    });

    it('lists every feature id with its product prefix', () => {
        expect(featuresFor('readyroom', 'subscription', false).every((f) => f.startsWith('readyroom.'))).toBe(true);
    });
});

describe('license state', () => {
    const p = buildPayload({ product: 'mfa-portal', edition: 'subscription', licensee, quantity: 5_000 }, { id: 'x', revision: 1, now });

    it('moves from valid to grace to expired', () => {
        expect(licenseState(p, new Date('2026-10-01')).state).toBe('not-yet-valid');
        expect(licenseState(p, new Date('2027-10-13T12:00:00Z'))).toEqual({ state: 'valid', daysLeft: 1 });
        expect(licenseState(p, new Date('2027-10-20T12:00:00Z')).state).toBe('grace');
        expect(licenseState(p, new Date('2027-11-14T12:00:00Z')).state).toBe('expired');
    });
});
