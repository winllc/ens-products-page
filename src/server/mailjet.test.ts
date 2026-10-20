import { describe, expect, it, vi } from 'vitest';
import { parseAddress, sendViaMailjet } from './mailjet';

describe('mailjet', () => {
    it('parses addresses', () => {
        expect(parseAddress('ENS <a@b.com>')).toEqual({ Email: 'a@b.com', Name: 'ENS' });
        expect(parseAddress('a@b.com')).toEqual({ Email: 'a@b.com' });
    });

    it('posts to the send API with basic auth', async () => {
        const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        await sendViaMailjet({ apiKey: 'k', apiSecret: 's', apiUrl: 'https://x' }, 'ENS <f@e.com>', { to: 't@e.com', subject: 'S', text: 'T' }, f as never);
        const [url, init] = f.mock.calls[0];
        expect(url).toBe('https://x/v3.1/send');
        expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('k:s').toString('base64')}`);
        expect(JSON.parse(init.body).Messages[0].To).toEqual([{ Email: 't@e.com' }]);
    });

    it('throws on failure', async () => {
        const f = vi.fn().mockResolvedValue({ ok: false, status: 401 });
        await expect(sendViaMailjet({ apiKey: 'k', apiSecret: 's', apiUrl: 'https://x' }, 'f@e.com', { to: 't@e.com', subject: 'S', text: 'T' }, f as never)).rejects.toThrow('401');
    });
});
