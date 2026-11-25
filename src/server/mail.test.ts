import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, resetConfigForTests } from './config';
import { outbox, parseAddress, resetMailForTests, sendMail } from './mail';

/** A stand-in for Mailjet's Send API: records each request, answers what the test says. */
interface Seen {
    path: string;
    authorization: string | undefined;
    body: any;
}
let seen: Seen[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { Messages: [{ Status: 'success' }] } };
let server: Server;
let url = '';

const read = (req: IncomingMessage) =>
    new Promise<string>((done) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => done(data));
    });

beforeAll(async () => {
    server = createServer(async (req, res) => {
        seen.push({ path: req.url ?? '', authorization: req.headers.authorization, body: JSON.parse(await read(req)) });
        res.writeHead(answer.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer.body));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

beforeEach(() => {
    seen = [];
    answer = { status: 200, body: { Messages: [{ Status: 'success' }] } };
    outbox.length = 0;
    process.env.MAILJET_API_KEY = 'public-key';
    process.env.MAILJET_SECRET_KEY = 'private-key';
    process.env.MAILJET_API_URL = `${url}/`;
    process.env.MAIL_FROM = 'ENS Solutions <licensing@ens-solutions.com>';
    resetConfigForTests();
    resetMailForTests();
});

afterEach(() => {
    for (const name of ['MJ_APIKEY_PUBLIC', 'MJ_APIKEY_PRIVATE', 'MAILJET_API_KEY', 'MAILJET_SECRET_KEY', 'MAILJET_SECRET_KEY_FILE', 'MAILJET_API_URL', 'MAIL_FROM', 'SMTP_URL']) {
        delete process.env[name];
    }
    resetConfigForTests();
    resetMailForTests();
    vi.restoreAllMocks();
});

describe('Mailjet', () => {
    it('sends through the Send API v3.1 with basic authentication, From, To, Reply-To, subject and text', async () => {
        await sendMail({ to: 'pat@example.gov', replyTo: 'Visitor <visitor@example.com>', subject: 'Hello', text: 'Line one\nLine two' });
        expect(seen).toHaveLength(1);
        expect(seen[0].path).toBe('/v3.1/send');
        expect(seen[0].authorization).toBe(`Basic ${Buffer.from('public-key:private-key').toString('base64')}`);
        expect(seen[0].body).toEqual({
            Messages: [
                {
                    From: { Email: 'licensing@ens-solutions.com', Name: 'ENS Solutions' },
                    To: [{ Email: 'pat@example.gov' }],
                    ReplyTo: { Email: 'visitor@example.com', Name: 'Visitor' },
                    Subject: 'Hello',
                    TextPart: 'Line one\nLine two',
                },
            ],
        });
        expect(outbox.at(-1)?.to).toBe('pat@example.gov');
    });

    it('leaves Reply-To out when there is none', async () => {
        await sendMail({ to: 'pat@example.gov', subject: 'Hello', text: 'Hi' });
        expect(seen[0].body.Messages[0]).not.toHaveProperty('ReplyTo');
    });

    it("throws with Mailjet's reasons when a message is refused", async () => {
        answer = {
            status: 400,
            body: { Messages: [{ Status: 'error', Errors: [{ ErrorCode: 'mj-0013', ErrorMessage: '"nobody" is an invalid email address.', ErrorRelatedTo: ['To[0].Email'] }] }] },
        };
        await expect(sendMail({ to: 'nobody', subject: 'x', text: 'x' })).rejects.toThrow(
            'Mailjet did not send the email to nobody (HTTP 400: mj-0013 "nobody" is an invalid email address. To[0].Email)',
        );
    });

    it('throws when the keys are refused', async () => {
        answer = { status: 401, body: { ErrorIdentifier: 'x', StatusCode: 401, ErrorMessage: 'API key authentication/authorization failure.' } };
        await expect(sendMail({ to: 'pat@example.gov', subject: 'x', text: 'x' })).rejects.toThrow(/HTTP 401: API key authentication\/authorization failure\./);
    });

    it('throws when Mailjet cannot be reached', async () => {
        process.env.MAILJET_API_URL = 'http://127.0.0.1:1';
        resetConfigForTests();
        await expect(sendMail({ to: 'pat@example.gov', subject: 'x', text: 'x' })).rejects.toThrow(/^Mailjet could not be reached/);
    });

    it('reads the secret key from MAILJET_SECRET_KEY_FILE', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'ens-mailjet-')), 'secret');
        writeFileSync(file, 'from-a-file\n');
        delete process.env.MAILJET_SECRET_KEY;
        process.env.MAILJET_SECRET_KEY_FILE = file;
        resetConfigForTests();
        await sendMail({ to: 'pat@example.gov', subject: 'x', text: 'x' });
        expect(seen[0].authorization).toBe(`Basic ${Buffer.from('public-key:from-a-file').toString('base64')}`);
    });

    it('turns Mailjet off, without stopping the service, when one key is missing', () => {
        delete process.env.MAILJET_SECRET_KEY;
        resetConfigForTests();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(config().mailjet).toBeNull();
        expect(error.mock.calls[0][0]).toContain('Mailjet is off: MAILJET_SECRET_KEY (or MAILJET_SECRET_KEY_FILE) is not set');
    });

    it('turns Mailjet off, without stopping the service, when the secret key file cannot be read', () => {
        delete process.env.MAILJET_SECRET_KEY;
        process.env.MAILJET_SECRET_KEY_FILE = '/nonexistent/mailjet-secret';
        resetConfigForTests();
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(config().mailjet).toBeNull();
        expect(error.mock.calls[0][0]).toContain('MAILJET_SECRET_KEY_FILE cannot be read');
    });

    it("reads Mailjet's own names, MJ_APIKEY_PUBLIC and MJ_APIKEY_PRIVATE", () => {
        delete process.env.MAILJET_API_KEY;
        delete process.env.MAILJET_SECRET_KEY;
        process.env.MJ_APIKEY_PUBLIC = 'pub';
        process.env.MJ_APIKEY_PRIVATE = 'priv';
        resetConfigForTests();
        expect(config().mailjet).toMatchObject({ apiKey: 'pub', secretKey: 'priv' });
    });

    it('defaults to api.mailjet.com', () => {
        delete process.env.MAILJET_API_URL;
        resetConfigForTests();
        expect(config().mailjet?.apiUrl).toBe('https://api.mailjet.com');
    });

    it('is not used when SMTP_URL is set: SMTP comes first', async () => {
        process.env.SMTP_URL = 'smtp://localhost:2525';
        resetConfigForTests();
        const smtpSend = vi.fn().mockResolvedValue({});
        const create = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: smtpSend } as never);
        await sendMail({ to: 'pat@example.gov', subject: 'Hello', text: 'Hi' });
        expect(create).toHaveBeenCalledWith('smtp://localhost:2525');
        expect(smtpSend).toHaveBeenCalledWith({ from: 'ENS Solutions <licensing@ens-solutions.com>', to: 'pat@example.gov', subject: 'Hello', text: 'Hi' });
        expect(seen).toHaveLength(0);
    });

    it('logs the message when neither SMTP nor Mailjet is configured', async () => {
        delete process.env.MAILJET_API_KEY;
        delete process.env.MAILJET_SECRET_KEY;
        resetConfigForTests();
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        await sendMail({ to: 'pat@example.gov', subject: 'Hello', text: 'Hi' });
        expect(seen).toHaveLength(0);
        expect(info.mock.calls[0][0]).toContain('no SMTP_URL or Mailjet keys configured');
    });
});

describe('parseAddress', () => {
    it.each([
        ['licensing@ens-solutions.com', { Email: 'licensing@ens-solutions.com' }],
        ['ENS Solutions <licensing@ens-solutions.com>', { Email: 'licensing@ens-solutions.com', Name: 'ENS Solutions' }],
        ['"Rivera, Pat" <pat@example.gov>', { Email: 'pat@example.gov', Name: 'Rivera, Pat' }],
        ['<pat@example.gov>', { Email: 'pat@example.gov' }],
    ])('%s', (value, expected) => {
        expect(parseAddress(value)).toEqual(expected);
    });
});
