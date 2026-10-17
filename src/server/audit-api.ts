/*
 * HTTP handlers for the audit trail that aren't pages: the SIEM pull API
 * (GET /api/audit/events, bearer token) and the admin export
 * (GET /admin/audit/export). Kept here so tests can call them with a plain
 * Request.
 */

import type { Account } from './accounts';
import {
    CSV_COLUMNS,
    FILTER_KEYS,
    actorOf,
    authenticateAuditToken,
    countMatching,
    csvRow,
    exportRows,
    filterFrom,
    headSeq,
    linesAfter,
    record,
    recordCollapsed,
    anonymous,
    type AuditFilter,
} from './audit';
import { allow } from './rate-limit';

export const EXPORT_MAX = 100_000;

function problem(status: number, error: string, message: string, extra: Record<string, string> = {}): Response {
    return Response.json({ error, message }, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}

/**
 * GET /api/audit/events?after=<seq>&limit=<1..1000>. NDJSON by default,
 * {"events":[...],"next":<seq>} with Accept: application/json. Pulls are not
 * themselves audited (they'd feed back into what they read); the token's
 * last use is recorded instead. Bad tokens are: as a failed api-token
 * sign-in, collapsed per address and reason.
 */
export function pullEvents(request: Request, clientAddress: string): Response {
    const url = new URL(request.url);
    const auth = authenticateAuditToken(request.headers.get('authorization'));
    if ('error' in auth) {
        if (!allow(`audit-api-fail:${clientAddress}`, 20, 15 * 60_000)) {
            return problem(429, 'rate_limited', 'Too many failed attempts; wait and try again.', { 'Retry-After': '900' });
        }
        if (auth.error !== 'missing') {
            recordCollapsed(`api-token|${clientAddress}|${auth.error}`, {
                action: 'auth.login',
                outcome: 'failure',
                actor: anonymous(null),
                source: { ip: clientAddress, userAgent: request.headers.get('user-agent') },
                reason: auth.error === 'revoked' ? 'revoked token' : 'unknown token',
                details: { method: 'api-token', path: url.pathname },
            });
        }
        return problem(401, 'unauthorized', 'Send Authorization: Bearer <audit API token>.', { 'WWW-Authenticate': 'Bearer realm="ens-audit"' });
    }

    const afterRaw = url.searchParams.get('after') ?? '0';
    const limitRaw = url.searchParams.get('limit') ?? '500';
    const after = /^\d{1,15}$/.test(afterRaw) ? Number(afterRaw) : NaN;
    const limit = /^\d{1,4}$/.test(limitRaw) ? Number(limitRaw) : NaN;
    if (!Number.isSafeInteger(after) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
        return problem(400, 'bad_request', 'after must be a seq (0 or more) and limit 1 to 1000.');
    }

    const rows = linesAfter(after, limit);
    const next = rows.length ? rows.at(-1)!.seq : after;
    if ((request.headers.get('accept') ?? '').includes('application/json')) {
        const body = `{"events":[${rows.map((r) => r.line).join(',')}],"next":${next}}`;
        return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Audit-Next': String(next) } });
    }
    return new Response(rows.map((r) => `${r.line}\n`).join(''), {
        headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Audit-Next': String(next) },
    });
}

function filterDetails(f: AuditFilter): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const k of FILTER_KEYS) if (f[k]) out[`filter.${k}`] = f[k]!;
    return out;
}

/** GET /admin/audit/export?format=csv|ndjson&<filters>. The caller has checked the admin role. */
export function exportAudit(admin: Account, url: URL): Response {
    const format = url.searchParams.get('format') === 'ndjson' ? 'ndjson' : 'csv';
    const filter = filterFrom(url.searchParams);
    const upTo = headSeq();
    const count = Math.min(countMatching(filter), EXPORT_MAX);
    // Record the export before handing the data over: an export that can't be audited doesn't happen.
    record({ action: 'audit.exported', actor: actorOf(admin), details: { format, count, max: EXPORT_MAX, ...filterDetails(filter) } });

    const rows = exportRows(filter, EXPORT_MAX, upTo);
    const encoder = new TextEncoder();
    let header = format === 'csv' ? `${CSV_COLUMNS.join(',')}\r\n` : '';
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            let chunk = header;
            header = '';
            for (let i = 0; i < 500; i++) {
                const n = rows.next();
                if (n.done) {
                    if (chunk) controller.enqueue(encoder.encode(chunk));
                    controller.close();
                    return;
                }
                chunk += format === 'csv' ? `${csvRow(n.value.line)}\r\n` : `${n.value.line}\n`;
            }
            controller.enqueue(encoder.encode(chunk));
        },
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return new Response(stream, {
        headers: {
            'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
            'Content-Disposition': `attachment; filename="licensing-portal-audit-${stamp}.${format === 'csv' ? 'csv' : 'ndjson'}"`,
            'Cache-Control': 'no-store',
        },
    });
}
