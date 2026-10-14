import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { featuresFor } from '../../data/licensing';
import { buildPayload, normalizeInstallationId } from './issue';
import {
    LicenseError,
    licenseFile,
    licenseState,
    signToken,
    signingKeyFromPem,
    summaryLines,
    verifyLicense,
} from './license';

function key() {
    const { privateKey } = generateKeyPairSync('ed25519');
    return signingKeyFromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
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
