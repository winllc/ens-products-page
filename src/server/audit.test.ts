import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as accounts from './accounts';
import {
    addLineSink,
    auditFor,
    createAuditToken,
    filterFrom,
    headSeq,
    pruneAudit,
    queryAudit,
    record,
    resetAuditForTests,
    revokeAuditToken,
    verifyAudit,
    withAuditContext,
    type RequestContext,
} from './audit';
import { exportAudit, pullEvents } from './audit-api';
import { ZERO_HASH, chainHash, cleanDetails, serializeBody, type AuditEvent } from './audit-format';
import { HecForwarder, RotatingFile, SyslogForwarder, octetFrame, syslogMessage } from './audit-outputs';
import { resetConfigForTests } from './config';
import { closeDatabaseForTests, db, openDatabase } from './db';
import { limited, requireAdmin } from './http';
import { resetKeysForTests } from './keys';
import * as licenses from './licenses';
import { outbox } from './mail';
import { resetRateLimitsForTests } from './rate-limit';

const password = 'correct horse battery staple';
const kit = '/tmp/claude-0/-home-user/d439962b-e839-5efd-b1dd-58c48afa5765/scratchpad/audit-kit/vector.txt';
let dataDir: string;

beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ens-audit-'));
    process.env.DATA_DIR = dataDir;
    process.env.LICENSING_DB = ':memory:';
    process.env.ADMIN_EMAILS = 'boss@ens-solutions.com';
    process.env.PUBLIC_URL = 'https://products.example.com';
    resetConfigForTests();
    resetKeysForTests();
});

afterAll(() => closeDatabaseForTests());

let lines: string[] = [];
let removeSink: () => void = () => {};

beforeEach(() => {
    closeDatabaseForTests();
    resetAuditForTests();
    resetRateLimitsForTests();
    outbox.length = 0;
    db();
    lines = [];
    removeSink = addLineSink((line) => lines.push(line));
});

afterEach(() => {
    removeSink();
    vi.useRealTimers();
});

function lastLink(): string {
    const m = outbox.at(-1)!.text.match(/https:\/\/\S+token=(\S+)/);
    return decodeURIComponent(m![1]!);
}

async function verifiedAccount(email = 'pat@example.gov') {
    await accounts.signUp({ email, password, name: 'Pat Rivera', organization: 'Example Agency' });
    return accounts.verifyEmail(lastLink())!;
}

const events = () => (db().prepare('SELECT line FROM audit_events ORDER BY seq').all() as { line: string }[]).map((r) => JSON.parse(r.line) as AuditEvent);
const lastOf = (action: string) => events().filter((e) => e.action === action).at(-1);

const ctx = (account: accounts.Account | null = null, ip = '10.1.2.3'): RequestContext => ({
    ip,
    userAgent: 'vitest',
    requestId: '11111111-1111-4111-8111-111111111111',
    session: account ? 'abcdef0123456789' : null,
    account,
});

/** Just enough of an Astro context for the http.ts helpers. */
function fakeAstro(account: accounts.Account | null, path: string, method = 'GET') {
    const url = new URL(`https://products.example.com${path}`);
    return {
        locals: { account, sessionToken: null },
        url,
        request: new Request(url, { method }),
        clientAddress: '10.1.2.3',
        redirect: (to: string, status: number) => new Response(null, { status, headers: { Location: to } }),
        cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    } as unknown as Parameters<typeof requireAdmin>[0];
}

describe('ens-audit/1 format and chain', () => {
    it('serializes the test vector exactly and hashes it to the published value', () => {
        const e: AuditEvent = {
            schema: 'ens-audit/1',
            id: '00000000-0000-4000-8000-000000000001',
            seq: 1,
            time: '2026-01-01T00:00:00.000Z',
            product: 'test',
            version: 'dev',
            host: 'h',
            installationId: null,
            category: 'system',
            action: 'system.started',
            outcome: 'success',
            severity: 'info',
            actor: { type: 'system', id: null, name: null, roles: [] },
            source: null,
            target: null,
            reason: null,
            details: {},
            requestId: null,
            session: null,
            prevHash: ZERO_HASH,
        };
        const body = serializeBody(e);
        expect(body).toBe(
            '{"schema":"ens-audit/1","id":"00000000-0000-4000-8000-000000000001","seq":1,"time":"2026-01-01T00:00:00.000Z","product":"test","version":"dev","host":"h","installationId":null,"category":"system","action":"system.started","outcome":"success","severity":"info","actor":{"type":"system","id":null,"name":null,"roles":[]},"source":null,"target":null,"reason":null,"details":{},"requestId":null,"session":null,"prevHash":"0000000000000000000000000000000000000000000000000000000000000000"}',
        );
        const expected = '90b915788e0c86d867ee7f9786404f333744acaf88803a244651156792ca300d';
        expect(chainHash(ZERO_HASH, body)).toBe(expected);
        let vector: string | null = null;
        try {
            vector = readFileSync(kit, 'utf8');
        } catch {
            // The kit is only on the machine the spec was written for; the value is pinned above.
        }
        if (vector) {
            expect(vector).toContain(`hash=${expected}`);
            expect(vector).toContain(`line=${body.slice(0, -1)},"hash":"${expected}"}`);
        }
    });

    it('chains events, verifies intact, and detects a tampered event at its seq', () => {
        for (let i = 0; i < 5; i++) record({ action: 'job.completed', details: { i } });
        const all = events();
        expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
        expect(all[0]!.prevHash).toBe(ZERO_HASH);
        expect(all[3]!.prevHash).toBe(all[2]!.hash);
        expect(verifyAudit()).toMatchObject({ intact: true, anchorSeq: 1, anchorAccepted: false, lastSeq: 5 });

        const row = db().prepare('SELECT line FROM audit_events WHERE seq = 3').get() as { line: string };
        db().prepare('UPDATE audit_events SET line = ? WHERE seq = 3').run(row.line.replace('"i":2', '"i":7'));
        expect(verifyAudit()).toMatchObject({ intact: false, brokenSeq: 3 });
    });

    it('detects a deleted event', () => {
        for (let i = 0; i < 4; i++) record({ action: 'job.completed', details: { i } });
        db().prepare('DELETE FROM audit_events WHERE seq = 2').run();
        expect(verifyAudit()).toMatchObject({ intact: false, brokenSeq: 2 });
    });

    it('prunes old delivered events, keeps the head, and verification reports the anchor', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        for (let i = 0; i < 4; i++) record({ action: 'job.completed', details: { i } });
        vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
        record({ action: 'job.completed', details: { i: 4 } });

        // Nothing goes until every forwarder has delivered it.
        expect(pruneAudit(30, 2)).toBe(2);
        expect(lastOf('audit.pruned')!.details).toMatchObject({ count: 2, fromSeq: 1, toSeq: 2 });
        expect(verifyAudit()).toMatchObject({ intact: true, anchorSeq: 3, anchorAccepted: true });
        expect(pruneAudit(30, Number.MAX_SAFE_INTEGER)).toBe(2);
        expect(verifyAudit()).toMatchObject({ intact: true, anchorSeq: 5, anchorAccepted: true, lastSeq: 7 });
        expect(pruneAudit(0, Number.MAX_SAFE_INTEGER)).toBe(0);
    });

    it('migrates the old audit_log in time order, keeping its times', () => {
        const path = join(dataDir, `migrate-${Date.now()}.sqlite`);
        const old = openDatabase(path, 1);
        old.prepare("INSERT INTO accounts (id, email, password_hash, name, created_at) VALUES ('acct_1', 'pat@example.gov', 'x', 'Pat', '2026-01-01T00:00:00.000Z')").run();
        const ins = old.prepare('INSERT INTO audit_log (at, actor_id, account_id, license_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)');
        ins.run('2026-02-01T00:00:00.000Z', 'acct_1', 'acct_1', null, 'account.updated', '');
        ins.run('2026-01-05T00:00:00.000Z', 'acct_1', 'acct_1', null, 'account.created', '');
        old.close();

        const migrated = openDatabase(path);
        const rows = migrated.prepare('SELECT seq, time, line FROM audit_events ORDER BY seq').all() as { seq: number; time: string; line: string }[];
        expect(rows.map((r) => r.time)).toEqual(['2026-01-05T00:00:00.000Z', '2026-02-01T00:00:00.000Z']);
        const first = JSON.parse(rows[0]!.line) as AuditEvent;
        expect(first).toMatchObject({
            seq: 1,
            action: 'account.created',
            category: 'account',
            actor: { type: 'user', id: 'pat@example.gov' },
            target: { type: 'account', id: 'acct_1' },
            details: { migrated: true },
            prevHash: ZERO_HASH,
        });
        expect(migrated.prepare("SELECT name FROM sqlite_master WHERE name = 'audit_log'").get()).toBeUndefined();
        expect((migrated.prepare('SELECT seq FROM audit_head').get() as { seq: number }).seq).toBe(2);
        migrated.close();
    });

    it('keeps details flat, truncated and free of secrets', () => {
        const d = cleanDetails({ password: 'hunter2hunter2', apiToken: 'x', pin: '1234', name: 'a'.repeat(1500), nested: { a: 1 }, n: 3 });
        expect(d).toEqual({ password: '[redacted]', apiToken: '[redacted]', pin: '[redacted]', name: 'a'.repeat(1000), nested: '{"a":1}', n: 3 });
    });
});

describe('coverage', () => {
    it('records sign-in success and failure, with the address tried as the actor on failure', async () => {
        const a = await verifiedAccount();
        await withAuditContext(ctx(), async () => {
            expect(await accounts.authenticate('pat@example.gov', 'not the password at all')).toBeNull();
            expect(await accounts.authenticate('nobody@example.gov', password)).toBeNull();
            expect(await accounts.authenticate('pat@example.gov', password)).not.toBeNull();
        });
        const logins = events().filter((e) => e.action === 'auth.login');
        expect(logins).toHaveLength(3);
        expect(logins[0]).toMatchObject({
            category: 'authentication',
            outcome: 'failure',
            severity: 'warning',
            actor: { type: 'anonymous', id: 'pat@example.gov' },
            source: { ip: '10.1.2.3', userAgent: 'vitest' },
            reason: 'bad credentials',
            details: { method: 'password' },
        });
        expect(logins[1]).toMatchObject({ outcome: 'failure', actor: { id: 'nobody@example.gov' }, reason: 'unknown account', target: null });
        expect(logins[2]).toMatchObject({ outcome: 'success', severity: 'info', actor: { type: 'user', id: 'pat@example.gov', roles: ['customer'] } });
        // Customers see their own sign-ins, friendly.
        expect(auditFor({ account: a.id, customer: true }).map((e) => e.label)).toContain('Sign-in failed');
    });

    it('records rate-limit hits as auth.lockout, collapsed', () => {
        withAuditContext(ctx(), () => {
            const astro = fakeAstro(null, '/account/login', 'POST');
            for (let i = 0; i < 15; i++) limited(astro, 'login', 'pat@example.gov', 10, 15);
        });
        const lockouts = events().filter((e) => e.action === 'auth.lockout');
        expect(lockouts).toHaveLength(1);
        expect(lockouts[0]).toMatchObject({ severity: 'alert', outcome: 'denied', actor: { type: 'anonymous', id: 'pat@example.gov' } });
    });

    it('refuses non-admins with 403 and access.denied, collapsing repeats within 60 seconds', async () => {
        vi.useFakeTimers();
        const customer = await verifiedAccount();
        withAuditContext(ctx(customer), () => {
            for (let i = 0; i < 3; i++) {
                const r = requireAdmin(fakeAstro(customer, '/admin/audit'));
                expect(r).toBeInstanceOf(Response);
                expect((r as Response).status).toBe(403);
            }
        });
        let denials = events().filter((e) => e.action === 'access.denied');
        expect(denials).toHaveLength(1);
        expect(denials[0]).toMatchObject({
            category: 'authorization',
            outcome: 'denied',
            severity: 'warning',
            actor: { id: 'pat@example.gov' },
            reason: 'admin_required',
            details: { method: 'GET', path: '/admin/audit', reason: 'admin_required', count: 1 },
        });
        vi.advanceTimersByTime(61_000);
        denials = events().filter((e) => e.action === 'access.denied');
        expect(denials).toHaveLength(2);
        expect(denials[1]!.details).toMatchObject({ count: 2, collapsed: true });
        // Customers don't see denials in their own history.
        expect(auditFor({ account: customer.id, customer: true }).some((e) => e.action === 'access.denied')).toBe(false);
    });

    it('records account changes with old and new values', async () => {
        const customer = await verifiedAccount();
        const admin = await verifiedAccount('boss@ens-solutions.com');
        accounts.updateProfile(customer, { name: 'Pat Q. Rivera', organization: 'Example Agency', phone: '' });
        expect(lastOf('account.updated')!.details).toMatchObject({ 'name.old': 'Pat Rivera', 'name.new': 'Pat Q. Rivera' });
        accounts.setRole(admin, customer, 'admin');
        expect(lastOf('account.role-changed')).toMatchObject({
            severity: 'notice',
            actor: { id: 'boss@ens-solutions.com', roles: ['admin'] },
            target: { type: 'account', id: customer.id, name: 'pat@example.gov' },
            details: { 'role.old': 'customer', 'role.new': 'admin' },
        });
    });

    it('records issuing a license, and a download as a data export', async () => {
        const customer = await verifiedAccount();
        const admin = await verifiedAccount('boss@ens-solutions.com');
        const l = licenses.issueLicense(admin, customer, { product: 'certalert', edition: 'subscription', quantity: 10_000 }, { orderReference: 'PO-1' });
        expect(lastOf('license.issued')).toMatchObject({
            category: 'data',
            target: { type: 'license', id: l.id },
            details: { product: 'certalert', edition: 'subscription', orderReference: 'PO-1' },
        });
        licenses.downloadLicense(customer, l);
        expect(lastOf('license.downloaded')!.details).toMatchObject({ revision: 1 });
        expect(auditFor({ license: l.id, customer: true }).map((e) => e.action)).toEqual(['license.downloaded', 'license.issued']);
    });

    it('records sign-out, verification and reset, including failures', async () => {
        const a = await verifiedAccount();
        expect(accounts.verifyEmail('not-a-real-token')).toBeNull();
        expect(lastOf('account.verified')).toMatchObject({ outcome: 'failure' });
        await accounts.requestPasswordReset('pat@example.gov');
        expect(lastOf('account.password-reset-requested')).toMatchObject({ outcome: 'success', target: { id: a.id } });
        await accounts.resetPassword(lastLink(), 'an entirely new passphrase');
        expect(lastOf('account.password-reset')).toMatchObject({ outcome: 'success' });
        expect(await accounts.resetPassword('used-or-bogus', 'an entirely new passphrase')).toBeNull();
        expect(lastOf('account.password-reset')).toMatchObject({ outcome: 'failure' });

        const { endSession } = await import('./http');
        const astro = fakeAstro(a, '/account/logout', 'POST');
        withAuditContext(ctx(a), () => endSession(astro));
        expect(lastOf('auth.logout')).toMatchObject({ actor: { id: 'pat@example.gov' }, session: 'abcdef0123456789' });
    });

    it('fails a security action when its audit event cannot be stored', async () => {
        const customer = await verifiedAccount();
        const admin = await verifiedAccount('boss@ens-solutions.com');
        db().exec('DROP TABLE audit_head');
        expect(() => accounts.setRole(admin, customer, 'admin')).toThrow();
        expect(accounts.accountById(customer.id)!.role).toBe('customer');
        // System events log and carry on.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(record({ action: 'job.completed' })).toBeNull();
        spy.mockRestore();
    });

    it('emits stdout/file lines only after the change commits', async () => {
        const customer = await verifiedAccount();
        const admin = await verifiedAccount('boss@ens-solutions.com');
        lines = [];
        expect(() =>
            licenses.issueLicense(admin, customer, { product: 'certalert', edition: 'subscription', quantity: -5 }),
        ).toThrow();
        expect(lines).toEqual([]);
        licenses.issueLicense(admin, customer, { product: 'certalert', edition: 'subscription', quantity: 100 });
        expect(lines.map((l) => JSON.parse(l).action)).toEqual(['license.issued']);
    });
});

describe('admin audit page', () => {
    async function seed() {
        const admin = await verifiedAccount('boss@ens-solutions.com');
        for (let i = 0; i < 120; i++) {
            record({ action: i % 2 ? 'auth.login' : 'job.completed', outcome: i % 3 ? 'success' : 'failure', source: { ip: `10.0.0.${i % 4}`, userAgent: null }, details: { i } });
        }
        return admin;
    }

    it('filters and pages, newest first', async () => {
        await seed();
        const all = queryAudit({}, 1, 50);
        expect(all.total).toBe(headSeq());
        expect(all.pages).toBe(Math.ceil(all.total / 50));
        expect(all.rows[0]!.seq).toBe(headSeq());
        expect(queryAudit({}, 2, 50).rows[0]!.seq).toBe(headSeq() - 50);

        const f = filterFrom(new URLSearchParams('action=auth.login&outcome=failure&ip=10.0.0.3'));
        const r = queryAudit(f, 1, 50);
        expect(r.total).toBeGreaterThan(0);
        expect(r.rows.every((x) => x.action === 'auth.login' && x.outcome === 'failure' && x.source_ip === '10.0.0.3')).toBe(true);
        expect(queryAudit({ q: '"i":7}' }, 1, 50).total).toBe(1);
        expect(queryAudit({ actor: 'BOSS@' }, 1, 50).rows.every((x) => x.actor_id === 'boss@ens-solutions.com')).toBe(true);
        expect(queryAudit({ from: '2999-01-01' }, 1, 50).total).toBe(0);
        expect(queryAudit({ category: 'audit' }, 1, 50).total).toBe(0);
    });

    it('exports CSV and NDJSON under the filter, and audits the export', async () => {
        const admin = await seed();
        const res = exportAudit(admin, new URL('https://x/admin/audit/export?format=csv&action=auth.login&outcome=failure'));
        expect(res.headers.get('content-type')).toContain('text/csv');
        const csv = await res.text();
        const rows = csv.trim().split('\r\n');
        expect(rows[0]).toBe('seq,id,time,category,action,outcome,severity,actor_type,actor_id,actor_name,actor_roles,source_ip,user_agent,target_type,target_id,target_name,reason,details,request_id,session,hash');
        expect(rows.length - 1).toBe(queryAudit({ action: 'auth.login', outcome: 'failure' }).total);
        expect(rows[1]).toMatch(/,auth\.login,failure,warning,/);
        const exported = lastOf('audit.exported')!;
        expect(exported).toMatchObject({ category: 'audit', actor: { id: 'boss@ens-solutions.com' }, details: { format: 'csv', count: rows.length - 1, 'filter.action': 'auth.login' } });

        const nd = await exportAudit(admin, new URL('https://x/admin/audit/export?format=ndjson')).text();
        const parsed = nd.trim().split('\n').map((l) => JSON.parse(l) as AuditEvent);
        expect(parsed[0]!.seq).toBe(1);
        expect(parsed.every((e, i) => i === 0 || e.seq === parsed[i - 1]!.seq + 1)).toBe(true);
    });

    it('refuses the export and page to non-admins', async () => {
        const customer = await verifiedAccount();
        const r = withAuditContext(ctx(customer), () => requireAdmin(fakeAstro(customer, '/admin/audit/export')));
        expect((r as Response).status).toBe(403);
        const signedOut = requireAdmin(fakeAstro(null, '/admin/audit'));
        expect((signedOut as Response).status).toBe(303);
    });
});

describe('pull API', () => {
    const get = (token: string | null, query = '', accept?: string) =>
        pullEvents(
            new Request(`https://x/api/audit/events${query}`, {
                headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accept ? { Accept: accept } : {}) },
            }),
            '10.9.9.9',
        );

    it('serves events after a cursor to a token, and refuses revoked and unknown tokens', async () => {
        const admin = await verifiedAccount('boss@ens-solutions.com');
        for (let i = 0; i < 5; i++) record({ action: 'job.completed', details: { i } });
        const { token, record: t } = createAuditToken(admin, 'Splunk');
        expect(token).toMatch(/^ensat_[A-Za-z0-9_-]{43}$/);
        expect(lastOf('audit.token-created')).toMatchObject({ target: { type: 'api-token', id: t.id }, details: { name: 'Splunk', scope: 'audit:read' } });
        const head = headSeq();

        const res = get(token, '?after=2&limit=3');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/x-ndjson');
        const got = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as AuditEvent);
        expect(got.map((e) => e.seq)).toEqual([3, 4, 5]);
        expect(headSeq()).toBe(head); // pulls are not audited

        const json = (await get(token, '?after=0&limit=1000', 'application/json').json()) as { events: AuditEvent[]; next: number };
        expect(json.events.length).toBe(head);
        expect(json.next).toBe(head);
        expect(((await get(token, `?after=${head}`, 'application/json').json()) as { next: number }).next).toBe(head);

        expect(get(token, '?limit=0').status).toBe(400);
        expect(get(token, '?limit=1001').status).toBe(400);
        expect(get(token, '?after=-1').status).toBe(400);
        expect(get(null).status).toBe(401);
        expect(get('ensat_nope').status).toBe(401);

        revokeAuditToken(admin, t.id);
        expect(lastOf('audit.token-revoked')).toMatchObject({ target: { id: t.id } });
        expect(get(token).status).toBe(401);
        expect(lastOf('auth.login')).toMatchObject({ outcome: 'failure', details: { method: 'api-token' } });
        const stored = db().prepare('SELECT last_used_at, token_hash FROM audit_tokens WHERE id = ?').get(t.id) as { last_used_at: string; token_hash: string };
        expect(stored.last_used_at).not.toBeNull();
        expect(stored.token_hash).not.toContain(token);
    });

    it('has no license gate: the portal is the license issuer and has no unlicensed mode', async () => {
        const admin = await verifiedAccount('boss@ens-solutions.com');
        const { token } = createAuditToken(admin, 'Splunk');
        expect(get(token).status).toBe(200);
    });
});

/* ---- Outputs --------------------------------------------------------------- */

async function stubHec(statuses: number[]) {
    const requests: { headers: IncomingMessage['headers']; url: string; body: string }[] = [];
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            requests.push({ headers: req.headers, url: req.url ?? '', body });
            const status = statuses.shift() ?? 200;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(status === 200 ? '{"text":"Success","code":0}' : '{"text":"Server is busy","code":9}');
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return { requests, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('Splunk HEC forwarder', () => {
    it('posts batches with the Splunk header, retries after a failure and persists its cursor', async () => {
        for (let i = 0; i < 130; i++) record({ action: 'job.completed', details: { i } });
        const hec = await stubHec([503]);
        const f = new HecForwarder({ url: hec.url, token: 'hec-secret-token', index: 'security', sourcetype: 'ens:audit', insecure: false }, { alertAfterMs: 0 });
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            expect(await f.tick()).toBe(false);
            expect(f.cursor()).toBe(0);
            expect(f.status().lastError).toMatch(/503/);
            expect(lastOf('audit.delivery-failed')).toMatchObject({ severity: 'alert', details: { output: 'splunk-hec' } });

            expect(await f.tick()).toBe(true);
            expect(f.cursor()).toBe(100);
            expect(lastOf('audit.delivery-recovered')).toMatchObject({ details: { output: 'splunk-hec' } });
            // A new forwarder (a restart) carries on from the stored cursor.
            const again = new HecForwarder({ url: hec.url, token: 'hec-secret-token', index: null, sourcetype: 'ens:audit', insecure: false });
            expect(again.cursor()).toBe(100);
            expect(await again.tick()).toBe(true);
            expect(again.cursor()).toBe(headSeq());
        } finally {
            spy.mockRestore();
            await hec.close();
        }

        const ok = hec.requests[1]!;
        expect(ok.url).toBe('/services/collector/event');
        expect(ok.headers.authorization).toBe('Splunk hec-secret-token');
        expect(ok.headers['content-type']).toBe('application/json');
        const sent = ok.body.split('\n').map((l) => JSON.parse(l));
        expect(sent).toHaveLength(100);
        expect(Object.keys(sent[0])).toEqual(['time', 'host', 'source', 'sourcetype', 'index', 'event']);
        expect(sent[0]).toMatchObject({ source: 'licensing-portal', sourcetype: 'ens:audit', index: 'security', event: { seq: 1, schema: 'ens-audit/1' } });
        expect(sent[0].time).toBe(Date.parse(sent[0].event.time) / 1000);
        expect(Object.keys(JSON.parse(hec.requests[2]!.body.split('\n')[0]!))).not.toContain('index');
    });
});

describe('syslog forwarder', () => {
    it('sends RFC 5424 messages with octet-counting framing over TCP', async () => {
        record({ action: 'auth.login', outcome: 'failure', actor: { type: 'anonymous', id: 'pat@example.gov', name: null, roles: [] }, details: { method: 'password', note: 'naïve ünïcode' } });
        record({ action: 'access.denied', outcome: 'denied', severity: 'warning' });
        let received = Buffer.alloc(0);
        const server = createTcpServer((s) => s.on('data', (d) => (received = Buffer.concat([received, d]))));
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as AddressInfo).port;
        const f = new SyslogForwarder({ host: '127.0.0.1', port, protocol: 'tcp', facility: 'local0' });
        try {
            expect(await f.tick()).toBe(true);
            for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
            await new Promise((r) => setTimeout(r, 50));
        } finally {
            f.stop();
            await new Promise<void>((r) => server.close(() => r()));
        }

        // Parse octet-counted frames: "<len> <msg>" with len in bytes.
        const frames: string[] = [];
        let rest = received;
        while (rest.length) {
            const sp = rest.indexOf(0x20);
            const len = Number(rest.subarray(0, sp).toString());
            frames.push(rest.subarray(sp + 1, sp + 1 + len).toString('utf8'));
            rest = rest.subarray(sp + 1 + len);
        }
        expect(frames).toHaveLength(2);
        const m = /^<(\d+)>1 (\S+) (\S+) licensing-portal (\d+) (\S+) - (\{.*\})$/.exec(frames[0]!);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBe(16 * 8 + 4); // local0, warning
        expect(m![5]).toBe('auth.login');
        const line = JSON.parse(m![6]!) as AuditEvent;
        expect(line.time).toBe(m![2]);
        expect(line.details.note).toBe('naïve ünïcode');
        expect(f.cursor()).toBe(2);
    });

    it('maps severities and frames by bytes', () => {
        const line = (severity: string) => `{"schema":"ens-audit/1","seq":1,"time":"2026-01-01T00:00:00.000Z","host":"h","action":"x.y","severity":"${severity}","hash":"0"}`;
        expect(syslogMessage(line('info'), 'local0', 7)).toMatch(/^<134>1 2026-01-01T00:00:00.000Z h licensing-portal 7 x.y - \{/);
        expect(syslogMessage(line('notice'), 'local0')).toMatch(/^<133>/);
        expect(syslogMessage(line('alert'), 'local1')).toMatch(/^<137>/);
        expect(octetFrame('é')).toBe('2 é');
    });
});

describe('file output', () => {
    it('rotates daily and keeps a set number of files', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ens-audit-file-'));
        const path = join(dir, 'audit.jsonl');
        let now = Date.parse('2026-10-01T12:00:00Z');
        const f = new RotatingFile(path, 2, () => now);
        f.write('{"a":1}');
        for (let day = 2; day <= 5; day++) {
            now = Date.parse(`2026-10-0${day}T12:00:00Z`);
            f.write(`{"day":${day}}`);
        }
        const files = readdirSync(dir).sort();
        expect(files).toEqual(['audit-2026-10-03.jsonl', 'audit-2026-10-04.jsonl', 'audit.jsonl']);
        expect(readFileSync(path, 'utf8')).toBe('{"day":5}\n');
        expect(readFileSync(join(dir, 'audit-2026-10-04.jsonl'), 'utf8')).toBe('{"day":4}\n');
    });

    it('rotates by size and picks up an existing file after a restart', () => {
        const dir = mkdtempSync(join(tmpdir(), 'ens-audit-file-'));
        const path = join(dir, 'audit.jsonl');
        writeFileSync(path, '{"old":1}\n');
        utimesSync(path, new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
        const now = Date.parse('2026-10-01T12:00:00Z');
        const f = new RotatingFile(path, 5, () => now, 30);
        f.write('{"x":"aaaaaaaaaa"}');
        f.write('{"x":"bbbbbbbbbb"}');
        expect(readdirSync(dir).sort()).toEqual(['audit-2026-10-01.jsonl', 'audit.jsonl']);
        expect(readFileSync(join(dir, 'audit-2026-10-01.jsonl'), 'utf8')).toBe('{"old":1}\n{"x":"aaaaaaaaaa"}\n');
    });
});

describe('secrets', () => {
    it('never puts a password or a token in any output', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ens-audit-secrets-'));
        const file = new RotatingFile(join(dir, 'audit.jsonl'), 5);
        const removeFile = addLineSink((l) => file.write(l));
        const secrets: string[] = [password, 'an entirely new passphrase', 'wrong-but-secret-password'];
        try {
            const a = await verifiedAccount();
            secrets.push(...outbox.map((m) => decodeURIComponent(m.text.match(/token=(\S+)/)?.[1] ?? '')).filter(Boolean));
            const admin = await verifiedAccount('boss@ens-solutions.com');
            await withAuditContext(ctx(), async () => {
                await accounts.authenticate('pat@example.gov', 'wrong-but-secret-password');
                await accounts.authenticate('pat@example.gov', password);
            });
            await accounts.requestPasswordReset('pat@example.gov');
            const reset = lastLink();
            secrets.push(reset);
            await accounts.resetPassword(reset, 'an entirely new passphrase');
            const { token } = createAuditToken(admin, 'Splunk');
            secrets.push(token);
            pullEvents(new Request('https://x/api/audit/events', { headers: { Authorization: `Bearer ${token}` } }), '10.0.0.1');
            pullEvents(new Request('https://x/api/audit/events', { headers: { Authorization: 'Bearer ensat_guessed-token-value' } }), '10.0.0.1');
            secrets.push('ensat_guessed-token-value');
            record({ action: 'job.completed', details: { password: 'detail-password-123', token: 'detail-token-456' } });
            secrets.push('detail-password-123', 'detail-token-456');
            const l = licenses.issueEvaluation(a, 'certalert');
            secrets.push(licenses.licenseById(l.id)!.token);
        } finally {
            removeFile();
        }

        const hec = await stubHec([]);
        let syslog = '';
        const server = createTcpServer((s) => s.on('data', (d) => (syslog += d.toString())));
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const h = new HecForwarder({ url: hec.url, token: 'hec-token', index: null, sourcetype: 'ens:audit', insecure: false }, { batchSize: 1000 });
        const s = new SyslogForwarder({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, protocol: 'tcp', facility: 'local0' }, { batchSize: 1000 });
        await h.tick();
        await s.tick();
        await new Promise((r) => setTimeout(r, 100));
        s.stop();
        await hec.close();
        await new Promise<void>((r) => server.close(() => r()));

        const sinks = {
            store: (db().prepare('SELECT line FROM audit_events').all() as { line: string }[]).map((r) => r.line).join('\n'),
            stdout: lines.join('\n'),
            file: readFileSync(join(dir, 'audit.jsonl'), 'utf8'),
            hec: hec.requests.map((r) => r.body).join('\n'),
            syslog,
            csv: await exportAudit((await accounts.accountByEmail('boss@ens-solutions.com'))!, new URL('https://x/e?format=csv')).text(),
        };
        expect(sinks.hec).toContain('auth.login');
        expect(sinks.syslog).toContain('auth.login');
        for (const [sink, text] of Object.entries(sinks)) {
            expect(text.length, sink).toBeGreaterThan(0);
            for (const secret of secrets) {
                expect(text.includes(secret), `${sink} contains a secret`).toBe(false);
            }
        }
        expect(sinks.store).toContain('[redacted]');
    });
});
