/*
 * Contact form.
 *
 * On submit this posts the fields as JSON to the licensing service
 * (src/pages/api/licensing/contact.ts), which stores the message, emails it
 * to ENS and acknowledges it, and shows the answer in place. Without this
 * script the browser posts the form itself and comes back to #sent.
 *
 * If the service can't be reached, or answers with a server error, the form
 * falls back to what it did before there was a service: it composes a
 * mailto: link from the fields and hands it to the visitor's own email app,
 * so a visitor on a network where the licensing service is down still gets
 * somewhere.
 *
 * Query parameters:
 *   ?product=certalert   pre-selects the topic (keys in src/data/products.ts)
 *   ?message=...         pre-fills the message; the quote estimator uses this
 *                        to hand over the configuration it priced
 *   ?sent=1              shows the confirmation (after a no-script post)
 */
import { CONTACT_ENDPOINT, CONTACT_HONEYPOT } from '../data/contact';
import { CONTACT_MESSAGE_LIMIT, contactTopics } from '../data/products';

function init(): void {
    const form = document.getElementById('contact-form');
    if (!(form instanceof HTMLFormElement)) {
        return;
    }

    const status = document.getElementById('form-status');
    const sent = document.getElementById('sent');
    const recipient = form.dataset.recipient ?? '';
    const control = (name: string) =>
        form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');

    const params = new URLSearchParams(window.location.search);
    const product = params.get('product');
    if (product && Object.prototype.hasOwnProperty.call(contactTopics, product)) {
        control('topic').value = contactTopics[product]!;
    }
    const message = params.get('message');
    if (message) {
        control('message').value = message.slice(0, CONTACT_MESSAGE_LIMIT);
    }
    if (params.get('sent') === '1' && sent) {
        sent.classList.add('is-shown');
    }

    const field = (name: string) => control(name).value.trim();

    const show = (text: string, error = false) => {
        if (!status) return;
        status.textContent = text;
        status.classList.toggle('is-error', error);
        status.hidden = false;
    };

    const composeEmail = () => {
        const name = field('name');
        const organization = field('organization');
        const topic = field('topic');

        const subject = `${topic} — website inquiry from ${name}${organization ? ` (${organization})` : ''}`;

        const lines = [`Name: ${name}`, `Email: ${field('email')}`];
        if (organization) {
            lines.push(`Organization: ${organization}`);
        }
        if (field('phone')) {
            lines.push(`Phone: ${field('phone')}`);
        }
        lines.push(`Topic: ${topic}`, '', field('message'));

        // mailto bodies need CRLF line breaks to survive every mail client,
        // including the ones typed inside the message itself.
        const body = lines.join('\n').replace(/\r?\n/g, '\r\n');
        window.location.href =
            `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        show(
            'We could not reach our contact service, so your email app should open with the message ready to send. ' +
                `If nothing happened, email ${recipient} directly.`,
        );
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const payload: Record<string, string> = {
            name: field('name'),
            email: field('email'),
            organization: field('organization'),
            phone: field('phone'),
            topic: field('topic'),
            message: control('message').value,
            [CONTACT_HONEYPOT]: control(CONTACT_HONEYPOT)?.value ?? '',
        };

        if (submit) submit.disabled = true;
        show('Sending…');
        try {
            const res = await fetch(CONTACT_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'same-origin',
            });
            if (res.status >= 500) {
                composeEmail();
                return;
            }
            if (res.ok) {
                form.reset();
                if (status) status.hidden = true;
                if (sent) {
                    sent.classList.add('is-shown');
                    sent.focus();
                }
                return;
            }
            let error = 'Something in the form was not accepted. Check it and try again.';
            try {
                const body = (await res.json()) as { error?: string; field?: string | null };
                if (body.error) error = body.error;
                if (body.field) {
                    const el = control(body.field);
                    if (el && 'focus' in el) el.focus();
                }
            } catch {
                /* a plain answer: keep the generic message */
            }
            show(error, true);
        } catch {
            composeEmail();
        } finally {
            if (submit) submit.disabled = false;
        }
    });
}

init();
