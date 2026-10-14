/*
 * Outgoing email: address verification and password resets. With SMTP_URL
 * unset the message is written to the log instead, which is what local
 * development and an enclave with no mail relay get.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config';

let transport: Transporter | null = null;

export interface Mail {
    to: string;
    subject: string;
    text: string;
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
        console.info(`licensing: email to ${mail.to} (no SMTP_URL configured)\nSubject: ${mail.subject}\n\n${mail.text}\n`);
        return;
    }
    transport ??= nodemailer.createTransport(c.smtpUrl);
    await transport.sendMail({ from: c.mailFrom, ...mail });
}
