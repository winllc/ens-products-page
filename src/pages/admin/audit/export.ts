import type { APIRoute } from 'astro';
import { exportAudit } from '../../../server/audit-api';
import { requireAdmin } from '../../../server/http';

export const prerender = false;

/** The audit log under the current filter, as CSV or NDJSON (audited as audit.exported). */
export const GET: APIRoute = (ctx) => {
    const admin = requireAdmin(ctx);
    if (admin instanceof Response) return admin;
    return exportAudit(admin, ctx.url);
};
