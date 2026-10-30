import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComplianceArtifact, Control } from '../data/compliance/types';
import { GET as getFile } from '../pages/account/compliance/[id]/[file]';
import { GET as getPackage } from '../pages/account/compliance/package.zip';
import * as accounts from './accounts';
import { auditFor, resetAuditForTests } from './audit';
import type { AuditEvent } from './audit-format';
import { resetConfigForTests } from './config';
import { closeDatabaseForTests, db } from './db';
import { resetKeysForTests } from './keys';
import { outbox } from './mail';
import { resetRateLimitsForTests } from './rate-limit';
import { zip } from './zip';

/* ---- Fixtures: a manifest of two artifacts, a control matrix, and the documents' text ---- */

// Hoisted with the mocks below, which vi.mock lifts to the top of the file.
const { fixtureManifest, fixtureControls, fixtureSources } = vi.hoisted(() => {
    const fixtureManifest: ComplianceArtifact[] = [
        {
            id: 'nist-800-53-matrix',
            kind: 'nist-800-53',
            title: 'NIST SP 800-53 control matrix',
            summary: 'How each product meets each control.',
            products: 'all',
            version: '1.0',
            date: '2026-10-01',
            files: [
                { name: 'control-matrix.md', title: 'Overview', contentType: 'text/markdown; charset=utf-8', source: { kind: 'file', path: 'nist/control-matrix.md' } },
                { name: 'controls.csv', title: 'The matrix as CSV', contentType: 'text/csv; charset=utf-8', source: { kind: 'controls-csv' } },
                { name: 'controls.json', title: 'The matrix as JSON', contentType: 'application/json', source: { kind: 'controls-json' } },
                { name: 'manifest.json', title: 'The pack manifest', contentType: 'application/json', source: { kind: 'manifest-json' } },
            ],
        },
        {
            id: 'vulnerability-management-policy',
            kind: 'vulnerability-management',
            title: 'Vulnerability management policy',
            summary: 'How vulnerabilities are found, triaged and fixed.',
            products: ['certalert'],
            version: '2.1',
            date: '2026-09-15',
            files: [
                { name: 'vulnerability-management-policy.md', title: 'The policy', contentType: 'text/markdown; charset=utf-8', source: { kind: 'file', path: 'policies/vulnerability-management.md' } },
                { name: 'missing.txt', title: 'Named but not built', contentType: 'text/plain', source: { kind: 'file', path: 'policies/missing.txt' } },
            ],
        },
    ];

    const fixtureControls: Control[] = [
        {
            id: 'AC-2',
            family: 'AC',
            title: 'Account Management',
            products: {
                certalert: {
                    status: 'implemented',
                    implementation: 'Accounts come from the directory; roles are "reader", "auditor", administrator.',
                    evidence: ['docs/security.md', 'https://example.test/cert-alert/admin/'],
                    customerResponsibility: 'Review directory group membership.',
                },
                readyroom: { status: 'partial', implementation: 'Local accounts,\r\nno expiry yet', evidence: [] },
            },
        },
        {
            id: 'AU-9(2)',
            family: 'AU',
            title: 'Store on Separate Physical Systems or Components',
            products: { certalert: { status: 'customer', implementation: 'Forward the audit log to a SIEM.', evidence: ['audit-logging.md'] } },
        },
    ];

    const fixtureSources: Record<string, string> = {
        'nist/control-matrix.md': '---\ntitle: Matrix\n---\n# Control matrix\n\nOne row per control.\n',
        'policies/vulnerability-management.md': '# Vulnerability management\n\nTriage within one business day. Ünïcödé too.\n',
    };

    return { fixtureManifest, fixtureControls, fixtureSources };
});

vi.mock('../data/compliance/manifest', () => ({
    complianceArtifacts: fixtureManifest,
    artifact: (id: string) => fixtureManifest.find((a) => a.id === id),
}));
vi.mock('../data/compliance/controls', () => ({ controls: fixtureControls }));
vi.mock('./compliance-files', () => ({
    complianceSource: (path: string) => fixtureSources[path],
    complianceSourcePaths: () => Object.keys(fixtureSources),
}));

// Imported after the mocks so the defaults are the fixtures.
const compliance = await import('./compliance');

const password = 'correct horse battery staple';

beforeAll(() => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ens-compliance-'));
    process.env.LICENSING_DB = ':memory:';
    process.env.ADMIN_EMAILS = 'boss@ens-solutions.com';
    process.env.PUBLIC_URL = 'https://products.example.com';
    resetConfigForTests();
    resetKeysForTests();
});

afterAll(() => {
    closeDatabaseForTests();
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

async function unverifiedAccount(email = 'pat@example.gov') {
    return (await accounts.signUp({ email, password, name: 'Pat Rivera', organization: 'Example Agency' }))!;
}

async function verifiedAccount(email = 'pat@example.gov') {
    await unverifiedAccount(email);
    return accounts.verifyEmail(lastLink())!;
}

const admin = () => verifiedAccount('boss@ens-solutions.com');
const fresh = (a: accounts.Account) => accounts.accountById(a.id)!;
const events = () => (db().prepare('SELECT line FROM audit_events ORDER BY seq').all() as { line: string }[]).map((r) => JSON.parse(r.line) as AuditEvent);

/** Just enough of an Astro API context for the download routes. */
function fakeCtx(account: accounts.Account | null, path: string) {
    const url = new URL(`https://products.example.com${path}`);
    const [, , , id, file] = url.pathname.split('/').map((s) => decodeURIComponent(s));
    return {
        locals: { account, sessionToken: null },
        params: { id, file },
        url,
        request: new Request(url),
        clientAddress: '10.1.2.3',
        redirect: (to: string, status: number) => new Response(null, { status, headers: { Location: to } }),
        cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    } as unknown as Parameters<typeof getFile>[0];
}

const download = async (account: accounts.Account | null, path: string) => (await getFile(fakeCtx(account, path))) as Response;
const pkg = async (account: accounts.Account | null) => (await getPackage(fakeCtx(account, '/account/compliance/package.zip'))) as Response;

const MATRIX = '/account/compliance/nist-800-53-matrix/controls.csv';
const POLICY = '/account/compliance/vulnerability-management-policy/vulnerability-management-policy.md';

/* ---- A central-directory reader, enough to check what the writer produced ---- */

interface Entry {
    name: string;
    crc: number;
    size: number;
    data: Buffer;
}

function readZip(buf: Buffer): Entry[] {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(eocd).toBeGreaterThanOrEqual(0);
    const count = buf.readUInt16LE(eocd + 10);
    const dirSize = buf.readUInt32LE(eocd + 12);
    const dirOffset = buf.readUInt32LE(eocd + 16);
    expect(dirOffset + dirSize).toBe(eocd);
    const entries: Entry[] = [];
    let p = dirOffset;
    for (let i = 0; i < count; i++) {
        expect(buf.readUInt32LE(p)).toBe(0x02014b50);
        expect(buf.readUInt16LE(p + 10)).toBe(0); // stored
        const crc = buf.readUInt32LE(p + 16);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
        expect(buf.readUInt32LE(local)).toBe(0x04034b50);
        const localNameLen = buf.readUInt16LE(local + 26);
        const localExtraLen = buf.readUInt16LE(local + 28);
        const start = local + 30 + localNameLen + localExtraLen;
        const data = buf.subarray(start, start + size);
        expect(crc32(data)).toBe(crc);
        entries.push({ name, crc, size, data });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

/* ---- Tests --------------------------------------------------------------------- */

describe('canRead', () => {
    it('is administrators, and customers an administrator granted, while enabled and confirmed', async () => {
        const boss = await admin();
        const pat = await verifiedAccount();
        const sam = await unverifiedAccount('sam@example.gov');
        expect(compliance.canRead(null)).toBe(false);
        expect(compliance.canRead(boss)).toBe(true);
        expect(compliance.canRead(pat)).toBe(false);

        expect(compliance.grant(boss, pat)).toBe(true);
        expect(compliance.canRead(fresh(pat))).toBe(true);
        expect(fresh(pat)).toMatchObject({ compliance_access_by: boss.id });
        expect(fresh(pat).compliance_access_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // An unconfirmed email: granted, but not yet readable.
        compliance.grant(boss, sam);
        expect(compliance.canRead(fresh(sam))).toBe(false);
        accounts.verifyEmail(lastLink());
        expect(compliance.canRead(fresh(sam))).toBe(true);

        // Disabled: nothing, even with the grant still recorded.
        accounts.setDisabled(boss, pat, true);
        expect(compliance.canRead(fresh(pat))).toBe(false);
        expect(fresh(pat).compliance_access_at).not.toBeNull();
        accounts.setDisabled(boss, pat, false);
        expect(compliance.canRead(fresh(pat))).toBe(true);

        expect(compliance.revoke(boss, pat)).toBe(true);
        expect(compliance.canRead(fresh(pat))).toBe(false);
        expect(fresh(pat)).toMatchObject({ compliance_access_at: null, compliance_access_by: null });
    });

    it('records compliance.granted and compliance.revoked once each, under authorization', async () => {
        const boss = await admin();
        const pat = await verifiedAccount();
        compliance.grant(boss, pat);
        expect(compliance.grant(boss, pat)).toBe(false);
        compliance.revoke(boss, pat);
        expect(compliance.revoke(boss, pat)).toBe(false);

        const mine = events().filter((e) => e.action.startsWith('compliance.'));
        expect(mine.map((e) => e.action)).toEqual(['compliance.granted', 'compliance.revoked']);
        for (const e of mine) {
            expect(e).toMatchObject({
                category: 'authorization',
                outcome: 'success',
                actor: { id: 'boss@ens-solutions.com', roles: ['admin'] },
                target: { type: 'account', id: pat.id, name: 'pat@example.gov' },
            });
        }
        // The customer sees both in their own history.
        expect(auditFor({ account: pat.id, customer: true }).map((e) => e.label)).toEqual([
            'Compliance documentation access revoked',
            'Compliance documentation access granted',
            'Email confirmed',
            'Account created',
        ]);
        expect(compliance.accountsWithAccess()).toEqual([]);
        compliance.grant(boss, pat);
        expect(compliance.accountsWithAccess()).toMatchObject([{ id: pat.id, granted_by_email: 'boss@ens-solutions.com', organization: 'Example Agency' }]);
    });
});

describe('the publish gate', () => {
    it('hides an unpublished artifact from customers and flags it for administrators', async () => {
        const boss = await admin();
        const pat = await verifiedAccount();
        compliance.grant(boss, pat);

        expect(compliance.visibleArtifacts(fresh(pat))).toEqual([]);
        expect(compliance.visibleArtifacts(boss).map((a) => [a.id, a.published])).toEqual([
            ['nist-800-53-matrix', false],
            ['vulnerability-management-policy', false],
        ]);
        expect(compliance.visibleArtifacts(await verifiedAccount('nobody@example.gov'))).toEqual([]);

        expect(compliance.publish(boss, 'nist-800-53-matrix')).toBe(true);
        expect(compliance.publish(boss, 'nist-800-53-matrix')).toBe(false);
        expect(() => compliance.publish(boss, 'no-such-artifact')).toThrow(compliance.ComplianceError);
        expect(compliance.visibleArtifacts(fresh(pat)).map((a) => [a.id, a.published])).toEqual([['nist-800-53-matrix', true]]);
        expect(compliance.visibleArtifacts(boss).map((a) => a.published)).toEqual([true, false]);
        expect(compliance.visibleArtifact(fresh(pat), 'vulnerability-management-policy')).toBeNull();
        expect(compliance.visibleArtifact(boss, 'vulnerability-management-policy')).toMatchObject({ published: false, published_at: null });

        expect(compliance.unpublish(boss, 'nist-800-53-matrix')).toBe(true);
        expect(compliance.unpublish(boss, 'nist-800-53-matrix')).toBe(false);
        expect(compliance.visibleArtifacts(fresh(pat))).toEqual([]);

        const mine = events().filter((e) => e.action.startsWith('compliance.'));
        expect(mine.map((e) => e.action)).toEqual(['compliance.granted', 'compliance.published', 'compliance.unpublished']);
        expect(mine[1]).toMatchObject({
            category: 'configuration',
            actor: { id: 'boss@ens-solutions.com' },
            target: { type: 'compliance-artifact', id: 'nist-800-53-matrix' },
            details: { artifact: 'nist-800-53-matrix', version: '1.0' },
        });
    });

    it('is a 404 on direct download of an unpublished artifact for a customer, and a 200 for an administrator', async () => {
        const boss = await admin();
        const pat = await verifiedAccount();
        compliance.grant(boss, pat);
        expect((await download(fresh(pat), MATRIX)).status).toBe(404);
        expect((await download(boss, MATRIX)).status).toBe(200);
        compliance.publish(boss, 'nist-800-53-matrix');
        expect((await download(fresh(pat), MATRIX)).status).toBe(200);
        expect((await download(fresh(pat), POLICY)).status).toBe(404);
        compliance.unpublish(boss, 'nist-800-53-matrix');
        expect((await download(fresh(pat), MATRIX)).status).toBe(404);
    });
});

describe('GET /account/compliance/<artifact>/<file>', () => {
    it('signs in first', async () => {
        const res = await download(null, MATRIX);
        expect(res.status).toBe(303);
        expect(res.headers.get('Location')).toBe(`/account/login?next=${encodeURIComponent(MATRIX)}`);
        expect((await pkg(null)).status).toBe(303);
    });

    it('refuses an account without access with 403 and records access.denied', async () => {
        const boss = await admin();
        compliance.publish(boss, 'nist-800-53-matrix');
        const pat = await verifiedAccount();
        expect((await download(pat, MATRIX)).status).toBe(403);
        expect(events().filter((e) => e.action === 'access.denied').at(-1)).toMatchObject({
            outcome: 'denied',
            reason: 'compliance_not_granted',
            details: { method: 'GET', path: MATRIX },
        });
        expect((await pkg(pat)).status).toBe(403);

        // Granted but unconfirmed, and granted but disabled: still no.
        const sam = await unverifiedAccount('sam@example.gov');
        compliance.grant(boss, sam);
        expect((await download(fresh(sam), MATRIX)).status).toBe(403);
        compliance.grant(boss, pat);
        expect((await download(fresh(pat), MATRIX)).status).toBe(200);
        accounts.setDisabled(boss, pat, true);
        expect((await download(fresh(pat), MATRIX)).status).toBe(403);
        expect(events().some((e) => e.action === 'compliance.downloaded' && e.actor.id !== 'pat@example.gov')).toBe(false);
    });

    it('serves the file as an attachment with the manifest’s type and records compliance.downloaded', async () => {
        const boss = await admin();
        const pat = await verifiedAccount();
        compliance.grant(boss, pat);
        compliance.publish(boss, 'vulnerability-management-policy');

        const res = await download(fresh(pat), POLICY);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="vulnerability-management-policy.md"');
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        const body = await res.text();
        expect(body).toBe(fixtureSources['policies/vulnerability-management.md']);
        expect(res.headers.get('Content-Length')).toBe(String(Buffer.byteLength(body)));

        const e = events().filter((x) => x.action === 'compliance.downloaded');
        expect(e).toHaveLength(1);
        expect(e[0]).toMatchObject({
            category: 'data',
            outcome: 'success',
            actor: { id: 'pat@example.gov' },
            target: { type: 'compliance-artifact', id: 'vulnerability-management-policy', name: 'vulnerability-management-policy.md' },
            details: { artifact: 'vulnerability-management-policy', file: 'vulnerability-management-policy.md' },
        });
        expect(auditFor({ account: pat.id, customer: true })[0]).toMatchObject({ action: 'compliance.downloaded', label: 'Compliance document downloaded' });
        expect(compliance.downloadCounts()).toEqual(new Map([['vulnerability-management-policy', 1]]));
    });

    it('answers 404 to an unknown artifact or file, a file the build lacks, or a name that is not plain', async () => {
        const boss = await admin();
        for (const p of [
            '/account/compliance/no-such-artifact/controls.csv',
            '/account/compliance/nist-800-53-matrix/no-such-file.csv',
            '/account/compliance/vulnerability-management-policy/missing.txt', // in the manifest, not in the build
            '/account/compliance/nist-800-53-matrix/..',
            '/account/compliance/nist-800-53-matrix/a..b',
            '/account/compliance/nist-800-53-matrix/controls%20.csv',
            '/account/compliance/nist-800-53-matrix/controls.csv%3Bx',
            '/account/compliance/%2e%2e/controls.csv',
        ]) {
            expect([p, (await download(boss, p)).status]).toEqual([p, 404]);
        }
        expect(events().some((e) => e.action === 'compliance.downloaded')).toBe(false);
    });

    it('rate limits per account', async () => {
        const boss = await admin();
        for (let i = 0; i < compliance.COMPLIANCE_DOWNLOAD_LIMIT; i++) expect((await download(boss, MATRIX)).status).toBe(200);
        const res = await download(boss, MATRIX);
        expect(res.status).toBe(429);
        expect(events().filter((x) => x.action === 'auth.lockout').at(-1)).toMatchObject({ details: { bucket: 'compliance-download' } });
    });
});

describe('the generated files', () => {
    it('writes the control matrix as RFC 4180 CSV with a byte order mark, one row per control and product', () => {
        const csv = compliance.controlsCsv();
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        const lines = csv.slice(1).split('\r\n');
        expect(lines.at(-1)).toBe('');
        expect(lines[0]).toBe('id,family,title,product,status,implementation,evidence,customer_responsibility');
        // Products in the site's order (ReadyRoom first). A field with a line break is quoted, and the
        // break kept, so the row spans two physical lines.
        expect(lines[1]).toBe('AC-2,AC,Account Management,ReadyRoom,partial,"Local accounts,');
        expect(lines[2]).toBe('no expiry yet",,');
        expect(lines[3]).toBe(
            'AC-2,AC,Account Management,CertAlert,implemented,"Accounts come from the directory; roles are ""reader"", ""auditor"", administrator.",docs/security.md; https://example.test/cert-alert/admin/,Review directory group membership.',
        );
        expect(lines[4]).toBe('AU-9(2),AU,Store on Separate Physical Systems or Components,CertAlert,customer,Forward the audit log to a SIEM.,audit-logging.md,');
        expect(lines).toHaveLength(6);
        expect(compliance.csvField('plain')).toBe('plain');
        expect(compliance.csvField('a,b')).toBe('"a,b"');
        expect(compliance.csvField('say "hi"')).toBe('"say ""hi"""');
    });

    it('serves the CSV, the JSON and the manifest from the matrix artifact', async () => {
        const boss = await admin();
        const csv = await download(boss, MATRIX);
        expect(csv.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
        // Response.text() strips a byte order mark, so look at the bytes.
        const bytes = Buffer.from(await csv.arrayBuffer());
        expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        expect(bytes.subarray(3, 12).toString('utf8')).toBe('id,family');

        const json = JSON.parse(await (await download(boss, '/account/compliance/nist-800-53-matrix/controls.json')).text());
        expect(json).toMatchObject({ standard: 'NIST SP 800-53 Rev. 5', families: { AC: 'Access Control' }, products: { certalert: 'CertAlert' } });
        expect(json.controls).toEqual(fixtureControls);

        const manifest = JSON.parse(await (await download(boss, '/account/compliance/nist-800-53-matrix/manifest.json')).text());
        expect(manifest.artifacts.map((a: { id: string }) => a.id)).toEqual(['nist-800-53-matrix', 'vulnerability-management-policy']);
        expect(manifest.artifacts[0].products).toEqual(['readyroom', 'certalert', 'mfa-portal', 'directory-portal']);
        expect(manifest.artifacts[0].files[0]).toEqual({ name: 'control-matrix.md', title: 'Overview', contentType: 'text/markdown; charset=utf-8' });
        expect(JSON.stringify(manifest)).not.toContain('"source"');
    });
});

describe('the package', () => {
    it('writes a ZIP a reader opens: every file of every artifact under its id, plus README.txt', () => {
        const buf = compliance.packageZip(fixtureManifest, {}, new Date('2026-10-30T12:00:00Z'));
        const entries = readZip(buf);
        expect(entries.map((e) => e.name)).toEqual([
            'README.txt',
            'nist-800-53-matrix/control-matrix.md',
            'nist-800-53-matrix/controls.csv',
            'nist-800-53-matrix/controls.json',
            'nist-800-53-matrix/manifest.json',
            'vulnerability-management-policy/vulnerability-management-policy.md',
        ]);
        const by = (name: string) => entries.find((e) => e.name === name)!.data.toString('utf8');
        expect(by('vulnerability-management-policy/vulnerability-management-policy.md')).toBe(fixtureSources['policies/vulnerability-management.md']);
        expect(by('nist-800-53-matrix/controls.csv')).toBe(compliance.controlsCsv());
        const readme = by('README.txt');
        expect(readme).toContain('Generated 2026-10-30');
        expect(readme).toContain('nist-800-53-matrix/  NIST SP 800-53 control matrix');
        expect(readme).toContain('version 1.0, revised 2026-10-01; covers all products');
        expect(readme).toContain('version 2.1, revised 2026-09-15; covers CertAlert');
        expect(readme).toContain('missing.txt  (not in this build)');

        // Python's zipfile agrees, where it is installed.
        const path = join(mkdtempSync(join(tmpdir(), 'ens-zip-')), 'package.zip');
        writeFileSync(path, buf);
        try {
            const out = execFileSync('python3', ['-I', '-m', 'zipfile', '-t', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            expect(out).toContain('Done testing');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
    });

    it('handles empty archives and non-ASCII names', () => {
        expect(readZip(zip([]))).toEqual([]);
        const [e] = readZip(zip([{ name: 'dokumentation/übersicht.txt', data: 'ü' }]));
        expect(e).toMatchObject({ name: 'dokumentation/übersicht.txt', size: 2 });
    });

    it('is served to accounts with access, holding what they may see, and recorded', async () => {
        const boss = await admin();
        const pat = await verifiedAccount();
        compliance.grant(boss, pat);
        expect((await pkg(fresh(pat))).status).toBe(404); // nothing published yet

        compliance.publish(boss, 'vulnerability-management-policy');
        const res = await pkg(fresh(pat));
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/zip');
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="ens-compliance-package.zip"');
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        const names = readZip(Buffer.from(await res.arrayBuffer())).map((e) => e.name);
        expect(names).toEqual(['README.txt', 'vulnerability-management-policy/vulnerability-management-policy.md']);

        // The administrator's package has the unpublished artifact too.
        const all = readZip(Buffer.from(await (await pkg(boss)).arrayBuffer())).map((e) => e.name);
        expect(all).toContain('nist-800-53-matrix/controls.csv');

        const e = events().filter((x) => x.action === 'compliance.downloaded');
        expect(e).toHaveLength(2);
        expect(e[0]).toMatchObject({
            actor: { id: 'pat@example.gov' },
            target: { type: 'compliance-artifact', id: 'package', name: 'package.zip' },
            details: { artifacts: 'vulnerability-management-policy' },
        });
        expect(compliance.downloadCounts().get('package')).toBe(2);
    });
});

describe('the migration', () => {
    it('adds the access columns and the publish table', () => {
        const cols = (db().prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name);
        expect(cols).toEqual(expect.arrayContaining(['compliance_access_at', 'compliance_access_by']));
        expect(db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'compliance_artifacts'").get()).toBeTruthy();
        expect(db().prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    });
});
