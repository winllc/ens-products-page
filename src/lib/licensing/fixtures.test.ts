/*
 * Cross-language fixtures in licensing/fixtures/, signed by this code with a
 * fixed TEST key, for the Java verifier's tests (licensing/java). Ed25519 is
 * deterministic, so the fixtures are reproducible: this test fails if the
 * committed files ever differ from what the current code produces.
 *
 *     WRITE_FIXTURES=1 npx vitest run src/lib/licensing/fixtures.test.ts
 *
 * regenerates them after an intentional format change.
 *
 * The test key is derived from a published seed. It is for tests only and
 * must never be trusted by a shipped application.
 */

import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { editions } from '../../data/licensing';
import { product } from '../../data/products';
import { buildPayload, type IssueRequest } from './issue';
import { licenseFile, publicKeyBase64, signToken, signingKeyFromPem, summaryLines, verifyLicense } from './license';

const SEED = Buffer.alloc(32, 7); // 0x07 x 32: TEST ONLY
const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]);
const pem = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' }).toString();
const key = signingKeyFromPem(pem);

const dir = resolve(__dirname, '../../../licensing/fixtures');
const licensee = { name: 'Pat Rivera', organization: 'Example Agency', email: 'pat@example.gov' };
const now = new Date('2026-10-14T00:00:00Z');

const cases: Record<string, { req: IssueRequest; id: string; revision: number }> = {
    'subscription.lic': {
        req: { product: 'certalert', edition: 'subscription', licensee, quantity: 10_000, support: 'mission', start: now, years: 1 },
        id: 'lic_00000000000000000001',
        revision: 3,
    },
    'evaluation-bound.lic': {
        req: { product: 'readyroom', edition: 'evaluation', licensee: { ...licensee, organization: 'Agência Ñandú "Test"' }, start: now, installationId: 'RR-TEST-0001' },
        id: 'lic_00000000000000000002',
        revision: 1,
    },
    'perpetual.lic': {
        req: { product: 'directory-portal', edition: 'perpetual', licensee, quantity: 2_000, start: now, years: 1 },
        id: 'lic_00000000000000000003',
        revision: 1,
    },
};

function render(name: string): string {
    const c = cases[name]!;
    const payload = buildPayload(c.req, { id: c.id, revision: c.revision, now });
    return licenseFile(
        signToken(payload, key),
        summaryLines(payload, { product: product(payload.product).name, edition: editions[payload.edition].name }),
    );
}

function tampered(): string {
    // The subscription file with its limit raised and the old signature kept.
    const file = render('subscription.lic');
    const token = file.split('-----BEGIN ENS LICENSE-----\n')[1]!.split('\n-----END')[0]!.replace(/\n/g, '');
    const [kid, body, sig] = token.split('.') as [string, string, string];
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    json.limit.quantity = 1_000_000;
    return `-----BEGIN ENS LICENSE-----\n${kid}.${Buffer.from(JSON.stringify(json)).toString('base64url')}.${sig}\n-----END ENS LICENSE-----\n`;
}

const outputs: Record<string, () => string> = {
    ...Object.fromEntries(Object.keys(cases).map((n) => [n, () => render(n)])),
    'tampered.lic': tampered,
    'test-public-key.txt': () => `${key.id} ${publicKeyBase64(key.publicKey)}\n`,
};

describe('cross-language fixtures', () => {
    for (const [name, make] of Object.entries(outputs)) {
        it(`${name} matches what the code signs`, () => {
            const path = resolve(dir, name);
            if (process.env.WRITE_FIXTURES === '1' || !existsSync(path)) {
                writeFileSync(path, make());
            }
            expect(readFileSync(path, 'utf8')).toBe(make());
        });
    }

    it('verifies the good fixtures and rejects the tampered one', () => {
        const trusted = new Map([[key.id, key.publicKey]]);
        for (const name of Object.keys(cases)) {
            expect(verifyLicense(readFileSync(resolve(dir, name), 'utf8'), trusted).id).toBe(cases[name]!.id);
        }
        expect(() => verifyLicense(readFileSync(resolve(dir, 'tampered.lic'), 'utf8'), trusted)).toThrow(/signature/);
    });
});
