/*
 * Leads: what the contact form on the public site sends in. Each one is
 * stored, recorded in the audit trail, emailed to CONTACT_TO with the
 * visitor as Reply-To, and acknowledged to the visitor. ENS staff work the
 * list at /admin/leads, moving each lead from new to contacted to closed.
 *
 * The form is public, so this is the one part of the service that takes
 * input from people without an account: everything is length-checked, the
 * endpoint rate-limits by address, and nothing a visitor types is ever
 * reflected back into a page unescaped.
 */

import { contactLimits, contactTopicList } from '../data/contact';
import { normalizeEmail, type Account } from './accounts';
import { actorOf, anonymous, record } from './audit';
import { config } from './config';
import { db, nowIso, transaction } from './db';
import { sendMail } from './mail';
import { newId } from './secrets';

export type LeadStatus = 'new' | 'contacted' | 'closed';
export const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'contacted', 'closed'];
export const leadStatusLabel: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', closed: 'Closed' };

export interface Lead {
    id: string;
    created_at: string;
    name: string;
    email: string;
    organization: string;
    phone: string;
    topic: string;
    message: string;
    status: LeadStatus;
    source_ip: string | null;
    updated_at: string | null;
    updated_by: string | null;
}

export class LeadError extends Error {
    constructor(
        message: string,
        readonly field?: string,
    ) {
        super(message);
        this.name = 'LeadError';
    }
}

export interface LeadInput {
    name: string;
    email: string;
    organization?: string;
    phone?: string;
    topic: string;
    message: string;
}

function text(raw: string | undefined, max: number, field: string, required = false): string {
    const v = (raw ?? '').trim();
    if (required && !v) throw new LeadError('Required', field);
    if (v.length > max) throw new LeadError(`At most ${max} characters`, field);
    return v;
}

/** Checks and tidies what the form sent. Throws LeadError naming the field. */
export function validateLead(input: LeadInput): Required<LeadInput> {
    const name = text(input.name, contactLimits.name, 'name', true).replace(/\s+/g, ' ');
    const email = normalizeEmail(text(input.email, contactLimits.email, 'email', true));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LeadError('Enter a valid email address', 'email');
    const organization = text(input.organization, contactLimits.organization, 'organization').replace(/\s+/g, ' ');
    const phone = text(input.phone, contactLimits.phone, 'phone').replace(/\s+/g, ' ');
    const topic = text(input.topic, 80, 'topic', true);
    if (!contactTopicList.includes(topic)) throw new LeadError('Choose a topic from the list', 'topic');
    // Keep the visitor's line breaks and spacing; drop other control characters.
    const message = text(input.message, contactLimits.message, 'message', true).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    return { name, email, organization, phone, topic, message };
}

function hydrate(row: Lead): Lead {
    return { ...row };
}

export function leadById(id: string): Lead | null {
    const row = db().prepare('SELECT * FROM leads WHERE id = ?').get(id) as Lead | undefined;
    return row ? hydrate(row) : null;
}

export function listLeads(filter: { status?: string } = {}): Lead[] {
    const status = LEAD_STATUSES.includes(filter.status as LeadStatus) ? (filter.status as LeadStatus) : null;
    const rows = (
        status
            ? db().prepare('SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC LIMIT 1000').all(status)
            : db().prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 1000').all()
    ) as unknown as Lead[];
    return rows.map(hydrate);
}

export function countLeads(status: LeadStatus): number {
    return (db().prepare('SELECT COUNT(*) AS n FROM leads WHERE status = ?').get(status) as { n: number }).n;
}

/** The message as ENS receives it, and as the visitor sees it quoted back. */
function describe(lead: Required<LeadInput>): string {
    const lines = [`Name: ${lead.name}`, `Email: ${lead.email}`];
    if (lead.organization) lines.push(`Organization: ${lead.organization}`);
    if (lead.phone) lines.push(`Phone: ${lead.phone}`);
    lines.push(`Topic: ${lead.topic}`, '', lead.message);
    return lines.join('\n');
}

/**
 * Stores a lead and records it; then (after the row is committed) mails it to
 * ENS and acknowledges it to the visitor. A mail failure is logged, not
 * surfaced: the lead is kept and shown at /admin/leads either way.
 */
export async function createLead(input: LeadInput, source: { ip: string | null } = { ip: null }): Promise<Lead> {
    const lead = validateLead(input);
    const id = newId('lead');
    transaction(() => {
        db()
            .prepare(
                `INSERT INTO leads (id, created_at, name, email, organization, phone, topic, message, status, source_ip)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
            )
            .run(id, nowIso(), lead.name, lead.email, lead.organization, lead.phone, lead.topic, lead.message, source.ip);
        record({
            action: 'lead.created',
            actor: anonymous(lead.email),
            target: { type: 'lead', id, name: lead.topic },
            details: { topic: lead.topic, organization: lead.organization || null, messageLength: lead.message.length },
        });
    });

    const c = config();
    const subject = `${lead.topic} — website inquiry from ${lead.name}${lead.organization ? ` (${lead.organization})` : ''}`;
    const site = c.publicUrl;
    const results = await Promise.allSettled([
        sendMail({
            to: c.contactTo,
            replyTo: lead.email,
            subject,
            text: `${describe(lead)}\n\n--\nSent from the contact form at ${site}/contact.html. Lead ${id}: ${site}/admin/leads/${id}`,
        }),
        sendMail({
            to: lead.email,
            subject: 'We have your message — ENS Solutions',
            text:
                `Hello ${lead.name},\n\n` +
                `Thanks for getting in touch. We have your message about "${lead.topic}" and will reply within one business day.\n\n` +
                `For reference, here is what you sent:\n\n${indent(describe(lead))}\n\n` +
                `If you need us sooner, call 301-925-4008 or email ${c.contactTo}.\n\nENS Solutions, LLC`,
        }),
    ]);
    for (const r of results) {
        if (r.status === 'rejected') console.error(`licensing: could not send lead ${id}: ${(r.reason as Error).message}`);
    }
    return leadById(id)!;
}

function indent(s: string): string {
    return s
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
}

export function setLeadStatus(actor: Account, lead: Lead, status: string): Lead {
    if (!LEAD_STATUSES.includes(status as LeadStatus)) throw new LeadError('Choose a status');
    if (status === lead.status) return lead;
    transaction(() => {
        db().prepare('UPDATE leads SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(status, nowIso(), actor.id, lead.id);
        record({
            action: 'lead.updated',
            actor: actorOf(actor),
            target: { type: 'lead', id: lead.id, name: lead.topic },
            details: { 'status.old': lead.status, 'status.new': status },
        });
    });
    return leadById(lead.id)!;
}
