/*
 * Outgoing email: address verification, password resets, and the contact
 * form's messages. Sent through, in order of preference:
 *
 *   1. SMTP, when SMTP_URL is set;
 *   2. Mailjet's Send API (v3.1), when MAILJET_API_KEY and MAILJET_SECRET_KEY
 *      are set;
 *   3. nowhere: the message is written to the log instead, which is what
 *      local development and an enclave with no mail relay get.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config, type MailjetConfig } from './config';

let transport: Transporter | null = null;

export interface Mail {
    to: string;
    subject: string;
    text: string;
    /** Where a reply goes when that isn't MAIL_FROM: the contact form's visitor. */
    replyTo?: string;
}

/** An email that could not be sent (SMTP or Mailjet refused it, or could not be reached). */
export class MailError extends Error {}

/** The last messages sent, for tests and for `npm run dev` without a mail service. */
export const outbox: Mail[] = [];

export async function sendMail(mail: Mail): Promise<void> {
    outbox.push(mail);
    if (outbox.length > 50) {
        outbox.shift();
    }
    const c = config();
    if (c.smtpUrl) {
        transport ??= nodemailer.createTransport(c.smtpUrl);
        try {
            await transport.sendMail({ from: c.mailFrom, ...mail });
        } catch (e) {
            throw new MailError(`SMTP did not send the email to ${mail.to}: ${(e as Error).message}`);
        }
        return;
    }
    if (c.mailjet) {
        await sendWithMailjet(c.mailjet, c.mailFrom, mail);
        return;
    }
    console.info(
        `licensing: email to ${mail.to} (no SMTP_URL or Mailjet keys configured)\n${mail.replyTo ? `Reply-To: ${mail.replyTo}\n` : ''}Subject: ${mail.subject}\n\n${mail.text}\n`,
    );
}

interface Address {
    Email: string;
    Name?: string;
}

/** `Name <address>`, `"Name" <address>` or a bare address. */
export function parseAddress(value: string): Address {
    const m = value.trim().match(/^(.*?)\s*<([^<>\s]+)>$/);
    if (!m) {
        return { Email: value.trim() };
    }
    const name = m[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return name ? { Email: m[2], Name: name } : { Email: m[2] };
}

const MAILJET_TIMEOUT_MS = 15_000;

/** POST /v3.1/send, one message. Throws with Mailjet's reason when it is not sent. */
async function sendWithMailjet(mj: MailjetConfig, from: string, mail: Mail): Promise<void> {
    const message: Record<string, unknown> = {
        From: parseAddress(from),
        To: [parseAddress(mail.to)],
        Subject: mail.subject,
        TextPart: mail.text,
    };
    if (mail.replyTo) {
        message.ReplyTo = parseAddress(mail.replyTo);
    }
    const auth = Buffer.from(`${mj.apiKey}:${mj.secretKey}`).toString('base64');
    let res: Response;
    try {
        res = await fetch(`${mj.apiUrl}/v3.1/send`, {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ Messages: [message] }),
            signal: AbortSignal.timeout(MAILJET_TIMEOUT_MS),
        });
    } catch (e) {
        throw new MailError(`Mailjet could not be reached: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as MailjetResponse | null;
    const result = body?.Messages?.[0];
    if (res.ok && result?.Status === 'success') {
        return;
    }
    const reasons = [
        ...(result?.Errors ?? []).map((e) => [e.ErrorCode, e.ErrorMessage, e.ErrorRelatedTo?.join(', ')].filter(Boolean).join(' ')),
        body?.ErrorMessage,
    ].filter(Boolean);
    throw new MailError(`Mailjet did not send the email to ${mail.to} (HTTP ${res.status}${reasons.length ? `: ${reasons.join('; ')}` : ''})`);
}

interface MailjetResponse {
    Messages?: {
        Status?: string;
        Errors?: { ErrorCode?: string; ErrorMessage?: string; ErrorRelatedTo?: string[] }[];
    }[];
    /** On a request refused as a whole (401, a malformed body). */
    ErrorMessage?: string;
}

/** Tests change the configuration between cases. */
export function resetMailForTests(): void {
    transport = null;
}
