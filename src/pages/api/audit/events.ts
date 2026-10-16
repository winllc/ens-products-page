/*
 * The SIEM pull API: GET /api/audit/events?after=<seq>&limit=<1..1000>, with
 * Authorization: Bearer <token from /admin/audit>. No session, no CSRF (a
 * GET with a bearer token can't be forged by another site).
 */
import type { APIRoute } from 'astro';
import { pullEvents } from '../../../server/audit-api';

export const prerender = false;

export const GET: APIRoute = (ctx) => pullEvents(ctx.request, ctx.clientAddress);
