import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractTokens, publicKeyBase64, verifyLicense, verifyLicenseDetailed } from '../lib/licensing/license';
import * as accounts from './accounts';
import { auditFor } from './audit';
import { closeDatabaseForTests, db } from './db';
import { resetConfigForTests } from './config';
import { asPem, generateSigningKeyPem, resetKeysForTests, signingKey, signingKeys, trustedKeys } from './keys';
import { signingKeyFromPem } from '../lib/licensing/license';
import * as licenses from './licenses';
import { outbox } from './mail';
import { createSession, destroySessions, sessionAccountId } from './sessions';

const password = 'correct horse battery staple';

beforeAll(() => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ens-licensing-'));
    process.env.LICENSING_DB = ':memory:';
    process.env.ADMIN_EMAILS = 'boss@ens-solutions.com';
    process.env.PUBLIC_URL = 'https://products.example.com';
    resetConfigForTests();
    resetKeysForTests();
});

afterAll(() => closeDatabaseForTests());

beforeEach(() => {
    closeDatabaseForTests();
    outbox.length = 0;
    db();
});

function lastLink(): string {
    const m = outbox.at(-1)!.text.match(/https:\/\/\S+token=(\S+)/);
    return decodeURIComponent(m![1]!);
}

async function verifiedAccount(email = 'pat@example.gov') {
    await accounts.signUp({ email, password, name: 'Pat Rivera', organization: 'Example Agency' });
    return accounts.verifyEmail(lastLink())!;
}

describe('accounts', () => {
    it('signs up, verifies by email link and signs in', async () => {
        const a = await accounts.signUp({ email: ' Pat@Example.gov ', password, name: 'Pat Rivera' });
        expect(a!.email).toBe('pat@example.gov');
        expect(outbox.at(-1)!.text).toContain('https://products.example.com/account/verify?token=');
        expect(accounts.verifyEmail(lastLink())!.email_verified_at).not.toBeNull();
        expect(await accounts.authenticate('PAT@example.gov', password)).not.toBeNull();
        expect(await accounts.authenticate('pat@example.gov', 'wrong password here')).toBeNull();
    });

    it('does not reveal that an address is taken', async () => {
        await verifiedAccount();
        expect(await accounts.signUp({ email: 'pat@example.gov', password, name: 'Someone' })).toBeNull();
        expect(outbox.at(-1)!.subject).toBe('Your ENS Solutions licensing account');
    });

    it('uses each email link once', async () => {
        await accounts.signUp({ email: 'pat@example.gov', password, name: 'Pat' });
        const token = lastLink();
        expect(accounts.verifyEmail(token)).not.toBeNull();
        expect(accounts.verifyEmail(token)).toBeNull();
    });

    it('rejects short passwords', async () => {
        await expect(accounts.signUp({ email: 'a@b.gov', password: 'short', name: 'A' })).rejects.toThrow(/at least 12/);
    });

    it('resets a password and signs out other sessions', async () => {
        const a = await verifiedAccount();
        const s = createSession(a.id);
        await accounts.requestPasswordReset('pat@example.gov');
        await accounts.resetPassword(lastLink(), 'an entirely new passphrase');
        expect(sessionAccountId(s.token)).toBeNull();
        expect(await accounts.authenticate('pat@example.gov', 'an entirely new passphrase')).not.toBeNull();
    });

    it('makes ADMIN_EMAILS administrators once verified', async () => {
        await accounts.signUp({ email: 'boss@ens-solutions.com', password, name: 'Boss' });
        expect(accounts.isAdmin(accounts.accountByEmail('boss@ens-solutions.com'))).toBe(false);
        expect(accounts.isAdmin(accounts.verifyEmail(lastLink()))).toBe(true);
    });
});

describe('evaluation licenses', () => {
    it('needs a verified address', async () => {
        const a = await accounts.signUp({ email: 'new@example.gov', password, name: 'New' });
        expect(() => licenses.issueEvaluation(a!, 'certalert')).toThrow(/Confirm your email/);
    });

    it('issues one per product, as a file the applications accept', async () => {
        const a = await verifiedAccount();
        const l = licenses.issueEvaluation(a, 'certalert');
        expect(l.status).toBe('valid');
        expect(l.daysLeft).toBe(30);
        const file = licenses.downloadLicense(a, l);
        expect(file.filename).toMatch(/^certalert-lic_[0-9a-f]{20}-r1\.lic$/);
        expect(verifyLicense(file.content, trustedKeys()).licensee.organization).toBe('Example Agency');
        expect(() => licenses.issueEvaluation(a, 'certalert')).toThrow(/already have/);
        expect(licenses.issueEvaluation(a, 'readyroom').payload.limit.quantity).toBe(500);
    });

    it('re-signs as a new revision when bound to an installation', async () => {
        const a = await verifiedAccount();
        const l = licenses.issueEvaluation(a, 'certalert');
        const bound = licenses.bindInstallation(a, l, 'ca-7f3k-29qd');
        expect(bound.revision).toBe(2);
        expect(verifyLicense(bound.token, trustedKeys()).installationId).toBe('CA-7F3K-29QD');
        expect(() => licenses.bindInstallation(a, bound, 'bad id!')).toThrow();
        expect(auditFor({ license: l.id }).map((e) => e.action)).toEqual(['license.bound', 'license.issued']);
    });
});

describe('administration', () => {
    it('issues, renews and revokes paid licenses, and only for administrators', async () => {
        const customer = await verifiedAccount();
        const admin = await verifiedAccount('boss@ens-solutions.com');

        expect(() =>
            licenses.issueLicense(customer, customer, { product: 'certalert', edition: 'subscription', quantity: 10_000 }),
        ).toThrow(/Administrators only/);

        const l = licenses.issueLicense(
            admin,
            customer,
            { product: 'certalert', edition: 'subscription', quantity: 10_000, support: 'mission', years: 3, start: new Date('2026-10-14T00:00:00Z') },
            { orderReference: 'PO-2026-0042' },
        );
        expect(l.payload.support).toBe('mission');
        expect(l.payload.expiresAt).toBe('2029-10-14T00:00:00.000Z');
        expect(licenses.licensesOf(customer.id)).toHaveLength(1);
        expect(licenses.licenseFor(customer, l.id)).not.toBeNull();

        const stranger = await verifiedAccount('someone@else.gov');
        expect(licenses.licenseFor(stranger, l.id)).toBeNull();

        const renewed = licenses.renewLicense(admin, l, new Date('2031-01-01T00:00:00Z'));
        expect(renewed.payload.expiresAt).toBe('2031-01-01T00:00:00.000Z');
        expect(renewed.revision).toBe(2);

        const revoked = licenses.revokeLicense(admin, renewed, 'Contract ended');
        expect(revoked.status).toBe('revoked');
        expect(licenses.publicStatus(l.id)).toMatchObject({ status: 'revoked', revision: 2 });
        expect(licenses.reinstateLicense(admin, revoked).status).toBe('valid');
    });

    it('signs a file the applications can tell has been edited', async () => {
        const a = await verifiedAccount();
        const l = licenses.issueEvaluation(a, 'directory-portal');
        const file = licenses.downloadLicense(a, l).content;
        expect(licenses.inspectFile(file).known?.id).toBe(l.id);
        // Flip one character inside the signed payload, on the first line after BEGIN.
        const at = file.indexOf('-----BEGIN ENS LICENSE-----\n') + 28 + 40;
        const flipped = file[at] === 'A' ? 'B' : 'A';
        const tampered = file.slice(0, at) + flipped + file.slice(at + 1);
        expect(() => licenses.inspectFile(tampered)).toThrow();
    });
});

describe('signing keys', () => {
    it('accepts the one-line form of a key', () => {
        const pem = generateSigningKeyPem();
        const oneLine = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
        expect(signingKeyFromPem(asPem(oneLine)).id).toBe(signingKeyFromPem(pem).id);
    });
});

describe('ECDSA P-256 signing, for Java in FIPS mode', () => {
    const p256Pem = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const configure = (env: Record<string, string | undefined>) => {
        for (const [k, v] of Object.entries(env)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        resetConfigForTests();
        resetKeysForTests();
    };
    afterEach(() => configure({ LICENSE_SIGNING_KEY_P256: undefined, LICENSE_SIGNING_KEY_P256_FILE: undefined, LICENSE_TRUSTED_KEYS: undefined }));

    it('signs with Ed25519 only until a P-256 key is configured', async () => {
        const a = await verifiedAccount();
        const l = licenses.issueEvaluation(a, 'certalert');
        expect(l.tokens).toHaveLength(1);
        expect(l.key_id).toBe(signingKey().id);
        expect(licenses.inspectFile(licenses.downloadLicense(a, l).content).fipsReady).toBe(false);
    });

    it('signs every license with both keys once LICENSE_SIGNING_KEY_P256 is set, Ed25519 first', async () => {
        configure({ LICENSE_SIGNING_KEY_P256: p256Pem() });
        const [ed, ec] = signingKeys() as [ReturnType<typeof signingKey>, ReturnType<typeof signingKey>];
        expect([ed.algorithm, ec.algorithm]).toEqual(['Ed25519', 'ECDSA-P256']);
        const a = await verifiedAccount();
        const l = licenses.issueEvaluation(a, 'readyroom');
        expect(l.key_id).toBe(`${ed.id},${ec.id}`);
        const file = licenses.downloadLicense(a, l).content;
        expect(extractTokens(file).map((t) => t.split('.')[0])).toEqual([ed.id, ec.id]);
        expect(file).toContain('# Signatures:   Ed25519, ECDSA P-256');
        expect(verifyLicenseDetailed(file, trustedKeys()).algorithm).toBe('Ed25519');
        expect(verifyLicenseDetailed(file, trustedKeys(), { algorithms: ['ECDSA-P256'] }).keyId).toBe(ec.id);
        expect(licenses.inspectFile(file).fipsReady).toBe(true);
        // Re-signing on binding keeps both.
        const bound = licenses.bindInstallation(a, l, 'RR-7F3K-29QD');
        expect(bound.tokens).toHaveLength(2);
    });

    it('takes the key from a file, as a Docker secret', async () => {
        const path = join(process.env.DATA_DIR!, 'p256.pem');
        writeFileSync(path, p256Pem());
        configure({ LICENSE_SIGNING_KEY_P256_FILE: path });
        expect(signingKeys().map((k) => k.algorithm)).toEqual(['Ed25519', 'ECDSA-P256']);
    });

    it('re-signs a license issued before the P-256 key, changing nothing else', async () => {
        const customer = await verifiedAccount();
        const admin = await verifiedAccount('boss@ens-solutions.com');
        const before = licenses.issueEvaluation(customer, 'mfa-portal');
        configure({ LICENSE_SIGNING_KEY_P256: p256Pem() });
        expect(() => licenses.resignLicense(customer, licenses.licenseById(before.id)!)).toThrow(/Administrators only/);
        const after = licenses.resignLicense(admin, licenses.licenseById(before.id)!);
        expect(after.revision).toBe(before.revision + 1);
        expect(after.tokens).toHaveLength(2);
        expect({ ...after.payload, revision: 0, issuedAt: '' }).toEqual({ ...before.payload, revision: 0, issuedAt: '' });
        expect(licenses.inspectFile(licenses.downloadLicense(customer, after).content).fipsReady).toBe(true);
        expect(auditFor({ license: before.id }).map((e) => e.action)).toContain('license.resigned');
    });

    it('trusts retired keys of either algorithm, and refuses other keys', () => {
        const retired = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
        configure({ LICENSE_TRUSTED_KEYS: publicKeyBase64(retired) });
        expect([...trustedKeys().values()].map((k) => k.asymmetricKeyType)).toEqual(['ed25519', 'ec']);
        configure({ LICENSE_TRUSTED_KEYS: publicKeyBase64(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey) });
        expect(() => trustedKeys()).toThrow(/LICENSE_TRUSTED_KEYS: .*Ed25519 or ECDSA P-256/);
    });

    it('refuses a key of the wrong kind in each setting', () => {
        configure({ LICENSE_SIGNING_KEY_P256: generateSigningKeyPem() });
        expect(() => signingKeys()).toThrow(/LICENSE_SIGNING_KEY_P256: .*must be ECDSA P-256, not ed25519/);
        configure({ LICENSE_SIGNING_KEY_P256: undefined, LICENSE_SIGNING_KEY: p256Pem() });
        try {
            expect(() => signingKey()).toThrow(/LICENSE_SIGNING_KEY: .*must be Ed25519/);
        } finally {
            configure({ LICENSE_SIGNING_KEY: undefined });
        }
    });
});

describe('sessions', () => {
    it('ends every session for an account', async () => {
        const a = await verifiedAccount();
        const one = createSession(a.id);
        const two = createSession(a.id);
        destroySessions(a.id, one.token);
        expect(sessionAccountId(one.token)).toBe(a.id);
        expect(sessionAccountId(two.token)).toBeNull();
    });
});
