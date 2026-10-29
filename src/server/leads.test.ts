import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import { auditFor } from './audit';
import { resetConfigForTests } from './config';
import { closeDatabaseForTests, db } from './db';
import { resetKeysForTests } from './keys';
import * as leads from './leads';
import { outbox } from './mail';

const password = 'correct horse battery staple';

beforeAll(() => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ens-leads-'));
    process.env.LICENSING_DB = ':memory:';
    process.env.ADMIN_EMAILS = 'boss@ens-solutions.com';
    process.env.PUBLIC_URL = 'https://products.example.com';
    process.env.CONTACT_TO = 'sales@example.com';
    resetConfigForTests();
    resetKeysForTests();
});

afterAll(() => {
    delete process.env.CONTACT_TO;
    resetConfigForTests();
    closeDatabaseForTests();
});

beforeEach(() => {
    closeDatabaseForTests();
    outbox.length = 0;
    db();
});

const input = {
    name: '  Pat   Rivera ',
    email: 'Pat@Example.gov',
    organization: 'Example Agency',
    phone: '',
    topic: 'Pricing and quotes',
    message: 'Estimate from the ENS Solutions pricing page:\n\n- CertAlert: 10,000 directory users\n\nPlease call.',
};

describe('leads', () => {
    it('stores a message, records it, mails it to CONTACT_TO with the visitor as Reply-To, and acknowledges the visitor', async () => {
        const lead = await leads.createLead(input, { ip: '203.0.113.9' });
        expect(lead).toMatchObject({ name: 'Pat Rivera', email: 'pat@example.gov', status: 'new', source_ip: '203.0.113.9', topic: 'Pricing and quotes' });
        expect(lead.id).toMatch(/^lead_[0-9a-f]{20}$/);
        expect(lead.message).toContain('- CertAlert: 10,000 directory users\n\nPlease call.');

        expect(outbox).toHaveLength(2);
        const [toEns, toVisitor] = outbox as [typeof outbox[number], typeof outbox[number]];
        expect(toEns.to).toBe('sales@example.com');
        expect(toEns.replyTo).toBe('pat@example.gov');
        expect(toEns.subject).toBe('Pricing and quotes — website inquiry from Pat Rivera (Example Agency)');
        expect(toEns.text).toContain('Organization: Example Agency');
        expect(toEns.text).toContain(`https://products.example.com/admin/leads/${lead.id}`);
        expect(toVisitor.to).toBe('pat@example.gov');
        expect(toVisitor.replyTo).toBeUndefined();
        expect(toVisitor.text).toContain('> Please call.');

        const events = auditFor({}).filter((e) => e.action === 'lead.created');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ label: 'Contact form received', actor_email: 'pat@example.gov' });

        expect(leads.listLeads().map((l) => l.id)).toEqual([lead.id]);
        expect(leads.countLeads('new')).toBe(1);
    });

    it('refuses what the form would not send: missing fields, a bad address, an unknown topic, too much text', async () => {
        await expect(leads.createLead({ ...input, name: '' })).rejects.toMatchObject({ field: 'name' });
        await expect(leads.createLead({ ...input, email: 'not an address' })).rejects.toMatchObject({ field: 'email' });
        await expect(leads.createLead({ ...input, topic: 'Buy my product' })).rejects.toMatchObject({ field: 'topic' });
        await expect(leads.createLead({ ...input, message: 'x'.repeat(1501) })).rejects.toMatchObject({ field: 'message' });
        await expect(leads.createLead({ ...input, phone: '1'.repeat(41) })).rejects.toMatchObject({ field: 'phone' });
        expect(leads.listLeads()).toHaveLength(0);
        expect(outbox).toHaveLength(0);
    });

    it('lists newest first and lets an administrator move a lead through the statuses', async () => {
        const first = await leads.createLead(input);
        await new Promise((r) => setTimeout(r, 5));
        const second = await leads.createLead({ ...input, name: 'Sam', topic: 'General inquiry' });
        expect(leads.listLeads().map((l) => l.id)).toEqual([second.id, first.id]);

        await accounts.signUp({ email: 'boss@ens-solutions.com', password, name: 'Boss' });
        const token = decodeURIComponent(outbox.at(-1)!.text.match(/token=(\S+)/)![1]!);
        const admin = accounts.verifyEmail(token)!;

        const contacted = leads.setLeadStatus(admin, first, 'contacted');
        expect(contacted).toMatchObject({ status: 'contacted', updated_by: admin.id });
        expect(() => leads.setLeadStatus(admin, contacted, 'bogus')).toThrow(/Choose a status/);
        expect(leads.listLeads({ status: 'new' }).map((l) => l.id)).toEqual([second.id]);
        expect(leads.listLeads({ status: 'contacted' }).map((l) => l.id)).toEqual([first.id]);
        expect(auditFor({}).find((e) => e.action === 'lead.updated')).toMatchObject({ label: 'Lead updated', actor_email: 'boss@ens-solutions.com' });
    });
});
