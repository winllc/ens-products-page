/*
 * Mailjet Send API v3.1 client: an HTTP alternative to SMTP.
 * https://dev.mailjet.com/email/guides/send-api-v31/
 */

import type { Mail } from './mail';

export interface MailjetConfig {
    apiKey: string;
    apiSecret: string;
    apiUrl: string;
}

/** Splits `Name <addr@example.com>` into Mailjet's {Email, Name}. */
export function parseAddress(value: string): { Email: string; Name?: string } {
    const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value);
    if (m) {
        const name = m[1]?.trim();
        return name ? { Email: m[2].trim(), Name: name } : { Email: m[2].trim() };
    }
    return { Email: value.trim() };
}

export async function sendViaMailjet(
    cfg: MailjetConfig,
    from: string,
    mail: Mail,
    fetchImpl: typeof fetch = fetch,
): Promise<void> {
    const res = await fetchImpl(`${cfg.apiUrl}/v3.1/send`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64')}`,
        },
        body: JSON.stringify({
            Messages: [
                {
                    From: parseAddress(from),
                    To: [parseAddress(mail.to)],
                    Subject: mail.subject,
                    TextPart: mail.text,
                },
            ],
        }),
    });
    if (!res.ok) {
        throw new Error(`Mailjet send failed: HTTP ${res.status}`);
    }
}
