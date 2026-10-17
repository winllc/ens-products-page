/*
 * `npm run license`: keygen, public-key, inspect and verify, for both
 * signature algorithms, against the cross-language fixtures (test keys only).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(__dirname, 'license.mjs');
const fixtures = resolve(__dirname, '../licensing/fixtures');
const [edId, edKey] = readFileSync(join(fixtures, 'test-public-key.txt'), 'utf8').trim().split(' ') as [string, string];
const [ecId, ecKey] = readFileSync(join(fixtures, 'test-public-key-p256.txt'), 'utf8').trim().split(' ') as [string, string];

function run(...args: string[]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('npm run license', () => {
    it('makes an ECDSA P-256 key with --alg p256, and an Ed25519 key by default', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ens-keygen-'));
        for (const [alg, variable, prefix] of [
            ['p256', 'LICENSE_SIGNING_KEY_P256=', 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE'],
            ['ed25519', 'LICENSE_SIGNING_KEY=', 'MCowBQYDK2VwAyEA'],
        ] as const) {
            const made = run('keygen', ...(alg === 'ed25519' ? [] : ['--alg', alg]));
            expect(made.status).toBe(0);
            expect(made.stdout).toContain('-----BEGIN PRIVATE KEY-----');
            expect(made.stderr).toContain(variable);
            const pem = join(dir, `${alg}.pem`);
            writeFileSync(pem, made.stdout);
            const pub = run('public-key', pem);
            expect(pub.stdout).toMatch(new RegExp(`^[0-9a-f]{16} ${prefix}`));
            expect(made.stderr).toContain(pub.stdout.trim().split(' ')[1]);
        }
        expect(run('keygen', '--alg', 'rsa').status).toBe(1);
    });

    it('inspects every block of a dual-signed file', () => {
        const out = JSON.parse(run('inspect', join(fixtures, 'dual-signed.lic')).stdout);
        expect(out.keyId).toBe(edId);
        expect(out.signatures).toEqual([
            { keyId: edId, looksLike: 'Ed25519', samePayload: true },
            { keyId: ecId, looksLike: 'ECDSA P-256', samePayload: true },
        ]);
        expect(out.id).toBe('lic_00000000000000000004');
    });

    it('verifies each signature made by a key given', () => {
        const both = run('verify', join(fixtures, 'dual-signed.lic'), edKey, ecKey);
        expect(both.status).toBe(0);
        expect(both.stdout).toContain(`key ${edId} (Ed25519): signature valid`);
        expect(both.stdout).toContain(`key ${ecId} (ECDSA P-256): signature valid`);
        expect(both.stdout).toContain('VALID: certalert subscription');

        // As Java in FIPS mode would check it.
        expect(run('verify', join(fixtures, 'dual-signed.lic'), edKey, ecKey, '--alg', 'p256').status).toBe(0);
        expect(run('verify', join(fixtures, 'p256-only.lic'), ecKey).status).toBe(0);
        const fips = run('verify', join(fixtures, 'subscription.lic'), edKey, ecKey, '--alg', 'p256');
        expect(fips.status).toBe(1);
        expect(fips.stderr).toContain('no ECDSA P-256 signature');
    });

    it('fails on a tampered file or a key it was not given', () => {
        const tampered = run('verify', join(fixtures, 'tampered-p256.lic'), ecKey);
        expect(tampered.status).toBe(1);
        expect(tampered.stdout).toContain('SIGNATURE DOES NOT MATCH');
        expect(run('verify', join(fixtures, 'p256-only.lic'), edKey).status).toBe(1);
    });
});
