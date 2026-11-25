import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import { auditFor } from './audit';
import { resetConfigForTests } from './config';
import { closeDatabaseForTests, db } from './db';
import { resetKeysForTests } from './keys';
import { MailError, outbox, resetMailForTests } from './mail';

const password = 'correct horse battery staple';

beforeAll(() => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ens-verification-'));
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

afterEach(() => {
    // Back to mail written to the log.
    delete process.env.MAILJET_API_KEY;
    delete process.env.MAILJET_SECRET_KEY;
    delete process.env.MAILJET_API_URL;
    resetConfigForTests();
    resetMailForTests();
});

/** Mail through a Mailjet that cannot be reached: every send fails with a MailError. */
function breakMail() {
    process.env.MAILJET_API_KEY = 'public-key';
    process.env.MAILJET_SECRET_KEY = 'private-key';
    process.env.MAILJET_API_URL = 'http://127.0.0.1:1';
    resetConfigForTests();
}

const lastToken = () => decodeURIComponent(outbox.at(-1)!.text.match(/token=(\S+)/)![1]!);

async function admin() {
    await accounts.signUp({ email: 'boss@ens-solutions.com', password, name: 'Boss' });
    return accounts.verifyEmail(lastToken())!;
}

describe('sending the confirmation link again', () => {
    it('an administrator sends an unconfirmed account a new link that confirms it, recorded in the audit trail', async () => {
        const boss = await admin();
        const pat = (await accounts.signUp({ email: 'pat@example.gov', password, name: 'Pat Rivera' }))!;
        outbox.length = 0;
        await accounts.adminResendVerification(boss, pat);
        expect(outbox).toHaveLength(1);
        expect(outbox[0]).toMatchObject({ to: 'pat@example.gov', subject: 'Confirm your ENS Solutions licensing account' });
        expect(accounts.verifyEmail(lastToken())?.email_verified_at).not.toBeNull();
        expect(auditFor({ account: pat.id }).find((e) => e.action === 'account.verification-resent')).toMatchObject({ outcome: 'success' });
    });

    it('refuses an account that is already confirmed, or disabled', async () => {
        const boss = await admin();
        await expect(accounts.adminResendVerification(boss, boss)).rejects.toThrow('already confirmed');
        const pat = (await accounts.signUp({ email: 'pat@example.gov', password, name: 'Pat Rivera' }))!;
        accounts.setDisabled(boss, pat, true);
        await expect(accounts.adminResendVerification(boss, accounts.accountById(pat.id)!)).rejects.toThrow('disabled');
    });

    it('says why when the email cannot be sent, and records the failure', async () => {
        const boss = await admin();
        const pat = (await accounts.signUp({ email: 'pat@example.gov', password, name: 'Pat Rivera' }))!;
        breakMail();
        await expect(accounts.adminResendVerification(boss, pat)).rejects.toThrow(MailError);
        expect(auditFor({ account: pat.id }).find((e) => e.action === 'account.verification-resent')).toMatchObject({ outcome: 'failure' });
    });
});

describe('a sign-up whose email cannot be sent', () => {
    it('keeps the account and throws a MailError, so the page can say what to do', async () => {
        breakMail();
        await expect(accounts.signUp({ email: 'pat@example.gov', password, name: 'Pat Rivera' })).rejects.toThrow(MailError);
        const pat = accounts.accountByEmail('pat@example.gov')!;
        expect(pat.email_verified_at).toBeNull();
        // Once mail works, the customer (or an administrator) gets a link that works.
        mailWritesToTheLog();
        await accounts.resendVerification(pat);
        expect(accounts.verifyEmail(lastToken())?.email_verified_at).not.toBeNull();
    });
});

function mailWritesToTheLog() {
    delete process.env.MAILJET_API_KEY;
    delete process.env.MAILJET_SECRET_KEY;
    delete process.env.MAILJET_API_URL;
    resetConfigForTests();
}
