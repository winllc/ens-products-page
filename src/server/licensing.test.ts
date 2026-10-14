import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyLicense } from '../lib/licensing/license';
import * as accounts from './accounts';
import { auditFor } from './audit';
import { closeDatabaseForTests, db } from './db';
import { resetConfigForTests } from './config';
import { asPem, generateSigningKeyPem, resetKeysForTests, trustedKeys } from './keys';
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
