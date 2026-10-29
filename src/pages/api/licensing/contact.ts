/*
 * POST /api/licensing/contact: the contact form's destination. Takes the
 * form's fields as JSON (from src/scripts/contact.ts) or as a plain form post
 * (the page without JavaScript), stores the lead, emails it to ENS and
 * acknowledges the visitor (src/server/leads.ts).
 *
 * Answers JSON to a JSON request and a 303 back to /contact.html?sent=1#sent
 * to a form post. Astro's checkOrigin refuses a form post from another
 * site; a JSON post from another site is stopped by the browser's preflight,
 * since nothing here answers CORS.
 */

import type { APIRoute } from 'astro';
import { CONTACT_HONEYPOT } from '../../../data/contact';
import { limited } from '../../../server/http';
import { createLead, LeadError } from '../../../server/leads';

export const prerender = false;

const SENT = '/contact.html?sent=1#sent';
const FIELDS = ['name', 'email', 'organization', 'phone', 'topic', 'message', CONTACT_HONEYPOT] as const;
type Field = (typeof FIELDS)[number];

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function fields(request: Request): Promise<{ values: Record<Field, string>; wantsJson: boolean } | null> {
    const type = request.headers.get('content-type') ?? '';
    const values = Object.fromEntries(FIELDS.map((f) => [f, ''])) as Record<Field, string>;
    if (type.includes('application/json')) {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return null;
        }
        if (!body || typeof body !== 'object') return null;
        for (const f of FIELDS) {
            const v = (body as Record<string, unknown>)[f];
            if (typeof v === 'string') values[f] = v;
        }
        return { values, wantsJson: true };
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
        const data = await request.formData();
        for (const f of FIELDS) {
            const v = data.get(f);
            if (typeof v === 'string') values[f] = v;
        }
        return { values, wantsJson: (request.headers.get('accept') ?? '').includes('application/json') };
    }
    return null;
}

export const POST: APIRoute = async (ctx) => {
    const parsed = await fields(ctx.request);
    if (!parsed) return json(415, { error: 'Send the form as JSON or as a form post' });
    const { values, wantsJson } = parsed;
    const done = (status: number, body: Record<string, unknown>) => (wantsJson ? json(status, body) : ctx.redirect(SENT, 303));

    // A bot filled the field people can't see: say yes and keep nothing.
    if (values[CONTACT_HONEYPOT].trim()) {
        return wantsJson ? new Response(null, { status: 204 }) : ctx.redirect(SENT, 303);
    }

    if (limited(ctx, 'contact', values.email.trim().toLowerCase(), 5, 60)) {
        const error = 'Too many messages from this address in the last hour. Email info@ens-solutions.com instead.';
        return wantsJson ? json(429, { error }) : new Response(error, { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    let ip: string | null = null;
    try {
        ip = ctx.clientAddress ?? null;
    } catch {
        ip = null;
    }

    try {
        const lead = await createLead(
            {
                name: values.name,
                email: values.email,
                organization: values.organization,
                phone: values.phone,
                topic: values.topic,
                message: values.message,
            },
            { ip },
        );
        return done(200, { ok: true, id: lead.id });
    } catch (err) {
        if (err instanceof LeadError) {
            const error = err.field ? `${err.field}: ${err.message}` : err.message;
            return wantsJson
                ? json(400, { error: err.message, field: err.field ?? null })
                : new Response(error, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
        throw err;
    }
};

export const GET: APIRoute = () => new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
