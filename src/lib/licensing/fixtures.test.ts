/*
 * Cross-language fixtures in licensing/fixtures/, signed by this code with
 * fixed TEST keys, for the Java verifier's tests (licensing/java).
 *
 * Ed25519 is deterministic, so the Ed25519-only fixtures are reproducible:
 * this test fails if the committed files ever differ from what the current
 * code produces. ECDSA is not (each signature uses a fresh random nonce), so
 * for files with a P-256 signature the test checks everything else exactly
 * (the summary, the layout, every key id and payload, the Ed25519 signature)
 * and that the committed P-256 signature verifies.
 *
 *     WRITE_FIXTURES=1 npx vitest run src/lib/licensing/fixtures.test.ts
 *
 * regenerates them after an intentional format change. It leaves a P-256
 * fixture alone while it still checks out, so its signature doesn't churn.
 *
 * The test keys are derived from published values: the Ed25519 seed and the
 * P-256 private scalar are both 0x07 repeated 32 times. They are for tests
 * only and must never be trusted by a shipped application.
 */

import { createECDH, createPrivateKey, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { editions } from '../../data/licensing';
import { product } from '../../data/products';
import { buildPayload, type IssueRequest } from './issue';
import {
    extractTokens,
    licenseFile,
    publicKeyBase64,
    signTokens,
    signingKeyFromPem,
    summaryLines,
    verifyLicense,
    verifyLicenseDetailed,
    type SigningKey,
} from './license';

const SEED = Buffer.alloc(32, 7); // 0x07 x 32: TEST ONLY
const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]);
const pem = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' }).toString();
const key = signingKeyFromPem(pem);

const SCALAR = Buffer.alloc(32, 7); // 0x07 x 32: TEST ONLY
const point = (() => {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(SCALAR);
    return ecdh.getPublicKey(); // 04 || x || y
})();
const p256Pem = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: SCALAR.toString('base64url'), x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
    format: 'jwk',
})
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
const p256 = signingKeyFromPem(p256Pem, 'ECDSA-P256');

const dir = resolve(__dirname, '../../../licensing/fixtures');
const licensee = { name: 'Pat Rivera', organization: 'Example Agency', email: 'pat@example.gov' };
const now = new Date('2026-10-14T00:00:00Z');

const cases: Record<string, { req: IssueRequest; id: string; revision: number; keys: SigningKey[] }> = {
    'subscription.lic': {
        req: { product: 'certalert', edition: 'subscription', licensee, quantity: 10_000, support: 'mission', start: now, years: 1 },
        id: 'lic_00000000000000000001',
        revision: 3,
        keys: [key],
    },
    'evaluation-bound.lic': {
        req: { product: 'readyroom', edition: 'evaluation', licensee: { ...licensee, organization: 'Agência Ñandú "Test"' }, start: now, installationId: 'RR-TEST-0001' },
        id: 'lic_00000000000000000002',
        revision: 1,
        keys: [key],
    },
    'perpetual.lic': {
        req: { product: 'directory-portal', edition: 'perpetual', licensee, quantity: 2_000, start: now, years: 1 },
        id: 'lic_00000000000000000003',
        revision: 1,
        keys: [key],
    },
    // What the portal issues once LICENSE_SIGNING_KEY_P256 is set.
    'dual-signed.lic': {
        req: { product: 'certalert', edition: 'subscription', licensee, quantity: 10_000, support: 'mission', start: now, years: 1 },
        id: 'lic_00000000000000000004',
        revision: 1,
        keys: [key, p256],
    },
    // Not issued today; a verifier must still accept it.
    'p256-only.lic': {
        req: { product: 'mfa-portal', edition: 'subscription', licensee, quantity: 5_000, start: now, years: 1 },
        id: 'lic_00000000000000000005',
        revision: 1,
        keys: [p256],
    },
};

const trusted = new Map<string, KeyObject>([
    [key.id, key.publicKey],
    [p256.id, p256.publicKey],
]);

function payloadOf(name: string) {
    const c = cases[name]!;
    return buildPayload(c.req, { id: c.id, revision: c.revision, now });
}

function summaryOf(name: string): string[] {
    const payload = payloadOf(name);
    return summaryLines(
        payload,
        { product: product(payload.product).name, edition: editions[payload.edition].name },
        cases[name]!.keys.map((k) => k.algorithm),
    );
}

function render(name: string): string {
    return licenseFile(signTokens(payloadOf(name), cases[name]!.keys), summaryOf(name));
}

/** The file with its limit raised in every block and the old signatures kept. */
function tamper(file: string): string {
    const blocks = extractTokens(file).map((token) => {
        const [kid, body, sig] = token.split('.') as [string, string, string];
        const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        json.limit.quantity = 1_000_000;
        return `-----BEGIN ENS LICENSE-----\n${kid}.${Buffer.from(JSON.stringify(json)).toString('base64url')}.${sig}\n-----END ENS LICENSE-----\n`;
    });
    return blocks.join('');
}

const committed = (name: string) => readFileSync(resolve(dir, name), 'utf8');

/**
 * Whether a committed file is what the code makes, short of the P-256
 * signatures, which must instead verify.
 */
function matches(name: string, file: string): boolean {
    const madeTokens = extractTokens(render(name));
    const fileTokens = extractTokens(file);
    if (madeTokens.length !== fileTokens.length) return false;
    for (const [i, t] of fileTokens.entries()) {
        const [kid, body, sig] = t.split('.');
        const [madeKid, madeBody, madeSig] = madeTokens[i]!.split('.');
        if (kid !== madeKid || body !== madeBody) return false;
        if (kid === p256.id) {
            try {
                if (verifyLicenseDetailed(`${kid}.${body}.${sig}`, trusted).keyId !== p256.id) return false;
            } catch {
                return false;
            }
        } else if (sig !== madeSig) {
            return false;
        }
    }
    // Summary and layout exactly as the code writes them, around those tokens.
    return file === licenseFile(fileTokens, summaryOf(name));
}

const outputs: [string, () => string, (file: string) => boolean][] = [
    ...Object.keys(cases).map((n): [string, () => string, (file: string) => boolean] => {
        const deterministic = cases[n]!.keys.every((k) => k.algorithm === 'Ed25519');
        return [n, () => render(n), (file) => (deterministic ? file === render(n) : matches(n, file))];
    }),
    ['tampered.lic', () => tamper(render('subscription.lic')), (file) => file === tamper(render('subscription.lic'))],
    // From the committed p256-only.lic, so it is as stable as that file is.
    ['tampered-p256.lic', () => tamper(committed('p256-only.lic')), (file) => file === tamper(committed('p256-only.lic'))],
    ['test-public-key.txt', () => `${key.id} ${publicKeyBase64(key.publicKey)}\n`, (file) => file === `${key.id} ${publicKeyBase64(key.publicKey)}\n`],
    ['test-public-key-p256.txt', () => `${p256.id} ${publicKeyBase64(p256.publicKey)}\n`, (file) => file === `${p256.id} ${publicKeyBase64(p256.publicKey)}\n`],
];

describe('cross-language fixtures', () => {
    for (const [name, make, ok] of outputs) {
        it(`${name} matches what the code signs`, () => {
            const path = resolve(dir, name);
            if (!existsSync(path) || (process.env.WRITE_FIXTURES === '1' && !ok(readFileSync(path, 'utf8')))) {
                writeFileSync(path, make());
            }
            expect(ok(readFileSync(path, 'utf8'))).toBe(true);
        });
    }

    it('verifies the good fixtures and rejects the tampered ones', () => {
        for (const name of Object.keys(cases)) {
            expect(verifyLicense(committed(name), trusted).id).toBe(cases[name]!.id);
        }
        expect(() => verifyLicense(committed('tampered.lic'), trusted)).toThrow(/signature/);
        expect(() => verifyLicense(committed('tampered-p256.lic'), trusted)).toThrow(/signature/);
    });

    it('prefers Ed25519, and falls back to P-256 without it', () => {
        expect(verifyLicenseDetailed(committed('dual-signed.lic'), trusted)).toMatchObject({ keyId: key.id, algorithm: 'Ed25519' });
        expect(verifyLicenseDetailed(committed('dual-signed.lic'), trusted, { algorithms: ['ECDSA-P256'] })).toMatchObject({
            keyId: p256.id,
            algorithm: 'ECDSA-P256',
        });
        expect(verifyLicenseDetailed(committed('p256-only.lic'), trusted).algorithm).toBe('ECDSA-P256');
        expect(() => verifyLicenseDetailed(committed('subscription.lic'), trusted, { algorithms: ['ECDSA-P256'] })).toThrow(
            expect.objectContaining({ code: 'unsupported-algorithm' }),
        );
        expect(() => verifyLicenseDetailed(committed('tampered-p256.lic'), trusted, { algorithms: ['ECDSA-P256'] })).toThrow(
            expect.objectContaining({ code: 'bad-signature' }),
        );
    });

    it('puts the Ed25519 block first, where verifiers from before ECDSA look', () => {
        // ens-license 1.0.0 reads the first BEGIN..END block, and wants exactly kid.payload.signature in it.
        const file = committed('dual-signed.lic');
        const first = file.match(/-----BEGIN ENS LICENSE-----([\s\S]*?)-----END ENS LICENSE-----/)![1]!.replace(/\s+/g, '');
        expect(first.split('.')).toHaveLength(3);
        expect(verifyLicenseDetailed(first, new Map([[key.id, key.publicKey]]))).toMatchObject({ keyId: key.id, algorithm: 'Ed25519' });
    });
});
