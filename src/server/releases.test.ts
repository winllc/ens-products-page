import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../pages/account/downloads/[product]/[version]/[file]';
import * as accounts from './accounts';
import { auditFor, resetAuditForTests } from './audit';
import type { AuditEvent } from './audit-format';
import { resetConfigForTests } from './config';
import { closeDatabaseForTests, db } from './db';
import { resetKeysForTests } from './keys';
import * as licenses from './licenses';
import { outbox } from './mail';
import { resetRateLimitsForTests } from './rate-limit';
import { DOWNLOAD_LIMIT, productReleases, resetReleasesForTests, setS3ClientForTests, versionFiles } from './releases';

const password = 'correct horse battery staple';
const BUCKET = 'example-releases';

beforeAll(() => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ens-releases-'));
    process.env.LICENSING_DB = ':memory:';
    process.env.ADMIN_EMAILS = 'boss@ens-solutions.com';
    process.env.PUBLIC_URL = 'https://products.example.com';
    resetConfigForTests();
    resetKeysForTests();
});

afterAll(() => {
    closeDatabaseForTests();
    delete process.env.RELEASES_S3_BUCKET;
    resetConfigForTests();
});

beforeEach(() => {
    closeDatabaseForTests();
    resetAuditForTests();
    resetRateLimitsForTests();
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

describe('canDownload', () => {
    it('follows the licenses an account holds, product by product', async () => {
        const admin = await verifiedAccount('boss@ens-solutions.com');
        const pat = await verifiedAccount();
        expect(licenses.canDownload(pat, 'certalert')).toBe(false);
        expect(licenses.canDownload(null, 'certalert')).toBe(false);

        // Evaluation
        const evaluation = licenses.issueEvaluation(pat, 'certalert');
        expect(licenses.canDownload(pat, 'certalert')).toBe(true);
        // Other product
        expect(licenses.canDownload(pat, 'readyroom')).toBe(false);

        // Revoked: the only certalert license, so no more downloads.
        licenses.revokeLicense(admin, evaluation, 'test');
        expect(licenses.canDownload(pat, 'certalert')).toBe(false);

        // Paid
        const paid = licenses.issueLicense(admin, pat, { product: 'certalert', edition: 'subscription', quantity: 10_000 });
        expect(licenses.canDownload(pat, 'certalert')).toBe(true);
        licenses.revokeLicense(admin, paid, 'test');
        expect(licenses.canDownload(pat, 'certalert')).toBe(false);

        // Expired still counts: the applications enforce expiry themselves.
        const old = licenses.issueLicense(admin, pat, {
            product: 'readyroom',
            edition: 'subscription',
            quantity: 500,
            start: new Date('2020-01-01T00:00:00Z'),
            years: 1,
        });
        expect(old.status).toBe('expired');
        expect(licenses.canDownload(pat, 'readyroom')).toBe(true);

        // Disabled gets nothing.
        accounts.setDisabled(admin, pat, true);
        expect(licenses.canDownload(accounts.accountById(pat.id), 'readyroom')).toBe(false);

        // Administrators: every product, with no license of their own.
        expect(licenses.licensesOf(admin.id)).toHaveLength(0);
        for (const p of ['certalert', 'readyroom', 'mfa-portal', 'directory-portal'] as const) expect(licenses.canDownload(admin, p)).toBe(true);
    });
});

/* ---- A bucket, in memory, behind a real S3Client whose send() is mocked ---- */

const sha = (c: string) => c.repeat(64);
const bucket = new Map<string, string>();

function seedBucket(): void {
    bucket.clear();
    const put = (key: string, body: string) => bucket.set(key, body);
    for (const v of ['1.0.0', '1.1.0', '1.2.0-rc.1']) {
        put(`cert-alert/${v}/cert-alert-${v}.tar.gz`, `package ${v}`);
        put(`cert-alert/${v}/cert-alert-${v}.tgz`, `chart ${v}`);
        put(`cert-alert/${v}/sbom-cert-alert.spdx.json`, '{}');
        put(`cert-alert/${v}/SHA256SUMS`, `${sha('a')}  cert-alert-${v}.tar.gz\n${sha('b')}  cert-alert-${v}.tgz\n${sha('c')}  sbom-cert-alert.spdx.json\n`);
    }
    put('cert-alert/1.1.0/SHA256SUMS.asc', 'signature');
    put('cert-alert/latest.txt', '1.1.0\n');
    // Not a version: ignored.
    put('cert-alert/scratch/notes.txt', 'x');
    put('readyroom/2.0.0/readyroom-2.0.0.tar.gz', 'rr');
}

const sent: unknown[] = [];

function mockClient(): S3Client {
    const client = new S3Client({
        region: 'us-east-1',
        endpoint: 'https://s3.example.test',
        forcePathStyle: true,
        credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
    });
    vi.spyOn(client, 'send').mockImplementation((async (command: unknown) => {
        sent.push(command);
        if (command instanceof ListObjectsV2Command) {
            const { Prefix = '', Delimiter } = command.input;
            const folders = new Set<string>();
            const contents: { Key: string; Size: number }[] = [];
            for (const [key, body] of bucket) {
                if (!key.startsWith(Prefix)) continue;
                const rest = key.slice(Prefix.length);
                const cut = Delimiter ? rest.indexOf(Delimiter) : -1;
                if (cut >= 0) folders.add(Prefix + rest.slice(0, cut + 1));
                else contents.push({ Key: key, Size: body.length });
            }
            return { Contents: contents, CommonPrefixes: [...folders].map((p) => ({ Prefix: p })), IsTruncated: false };
        }
        if (command instanceof GetObjectCommand) {
            const body = bucket.get(command.input.Key!);
            if (body === undefined) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
            return { ContentLength: body.length, Body: { transformToString: async () => body } };
        }
        throw new Error(`unexpected ${String(command)}`);
    }) as never);
    return client;
}

function withBucket(): void {
    process.env.RELEASES_S3_BUCKET = BUCKET;
    process.env.RELEASES_URL_TTL = '120';
    resetConfigForTests();
    resetReleasesForTests();
    seedBucket();
    sent.length = 0;
    setS3ClientForTests(mockClient());
}

/** Just enough of an Astro API context for the download route. */
function fakeCtx(account: accounts.Account | null, path: string) {
    const url = new URL(`https://products.example.com${path}`);
    // Astro hands the route its parameters decoded.
    const [, , , product, version, file] = url.pathname.split('/').map((s) => decodeURIComponent(s));
    return {
        locals: { account, sessionToken: null },
        params: { product, version, file },
        url,
        request: new Request(url),
        clientAddress: '10.1.2.3',
        redirect: (to: string, status: number) => new Response(null, { status, headers: { Location: to } }),
        cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    } as unknown as Parameters<typeof GET>[0];
}

const download = async (account: accounts.Account | null, path: string) => (await GET(fakeCtx(account, path))) as Response;
const events = () => (db().prepare('SELECT line FROM audit_events ORDER BY seq').all() as { line: string }[]).map((r) => JSON.parse(r.line) as AuditEvent);

describe('release listings', () => {
    beforeEach(withBucket);

    it('lists versions newest first, marks pre-releases, and takes latest from latest.txt', async () => {
        const r = await productReleases('certalert');
        expect(r.latest).toBe('1.1.0');
        expect(r.versions).toEqual([
            { version: '1.2.0-rc.1', prerelease: true, latest: false },
            { version: '1.1.0', prerelease: false, latest: true },
            { version: '1.0.0', prerelease: false, latest: false },
        ]);
        expect(sent.find((c) => c instanceof ListObjectsV2Command)).toMatchObject({ input: { Bucket: BUCKET, Prefix: 'cert-alert/', Delimiter: '/' } });
    });

    it('falls back to the newest final version when latest.txt is missing or names a pre-release', async () => {
        bucket.set('cert-alert/latest.txt', '1.2.0-rc.1');
        expect((await productReleases('certalert')).latest).toBe('1.1.0');
        resetReleasesForTests();
        setS3ClientForTests(mockClient());
        bucket.delete('cert-alert/latest.txt');
        expect((await productReleases('certalert')).latest).toBe('1.1.0');
    });

    it('lists a version’s files in order, with sizes and SHA-256 from SHA256SUMS', async () => {
        expect(await versionFiles('certalert', '1.1.0')).toEqual([
            { name: 'cert-alert-1.1.0.tar.gz', size: 13, sha256: sha('a') },
            { name: 'cert-alert-1.1.0.tgz', size: 11, sha256: sha('b') },
            { name: 'sbom-cert-alert.spdx.json', size: 2, sha256: sha('c') },
            { name: 'SHA256SUMS', size: bucket.get('cert-alert/1.1.0/SHA256SUMS')!.length, sha256: null },
            { name: 'SHA256SUMS.asc', size: 9, sha256: null },
        ]);
    });

    it('caches listings for RELEASES_LISTING_TTL', async () => {
        await productReleases('certalert');
        await versionFiles('certalert', '1.0.0');
        const n = sent.length;
        await productReleases('certalert');
        await versionFiles('certalert', '1.0.0');
        expect(sent.length).toBe(n);
    });
});

describe('GET /account/downloads/<product>/<version>/<file>', () => {
    beforeEach(withBucket);

    it('redirects to a short-lived presigned URL and records release.downloaded', async () => {
        const pat = await verifiedAccount();
        licenses.issueEvaluation(pat, 'certalert');
        const res = await download(pat, '/account/downloads/certalert/1.0.0/cert-alert-1.0.0.tar.gz');
        expect(res.status).toBe(302);
        const to = new URL(res.headers.get('Location')!);
        expect(`${to.origin}${to.pathname}`).toBe(`https://s3.example.test/${BUCKET}/cert-alert/1.0.0/cert-alert-1.0.0.tar.gz`);
        expect(to.searchParams.get('X-Amz-Expires')).toBe('120');
        expect(to.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
        expect(to.searchParams.get('response-content-disposition')).toBe('attachment; filename="cert-alert-1.0.0.tar.gz"');

        const e = events().filter((x) => x.action === 'release.downloaded');
        expect(e).toHaveLength(1);
        expect(e[0]).toMatchObject({
            category: 'data',
            outcome: 'success',
            actor: { id: 'pat@example.gov' },
            target: { type: 'release', id: 'cert-alert/1.0.0/cert-alert-1.0.0.tar.gz' },
            details: { product: 'certalert', version: '1.0.0', file: 'cert-alert-1.0.0.tar.gz' },
        });
        // In the customer's own history, as license downloads are.
        expect(auditFor({ account: pat.id, customer: true })[0]).toMatchObject({ action: 'release.downloaded', label: 'Release downloaded' });
    });

    it('signs in first', async () => {
        const res = await download(null, '/account/downloads/certalert/1.0.0/cert-alert-1.0.0.tar.gz');
        expect(res.status).toBe(303);
        expect(res.headers.get('Location')).toMatch(/^\/account\/login\?next=/);
    });

    it('refuses another product with 403 and access.denied, checking on every request', async () => {
        const admin = await verifiedAccount('boss@ens-solutions.com');
        const pat = await verifiedAccount();
        const l = licenses.issueEvaluation(pat, 'certalert');
        expect((await download(pat, '/account/downloads/readyroom/2.0.0/readyroom-2.0.0.tar.gz')).status).toBe(403);
        expect(events().filter((x) => x.action === 'access.denied').at(-1)).toMatchObject({
            outcome: 'denied',
            reason: 'release_not_entitled',
            details: { path: '/account/downloads/readyroom/2.0.0/readyroom-2.0.0.tar.gz' },
        });

        // Revoked after the page was drawn: the link stops working.
        expect((await download(pat, '/account/downloads/certalert/1.1.0/SHA256SUMS')).status).toBe(302);
        licenses.revokeLicense(admin, l, 'test');
        expect((await download(pat, '/account/downloads/certalert/1.1.0/SHA256SUMS')).status).toBe(403);
        expect(events().filter((x) => x.action === 'release.downloaded')).toHaveLength(1);
    });

    it('answers 404 to anything that isn’t a listed file, without signing a URL', async () => {
        const pat = await verifiedAccount();
        licenses.issueEvaluation(pat, 'certalert');
        const paths = [
            '/account/downloads/cert-alert/1.0.0/cert-alert-1.0.0.tar.gz', // the S3 prefix, not a ProductId
            '/account/downloads/certalert/latest/cert-alert-1.0.0.tar.gz',
            '/account/downloads/certalert/1.0/cert-alert-1.0.0.tar.gz',
            '/account/downloads/certalert/1.0.0/no-such-file.tar.gz', // well-formed, not in the listing
            '/account/downloads/certalert/1.1.0/cert-alert-1.0.0.tar.gz', // another version's file
            '/account/downloads/certalert/9.9.9/SHA256SUMS',
            '/account/downloads/certalert/1.0.0/%2e%2e',
            '/account/downloads/certalert/1.0.0/a..b',
            '/account/downloads/certalert/1.0.0/name%20with%20space',
            '/account/downloads/certalert/1.0.0/sha256sums%3Bx',
        ];
        for (const p of paths) expect([p, (await download(pat, p)).status]).toEqual([p, 404]);
        // Traversal in the parameters themselves, as a client that skips URL normalization sends them.
        for (const params of [
            { product: 'certalert', version: '..', file: 'latest.txt' },
            { product: 'certalert', version: '1.0.0', file: '../latest.txt' },
            { product: 'certalert', version: '1.0.0', file: '..' },
            { product: 'certalert', version: '../readyroom/2.0.0', file: 'readyroom-2.0.0.tar.gz' },
        ]) {
            const ctx = fakeCtx(pat, '/account/downloads/x/y/z');
            (ctx as unknown as { params: typeof params }).params = params;
            expect(((await GET(ctx)) as Response).status).toBe(404);
        }
        expect(events().some((x) => x.action === 'release.downloaded')).toBe(false);
    });

    it('lets administrators download every product', async () => {
        const admin = await verifiedAccount('boss@ens-solutions.com');
        expect((await download(admin, '/account/downloads/readyroom/2.0.0/readyroom-2.0.0.tar.gz')).status).toBe(302);
    });

    it('rate limits per account', async () => {
        const pat = await verifiedAccount();
        licenses.issueEvaluation(pat, 'certalert');
        const path = '/account/downloads/certalert/1.0.0/SHA256SUMS';
        for (let i = 0; i < DOWNLOAD_LIMIT; i++) expect((await download(pat, path)).status).toBe(302);
        const res = await download(pat, path);
        expect(res.status).toBe(429);
        expect(events().filter((x) => x.action === 'auth.lockout').at(-1)).toMatchObject({ details: { bucket: 'release-download' } });
    });

    it('is a 404 when no bucket is configured', async () => {
        delete process.env.RELEASES_S3_BUCKET;
        resetConfigForTests();
        resetReleasesForTests();
        const pat = await verifiedAccount();
        licenses.issueEvaluation(pat, 'certalert');
        expect((await download(pat, '/account/downloads/certalert/1.0.0/SHA256SUMS')).status).toBe(404);
    });
});
