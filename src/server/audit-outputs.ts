/*
 * Where audit events go besides the database (which is the source of truth):
 *
 *   stdout   one raw JSON line per event, the "ens.audit" stream: nothing
 *            else this service prints starts with {"schema":"ens-audit/1"
 *            (its own diagnostics go to stderr). On unless
 *            ENS_AUDIT_STDOUT=false.
 *   file     ENS_AUDIT_FILE, the same lines, rotated daily or at 100 MB,
 *            keeping ENS_AUDIT_FILE_KEEP rotated files.
 *   HEC      Splunk HTTP Event Collector, batches of up to 100.
 *   syslog   RFC 5424 over udp, tcp or tls (octet-counted framing).
 *
 * stdout and file are written synchronously once the event is committed; a
 * failure there is logged and nothing else happens. HEC and syslog are
 * background forwarders that read the store from a cursor kept in the
 * audit_outputs table, so delivery is at-least-once, survives restarts and
 * never slows a request. They back off exponentially (up to 5 minutes) and
 * record audit.delivery-failed after 15 minutes of failure, then
 * audit.delivery-recovered.
 *
 * Only Node built-ins: node:http(s), node:net, node:tls, node:dgram.
 */

import dgram from 'node:dgram';
import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, existsSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { basename, dirname, extname, join } from 'node:path';
import tls from 'node:tls';
import { PRODUCT, buildVersion, type AuditEvent, type Severity } from './audit-format';
import { SYSTEM, addLineSink, auditEvents, headSeq, linesAfter, pruneAudit, record } from './audit';
import { config, type AuditConfig } from './config';
import { db, nowIso } from './db';

const log = (msg: string) => process.stderr.write(`ens.audit: ${msg}\n`);

/* ---- Rotating file ---------------------------------------------------------- */

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export class RotatingFile {
    private day: string | null = null;
    private size = 0;

    constructor(
        readonly path: string,
        readonly keep: number,
        private readonly now: () => number = Date.now,
        private readonly maxBytes = MAX_FILE_BYTES,
    ) {
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path)) {
            const st = statSync(path);
            this.day = utcDay(st.mtimeMs);
            this.size = st.size;
        }
    }

    write(line: string): void {
        const bytes = Buffer.byteLength(line) + 1;
        const today = utcDay(this.now());
        if (this.day !== null && this.size > 0 && (this.day !== today || this.size + bytes > this.maxBytes)) {
            this.rotate();
        }
        appendFileSync(this.path, `${line}\n`);
        this.day = today;
        this.size += bytes;
    }

    /** audit.jsonl becomes audit-<day>.jsonl (or audit-<day>.<n>.jsonl). */
    private rotate(): void {
        const ext = extname(this.path);
        const stem = basename(this.path, ext);
        const dir = dirname(this.path);
        let target = join(dir, `${stem}-${this.day}${ext}`);
        for (let n = 1; existsSync(target); n++) target = join(dir, `${stem}-${this.day}.${n}${ext}`);
        renameSync(this.path, target);
        this.size = 0;
        this.prune(dir, stem, ext);
    }

    private prune(dir: string, stem: string, ext: string): void {
        const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}(\\.\\d+)?${ext.replace('.', '\\.')}$`);
        const rotated = readdirSync(dir)
            .filter((f) => pattern.test(f))
            .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t || b.f.localeCompare(a.f));
        for (const { f } of rotated.slice(this.keep)) unlinkSync(join(dir, f));
    }
}

/* ---- Status ------------------------------------------------------------------ */

export interface OutputStatus {
    output: string;
    enabled: boolean;
    detail: string;
    lastSeq: number | null;
    lastAt: string | null;
    backlog: number | null;
    lastError: string | null;
    lastErrorAt: string | null;
}

interface SyncState {
    lastSeq: number | null;
    lastAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
}

const syncState: Record<'stdout' | 'file', SyncState> = {
    stdout: { lastSeq: null, lastAt: null, lastError: null, lastErrorAt: null },
    file: { lastSeq: null, lastAt: null, lastError: null, lastErrorAt: null },
};

interface CursorRow {
    output: string;
    seq: number;
    delivered_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
    failing_since: string | null;
    alerted: number;
}

function cursorRow(output: string): CursorRow | null {
    return (db().prepare('SELECT * FROM audit_outputs WHERE output = ?').get(output) as CursorRow | undefined) ?? null;
}

/* ---- Forwarders ---------------------------------------------------------------- */

export interface ForwarderOptions {
    batchSize?: number;
    pollMs?: number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    alertAfterMs?: number;
}

export abstract class Forwarder {
    abstract readonly output: string;
    abstract readonly description: string;
    protected readonly batchSize: number;
    private readonly pollMs: number;
    private readonly baseBackoffMs: number;
    private readonly maxBackoffMs: number;
    private readonly alertAfterMs: number;
    private timer: NodeJS.Timeout | null = null;
    private busy = false;
    private stopped = true;
    private failures = 0;
    private backingOff = false;
    private readonly onAppended = () => {
        if (!this.backingOff) this.schedule(50);
    };

    constructor(opts: ForwarderOptions = {}) {
        this.batchSize = opts.batchSize ?? 100;
        this.pollMs = opts.pollMs ?? 5_000;
        this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
        this.maxBackoffMs = opts.maxBackoffMs ?? 5 * 60_000;
        this.alertAfterMs = opts.alertAfterMs ?? 15 * 60_000;
    }

    /** Delivers the lines, in order; throws if they weren't accepted. */
    protected abstract send(lines: string[]): Promise<void>;
    protected close(): void {}

    start(): void {
        if (!this.stopped) return;
        this.stopped = false;
        db().prepare('INSERT OR IGNORE INTO audit_outputs (output, seq) VALUES (?, 0)').run(this.output);
        auditEvents.on('appended', this.onAppended);
        this.schedule(0);
    }

    stop(): void {
        this.stopped = true;
        auditEvents.off('appended', this.onAppended);
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.close();
    }

    cursor(): number {
        return cursorRow(this.output)?.seq ?? 0;
    }

    private schedule(ms: number): void {
        if (this.stopped) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.tick(), ms);
        this.timer.unref?.();
    }

    /** One delivery attempt: true when it sent something or had nothing to send. */
    async tick(): Promise<boolean> {
        if (this.busy) return false;
        this.busy = true;
        try {
            db().prepare('INSERT OR IGNORE INTO audit_outputs (output, seq) VALUES (?, 0)').run(this.output);
            const from = this.cursor();
            const batch = linesAfter(from, this.batchSize);
            if (!batch.length) {
                this.schedule(this.pollMs);
                return true;
            }
            try {
                await this.send(batch.map((b) => b.line));
            } catch (err) {
                this.failed(err as Error);
                return false;
            }
            this.delivered(batch.at(-1)!.seq);
            this.schedule(batch.length === this.batchSize ? 0 : this.pollMs);
            return true;
        } finally {
            this.busy = false;
        }
    }

    private delivered(seq: number): void {
        const before = cursorRow(this.output);
        db()
            .prepare('UPDATE audit_outputs SET seq = ?, delivered_at = ?, failing_since = NULL, alerted = 0 WHERE output = ?')
            .run(seq, nowIso(), this.output);
        this.failures = 0;
        this.backingOff = false;
        if (before?.alerted) {
            log(`${this.output}: delivering again`);
            record({ action: 'audit.delivery-recovered', actor: SYSTEM, source: null, details: { output: this.output, failingSince: before.failing_since } });
        }
    }

    private failed(err: Error): void {
        const message = (err.message || String(err)).slice(0, 500);
        const now = nowIso();
        const row = cursorRow(this.output);
        const since = row?.failing_since ?? now;
        db()
            .prepare('UPDATE audit_outputs SET last_error = ?, last_error_at = ?, failing_since = ? WHERE output = ?')
            .run(message, now, since, this.output);
        if (this.failures === 0) log(`${this.output}: delivery failed, will retry: ${message}`);
        this.failures++;
        if (row && !row.alerted && Date.now() - Date.parse(since) >= this.alertAfterMs) {
            db().prepare('UPDATE audit_outputs SET alerted = 1 WHERE output = ?').run(this.output);
            log(`${this.output}: failing since ${since}`);
            record({ action: 'audit.delivery-failed', outcome: 'failure', severity: 'alert', actor: SYSTEM, source: null, reason: message, details: { output: this.output, error: message, failingSince: since } });
        }
        this.backingOff = true;
        this.schedule(Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** Math.min(this.failures - 1, 20)));
    }

    status(enabled = true): OutputStatus {
        const row = cursorRow(this.output);
        const head = headSeq();
        return {
            output: this.output,
            enabled,
            detail: this.description,
            lastSeq: row?.seq ?? 0,
            lastAt: row?.delivered_at ?? null,
            backlog: Math.max(0, head - (row?.seq ?? 0)),
            lastError: row?.last_error ?? null,
            lastErrorAt: row?.last_error_at ?? null,
        };
    }
}

/* ---- Splunk HEC ------------------------------------------------------------------ */

export function hecPayload(lines: string[], cfg: { sourcetype: string; index: string | null }): string {
    return lines
        .map((line) => {
            const event = JSON.parse(line) as AuditEvent;
            return JSON.stringify({
                time: Date.parse(event.time) / 1000,
                host: event.host,
                source: PRODUCT,
                sourcetype: cfg.sourcetype,
                ...(cfg.index ? { index: cfg.index } : {}),
                event,
            });
        })
        .join('\n');
}

function post(url: URL, body: string, headers: Record<string, string>, insecure: boolean): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(
            url,
            {
                method: 'POST',
                headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
                timeout: 30_000,
                ...(url.protocol === 'https:' && insecure ? { rejectUnauthorized: false } : {}),
            },
            (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (c: string) => {
                    if (text.length < 2000) text += c;
                });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
                res.on('error', reject);
            },
        );
        req.on('timeout', () => req.destroy(new Error('timed out after 30 s')));
        req.on('error', reject);
        req.end(body);
    });
}

export class HecForwarder extends Forwarder {
    readonly output = 'splunk-hec';
    readonly description: string;
    private readonly endpoint: URL;

    constructor(
        private readonly cfg: NonNullable<AuditConfig['splunk']>,
        opts?: ForwarderOptions,
    ) {
        super(opts);
        this.endpoint = new URL('/services/collector/event', `${cfg.url}/`);
        this.description = `${this.endpoint.origin}${cfg.index ? `, index ${cfg.index}` : ''}, sourcetype ${cfg.sourcetype}${cfg.insecure ? ', TLS NOT VERIFIED' : ''}`;
    }

    protected async send(lines: string[]): Promise<void> {
        const res = await post(
            this.endpoint,
            hecPayload(lines, this.cfg),
            { Authorization: `Splunk ${this.cfg.token}`, 'Content-Type': 'application/json' },
            this.cfg.insecure,
        );
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`HEC answered ${res.status}${res.text ? `: ${res.text.slice(0, 200).replace(/\s+/g, ' ')}` : ''}`);
        }
    }
}

/* ---- Syslog ------------------------------------------------------------------------- */

const FACILITIES: Record<string, number> = {
    kern: 0, user: 1, mail: 2, daemon: 3, auth: 4, syslog: 5, lpr: 6, news: 7, uucp: 8, cron: 9, authpriv: 10, ftp: 11,
    local0: 16, local1: 17, local2: 18, local3: 19, local4: 20, local5: 21, local6: 22, local7: 23,
};
const SYSLOG_SEVERITY: Record<Severity, number> = { info: 6, notice: 5, warning: 4, alert: 1 };

/** PRINTUSASCII without spaces, as RFC 5424 header fields require. */
const headerField = (s: string | null | undefined, max: number) => (s ? s.replace(/[^\x21-\x7e]/g, '_').slice(0, max) : '') || '-';

/** One RFC 5424 message: no structured data, the JSON line as MSG. */
export function syslogMessage(line: string, facility: string, pid: number | string = process.pid): string {
    const e = JSON.parse(line) as AuditEvent;
    const fac = FACILITIES[facility] ?? FACILITIES.local0!;
    const pri = fac * 8 + (SYSLOG_SEVERITY[e.severity] ?? 6);
    return `<${pri}>1 ${e.time} ${headerField(e.host, 255)} ${headerField(PRODUCT, 48)} ${headerField(String(pid), 128)} ${headerField(e.action, 32)} - ${line}`;
}

/** RFC 6587 / RFC 5425 octet counting: "<length in bytes> <message>". */
export function octetFrame(msg: string): string {
    return `${Buffer.byteLength(msg)} ${msg}`;
}

export class SyslogForwarder extends Forwarder {
    readonly output = 'syslog';
    readonly description: string;
    private socket: net.Socket | null = null;
    private udp: dgram.Socket | null = null;

    constructor(
        private readonly cfg: NonNullable<AuditConfig['syslog']>,
        opts?: ForwarderOptions,
    ) {
        super(opts);
        if (!(cfg.facility in FACILITIES)) throw new Error(`ENS_AUDIT_SYSLOG_FACILITY: unknown facility ${cfg.facility}`);
        this.description = `${cfg.protocol}://${cfg.host}:${cfg.port}, facility ${cfg.facility}`;
    }

    protected async send(lines: string[]): Promise<void> {
        const messages = lines.map((l) => syslogMessage(l, this.cfg.facility));
        if (this.cfg.protocol === 'udp') {
            this.udp ??= dgram.createSocket(net.isIPv6(this.cfg.host) ? 'udp6' : 'udp4').on('error', () => {
                this.udp?.close();
                this.udp = null;
            });
            for (const m of messages) {
                await new Promise<void>((resolve, reject) => this.udp!.send(Buffer.from(m), this.cfg.port, this.cfg.host, (err) => (err ? reject(err) : resolve())));
            }
            return;
        }
        const socket = await this.connect();
        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => reject(err);
            socket.once('error', onError);
            socket.write(messages.map(octetFrame).join(''), (err) => {
                socket.off('error', onError);
                if (err) reject(err);
                else resolve();
            });
        }).catch((err) => {
            this.close();
            throw err;
        });
    }

    private connect(): Promise<net.Socket> {
        if (this.socket && !this.socket.destroyed && this.socket.writable) return Promise.resolve(this.socket);
        return new Promise((resolve, reject) => {
            const { host, port } = this.cfg;
            const s =
                this.cfg.protocol === 'tls'
                    ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host }, () => done())
                    : net.connect({ host, port }, () => done());
            const timer = setTimeout(() => s.destroy(new Error('connect timed out after 15 s')), 15_000);
            const done = () => {
                clearTimeout(timer);
                s.off('error', fail);
                s.on('error', () => s.destroy());
                s.on('close', () => {
                    if (this.socket === s) this.socket = null;
                });
                // Nothing is expected back from a syslog receiver.
                s.on('data', () => {});
                this.socket = s;
                resolve(s);
            };
            const fail = (err: Error) => {
                clearTimeout(timer);
                s.destroy();
                reject(err);
            };
            s.once('error', fail);
        });
    }

    protected override close(): void {
        this.socket?.destroy();
        this.socket = null;
        this.udp?.close();
        this.udp = null;
    }
}

/* ---- Starting and stopping --------------------------------------------------------- */

interface Running {
    forwarders: Forwarder[];
    removeSinks: (() => void)[];
    timers: NodeJS.Timeout[];
    cfg: AuditConfig;
}

const RUNNING = Symbol.for('ens.audit.running');
type GlobalWithAudit = typeof globalThis & { [RUNNING]?: Running };

function running(): Running | undefined {
    return (globalThis as GlobalWithAudit)[RUNNING];
}

/** Every output, for the admin page's delivery panel. */
export function outputStatus(): OutputStatus[] {
    const r = running();
    const cfg = r?.cfg ?? config().audit;
    const sync = (name: 'stdout' | 'file', enabled: boolean, detail: string): OutputStatus => ({
        output: name,
        enabled,
        detail,
        lastSeq: syncState[name].lastSeq,
        lastAt: syncState[name].lastAt,
        backlog: null,
        lastError: syncState[name].lastError,
        lastErrorAt: syncState[name].lastErrorAt,
    });
    const hec = r?.forwarders.find((f) => f.output === 'splunk-hec');
    const syslog = r?.forwarders.find((f) => f.output === 'syslog');
    const off = (output: string, detail: string): OutputStatus => ({
        output,
        enabled: false,
        detail,
        lastSeq: cursorRow(output)?.seq ?? null,
        lastAt: cursorRow(output)?.delivered_at ?? null,
        backlog: null,
        lastError: null,
        lastErrorAt: null,
    });
    return [
        sync('stdout', cfg.stdout, 'One JSON line per event on standard output'),
        sync('file', !!cfg.file, cfg.file ? `${cfg.file}, daily or 100 MB, keep ${cfg.fileKeep}` : 'ENS_AUDIT_FILE not set'),
        hec ? hec.status() : off('splunk-hec', cfg.splunk ? 'Configured, not running in this process' : 'ENS_AUDIT_SPLUNK_URL not set'),
        syslog ? syslog.status() : off('syslog', cfg.syslog ? 'Configured, not running in this process' : 'ENS_AUDIT_SYSLOG_HOST not set'),
    ];
}

function syncSink(name: 'stdout' | 'file', write: (line: string) => void) {
    return (line: string, seq: number) => {
        try {
            write(line);
            syncState[name].lastSeq = seq;
            syncState[name].lastAt = nowIso();
        } catch (err) {
            const message = (err as Error).message;
            if (syncState[name].lastError !== message) log(`${name}: write failed: ${message}`);
            syncState[name].lastError = message;
            syncState[name].lastErrorAt = nowIso();
        }
    };
}

/** The lowest seq every enabled forwarder has delivered: pruning stops there. */
function deliveredUpTo(r: Running): number {
    return r.forwarders.reduce((min, f) => Math.min(min, f.cursor()), Number.MAX_SAFE_INTEGER);
}

function runRetention(r: Running): void {
    const started = Date.now();
    try {
        pruneAudit(r.cfg.retentionDays, deliveredUpTo(r));
    } catch (err) {
        log(`retention: ${(err as Error).message}`);
        record({ action: 'job.failed', outcome: 'failure', actor: SYSTEM, source: null, reason: (err as Error).message, details: { job: 'audit-retention', durationMs: Date.now() - started } });
    }
}

/**
 * Starts the outputs, the retention job and records system.started. Safe to
 * call more than once: only the first call in a process does anything.
 */
export function startAudit(): void {
    const g = globalThis as GlobalWithAudit;
    if (g[RUNNING]) return;
    const cfg = config().audit;
    db();
    const r: Running = { forwarders: [], removeSinks: [], timers: [], cfg };
    g[RUNNING] = r;

    if (cfg.stdout) r.removeSinks.push(addLineSink(syncSink('stdout', (line) => process.stdout.write(`${line}\n`))));
    log(`output stdout: ${cfg.stdout ? 'enabled' : 'disabled'}`);
    if (cfg.file) {
        try {
            const file = new RotatingFile(cfg.file, cfg.fileKeep);
            r.removeSinks.push(addLineSink(syncSink('file', (line) => file.write(line))));
            log(`output file: enabled, ${cfg.file}, keeping ${cfg.fileKeep} rotated files`);
        } catch (err) {
            syncState.file.lastError = (err as Error).message;
            syncState.file.lastErrorAt = nowIso();
            log(`output file: FAILED to open ${cfg.file}: ${(err as Error).message}`);
        }
    } else {
        log('output file: disabled');
    }
    if (cfg.splunk) {
        if (!cfg.splunk.token) log('output splunk-hec: ENS_AUDIT_SPLUNK_URL is set but no token; Splunk will refuse events');
        if (cfg.splunk.insecure) log('WARNING: ENS_AUDIT_SPLUNK_INSECURE=true, the HEC certificate is not verified. Use only in test setups.');
        const f = new HecForwarder(cfg.splunk);
        r.forwarders.push(f);
        log(`output splunk-hec: enabled, ${f.description}`);
    } else {
        log('output splunk-hec: disabled');
    }
    if (cfg.syslog) {
        const f = new SyslogForwarder(cfg.syslog);
        r.forwarders.push(f);
        log(`output syslog: enabled, ${f.description}`);
    } else {
        log('output syslog: disabled');
    }
    log(`retention: ${cfg.retentionDays > 0 ? `${cfg.retentionDays} days` : 'keep forever'}`);

    record({
        action: 'system.started',
        actor: SYSTEM,
        source: null,
        details: {
            version: buildVersion(),
            node: process.version,
            stdout: cfg.stdout,
            file: !!cfg.file,
            splunkHec: !!cfg.splunk,
            syslog: cfg.syslog ? cfg.syslog.protocol : false,
            retentionDays: cfg.retentionDays,
        },
    });
    for (const f of r.forwarders) f.start();

    if (cfg.retentionDays > 0) {
        const first = setTimeout(() => runRetention(r), 60_000);
        const daily = setInterval(() => runRetention(r), 24 * 60 * 60_000);
        first.unref();
        daily.unref();
        r.timers.push(first, daily);
    }

    let stopping = false;
    const shutdown = (signal: NodeJS.Signals) => {
        if (stopping) return;
        stopping = true;
        record({ action: 'system.stopped', actor: SYSTEM, source: null, details: { signal } });
        // One last delivery attempt, then go.
        void Promise.race([Promise.all(r.forwarders.map((f) => f.tick())), new Promise((res) => setTimeout(res, 2_000).unref())]).finally(() => {
            stopAudit();
            process.exit(0);
        });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

export function stopAudit(): void {
    const g = globalThis as GlobalWithAudit;
    const r = g[RUNNING];
    if (!r) return;
    for (const f of r.forwarders) f.stop();
    for (const remove of r.removeSinks) remove();
    for (const t of r.timers) clearTimeout(t);
    delete g[RUNNING];
}
