/*
 * Outgoing email: address verification, password resets, and the contact
 * form's messages. With SMTP_URL unset the message is written to the log
 * instead, which is what local development and an enclave with no mail
 * relay get.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config';

let transport: Transporter | null = null;

export interface Mail {
    to: string;
    subject: string;
    text: string;
    /** Where a reply goes when that isn't MAIL_FROM: the contact form's visitor. */
    replyTo?: string;
}

/** The last messages sent, for tests and for `npm run dev` without SMTP. */
export const outbox: Mail[] = [];

export async function sendMail(mail: Mail): Promise<void> {
    outbox.push(mail);
    if (outbox.length > 50) {
        outbox.shift();
    }
    const c = config();
    if (!c.smtpUrl) {
        console.info(
            `licensing: email to ${mail.to} (no SMTP_URL configured)\n${mail.replyTo ? `Reply-To: ${mail.replyTo}\n` : ''}Subject: ${mail.subject}\n\n${mail.text}\n`,
        );
        return;
    }
    transport ??= nodemailer.createTransport(c.smtpUrl);
    await transport.sendMail({ from: c.mailFrom, ...mail });
}
