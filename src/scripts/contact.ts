/*
 * Contact form.
 *
 * The site has no backend, so the form does not post anywhere. On submit this
 * composes a mailto: link from the fields and hands it to the visitor's own
 * email app, which is where the message is actually sent from.
 *
 * Without this script the form still works through the browser's native
 * mailto form submission, just less tidily formatted.
 *
 * Query parameters:
 *   ?product=certalert   pre-selects the topic (keys in src/data/products.ts)
 *   ?message=...         pre-fills the message; the quote estimator uses this
 *                        to hand over the configuration it priced
 */
import { CONTACT_MESSAGE_LIMIT, contactTopics } from '../data/products';

function init(): void {
    const form = document.getElementById('contact-form');
    if (!(form instanceof HTMLFormElement)) {
        return;
    }

    const status = document.getElementById('form-status');
    const recipient = form.dataset.recipient ?? '';
    const control = (name: string) =>
        form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

    const params = new URLSearchParams(window.location.search);
    const product = params.get('product');
    if (product && Object.prototype.hasOwnProperty.call(contactTopics, product)) {
        control('topic').value = contactTopics[product]!;
    }
    const message = params.get('message');
    if (message) {
        control('message').value = message.slice(0, CONTACT_MESSAGE_LIMIT);
    }

    const field = (name: string) => control(name).value.trim();

    form.addEventListener('submit', (event) => {
        event.preventDefault();

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

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

        if (status) {
            status.textContent =
                'Your email app should open with the message ready to send. ' +
                `If nothing happened, email ${recipient} directly.`;
            status.hidden = false;
        }
    });
}

init();
