/*
 * Quote estimator (see src/components/Estimator.astro).
 *
 * Reads the form into a QuoteInput, prices it with quote() from
 * src/lib/pricing.ts, and renders the result. The form state is mirrored into
 * the query string so the page can be bookmarked or shared, and
 * ?product=certalert from a product page starts with just that product.
 */
import { multiYear, pilot, productPricing, thresholds, type SupportTierId } from '../data/pricing';
import { product, products, type ProductId } from '../data/products';
import {
    formatCount,
    formatPercent,
    formatRange,
    formatUSD,
    quote,
    type LicenseModel,
    type Quote,
    type QuoteInput,
} from '../lib/pricing';

const productIds = products.map((p) => p.id);
const isProductId = (v: string): v is ProductId => (productIds as string[]).includes(v);

/* ---------------------------------------------------------------- *
 * Small DOM helpers. Everything is built with textContent, never innerHTML.
 * ---------------------------------------------------------------- */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, v);
    }
    for (const c of children) {
        if (c !== null && c !== undefined && c !== false) {
            node.append(c);
        }
    }
    return node;
}

function row(label: Child, value: string, cls = ''): HTMLTableRowElement {
    return h('tr', cls ? { class: cls } : {}, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, value));
}

/* ---------------------------------------------------------------- *
 * Form <-> state <-> URL
 * ---------------------------------------------------------------- */

interface FormRefs {
    form: HTMLFormElement;
    input(name: string): HTMLInputElement;
    radios(name: string): RadioNodeList;
}

function readForm({ form, input, radios }: FormRefs): QuoteInput {
    const model = (radios('model').value || 'subscription') as LicenseModel;
    const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="product"]:checked'));
    return {
        model,
        lines: checked
            .map((c) => c.value)
            .filter(isProductId)
            .map((id) => ({
                product: id,
                quantity: Number(input(`qty-${id}`).value),
                multiForest: id === 'certalert' && input('multiForest').checked,
            })),
        support: (radios('support').value || 'standard') as SupportTierId,
        prepay: model === 'subscription' && input('prepay').checked,
        pilot: input('pilot').checked,
        install: input('install').checked,
        atoPackage: input('ato').checked,
        trainingSessions: Number(input('training').value) || 0,
    };
}

/** Compact query string: ?model=perpetual&p=certalert:10000,readyroom:500&support=premium&... */
function toQuery(q: QuoteInput): string {
    const params = new URLSearchParams();
    if (q.model !== 'subscription') params.set('model', q.model);
    if (q.lines.length) params.set('p', q.lines.map((l) => `${l.product}:${Math.floor(l.quantity) || 1}`).join(','));
    if (q.lines.some((l) => l.multiForest)) params.set('mf', '1');
    if (q.support !== 'standard') params.set('support', q.support);
    if (q.prepay) params.set('prepay', '1');
    if (q.pilot) params.set('pilot', '1');
    if (!q.install) params.set('install', '0');
    if (q.atoPackage) params.set('ato', '1');
    if (q.trainingSessions) params.set('training', String(q.trainingSessions));
    return params.toString();
}

function applyQuery(refs: FormRefs, search: string): void {
    const { form, input } = refs;
    const params = new URLSearchParams(search);
    const setRadio = (name: string, value: string | null) => {
        const el = value && form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`);
        if (el) el.checked = true;
    };
    setRadio('model', params.get('model'));
    setRadio('support', params.get('support'));

    const selected = new Map<ProductId, number | null>();
    for (const part of (params.get('p') ?? '').split(',')) {
        const [id, qty] = part.split(':');
        if (id && isProductId(id)) selected.set(id, qty ? Number(qty) : null);
    }
    // From a product page: ?product=certalert starts with that product alone.
    const single = params.get('product');
    if (!selected.size && single && isProductId(single)) selected.set(single, null);
    // A bare visit starts from the worked example's shape: the lead product.
    if (!selected.size) selected.set('certalert', null);

    for (const id of productIds) {
        const box = form.querySelector<HTMLInputElement>(`input[name="product"][value="${id}"]`)!;
        box.checked = selected.has(id);
        const qty = selected.get(id);
        if (qty && Number.isFinite(qty) && qty > 0) input(`qty-${id}`).value = String(Math.floor(qty));
    }
    input('multiForest').checked = params.get('mf') === '1';
    input('prepay').checked = params.get('prepay') === '1';
    input('pilot').checked = params.get('pilot') === '1';
    input('install').checked = params.get('install') !== '0';
    input('ato').checked = params.get('ato') === '1';
    const training = Number(params.get('training'));
    input('training').value = Number.isFinite(training) && training > 0 ? String(Math.floor(training)) : '0';
}

/* ---------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------- */

function lineLabel(q: Quote['lines'][number]): Child {
    const unit = productPricing[q.product].unit;
    return h(
        'span',
        {},
        product(q.product).name,
        h('span', { class: 'quote-sub' }, `${formatCount(q.quantity)} ${unit} · ${q.tierLabel}`),
    );
}

function money(amount: number, floor: boolean): string {
    return formatUSD(amount) + (floor ? '+' : '');
}

function acquisitionNote(q: Quote): string {
    const what = q.model === 'perpetual' ? 'The license with its first year of maintenance' : q.prepay ? 'The prepaid term' : 'A year of subscription';
    switch (q.acquisition) {
        case 'micro-purchase':
            return `${what} comes to ${formatUSD(q.softwareOrder)}, within the ${formatUSD(thresholds.microPurchase)} micro-purchase threshold: it can be bought on a government purchase card.`;
        case 'simplified':
            return `${what} comes to ${formatUSD(q.softwareOrder)}, under the ${formatUSD(thresholds.simplifiedAcquisition)} simplified acquisition threshold.`;
        default:
            return `${what} comes to ${formatUSD(q.softwareOrder)}, above the simplified acquisition threshold. Talk to us about splitting the order or a multi-year vehicle.`;
    }
}

function render(q: Quote): Node[] {
    if (!q.lines.length) {
        return [h('p', { class: 'muted' }, 'Choose at least one product.')];
    }
    const perpetual = q.model === 'perpetual';
    const floor = q.isFloor;
    const body = h('tbody');

    for (const line of q.lines) {
        body.append(row(lineLabel(line), line.list === null ? 'Contact us' : money(line.list, line.startingAt)));
    }
    if (q.bundleRate > 0) {
        body.append(
            row(`Suite discount (${formatPercent(q.bundleRate)}, ${q.productCount} products)`, `−${formatUSD(q.bundleDiscount)}`, 'quote-discount'),
        );
    }

    if (perpetual) {
        body.append(row('Perpetual license, one time', money(q.oneTimeLicense, floor), 'quote-total'));
        body.append(row(`${q.support.tier.name} maintenance (${formatPercent(q.support.rate)} of license)`, `${money(q.annual, floor)} / yr`));
    } else {
        body.append(
            row(
                `${q.support.tier.name} support`,
                q.support.included ? 'Included' : `+${money(q.support.amount, floor)}`,
            ),
        );
        body.append(row('Subscription per year', money(q.annual, floor), 'quote-total'));
        if (q.prepay) {
            body.append(
                row(
                    `${q.prepay.years}-year prepay (${formatPercent(multiYear.discount)} off)`,
                    money(q.prepay.total, floor),
                    'quote-total',
                ),
            );
        }
    }
    if (q.pilot) {
        body.append(row(`${pilot.days}-day pilot, credited to year one`, `−${formatUSD(q.pilot.credit)}`, 'quote-discount'));
    }
    for (const s of q.services) {
        body.append(row(s.label, formatRange(s)));
    }
    if (q.services.length || perpetual || q.pilot) {
        body.append(
            row(
                'Due in year one',
                (q.servicesTotal.low === q.servicesTotal.high
                    ? formatUSD(q.yearOne.low)
                    : formatRange(q.yearOne)) + (floor ? '+' : ''),
                'quote-total quote-grand',
            ),
        );
    }

    const nodes: Node[] = [h('table', { class: 'quote-table' }, h('caption', { class: 'visually-hidden' }, 'Estimate'), body)];
    const notes = h('ul', { class: 'quote-notes' });
    notes.append(h('li', {}, acquisitionNote(q)));
    if (q.pilot) {
        notes.append(h('li', {}, `The pilot is a separate ${formatUSD(pilot.price)} order up front; year one is shown after its credit.`));
    }
    if (q.hasUnpricedLines) {
        notes.append(h('li', {}, 'Above the largest published size a product is priced on request, so it is left out of these totals.'));
    }
    if (floor) {
        notes.append(h('li', {}, 'Enterprise and multi-forest CertAlert starts at the price shown; totals marked + are floors.'));
    }
    if (q.services.some((s) => s.id === 'install')) {
        notes.append(h('li', {}, 'Installation ranges are for a single unclassified site; classified and multi-site installations are quoted.'));
    }
    nodes.push(notes);
    return nodes;
}

/** Plain-text summary for the contact form's message. */
function summary(q: Quote, link: string): string {
    const out = ['Estimate from the ENS Solutions pricing page:', ''];
    out.push(`Model: ${q.model === 'perpetual' ? 'Perpetual license' : 'Annual subscription'}`);
    for (const l of q.lines) {
        out.push(
            `- ${product(l.product).name}: ${formatCount(l.quantity)} ${productPricing[l.product].unit} (${l.tierLabel}), ` +
                (l.list === null ? 'priced on request' : money(l.list, l.startingAt)),
        );
    }
    if (q.bundleRate) out.push(`Suite discount: ${formatPercent(q.bundleRate)} (−${formatUSD(q.bundleDiscount)})`);
    out.push(`Support: ${q.support.tier.name}`);
    if (q.model === 'perpetual') {
        out.push(`License: ${formatUSD(q.oneTimeLicense)} one time; maintenance ${formatUSD(q.annual)} a year`);
    } else {
        out.push(`Subscription: ${formatUSD(q.annual)} a year`);
        if (q.prepay) out.push(`${q.prepay.years}-year prepay: ${formatUSD(q.prepay.total)}`);
    }
    if (q.pilot) out.push(`Start with the ${pilot.days}-day paid pilot`);
    for (const s of q.services) out.push(`${s.label}: ${formatRange(s)}`);
    out.push('', `Link to this estimate: ${link}`);
    return out.join('\n');
}

/* ---------------------------------------------------------------- *
 * Wiring
 * ---------------------------------------------------------------- */

function init(): void {
    const root = document.getElementById('estimator');
    const form = root?.querySelector('form');
    const panel = root?.querySelector<HTMLElement>('.estimate');
    if (!root || !form || !panel) {
        return;
    }
    const refs: FormRefs = {
        form,
        input(name) {
            const el = form.elements.namedItem(name);
            if (!(el instanceof HTMLInputElement)) throw new Error(`Estimator field missing: ${name}`);
            return el;
        },
        radios(name) {
            return form.elements.namedItem(name) as RadioNodeList;
        },
    };
    const out = (key: string) => panel.querySelector<HTMLElement>(`[data-out="${key}"]`)!;

    applyQuery(refs, window.location.search);
    form.hidden = false;
    panel.hidden = false;

    const update = () => {
        const input = readForm(refs);

        // Prepay is a subscription term; grey it out for perpetual.
        refs.input('prepay').disabled = input.model !== 'subscription';
        for (const card of form.querySelectorAll<HTMLElement>('.est-product')) {
            const on = card.querySelector<HTMLInputElement>('input[name="product"]')!.checked;
            card.classList.toggle('is-on', on);
            for (const el of card.querySelectorAll<HTMLInputElement>('input:not([name="product"])')) {
                el.disabled = !on;
            }
        }

        const q = quote(input);
        out('body').replaceChildren(...render(q));

        const query = toQuery(input);
        const url = new URL(window.location.href);
        url.search = query;
        url.hash = 'estimate';
        history.replaceState(null, '', url);

        const contact = new URLSearchParams({ product: 'pricing', message: summary(q, url.href) });
        const quoteLink = out('quote') as HTMLAnchorElement;
        quoteLink.href = `/contact.html?${contact}`;
        if (q.lines.length) {
            quoteLink.removeAttribute('aria-disabled');
        } else {
            quoteLink.setAttribute('aria-disabled', 'true');
        }
    };

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', (e) => e.preventDefault());

    const copy = out('copy') as HTMLButtonElement;
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            copy.textContent = 'Link copied';
        } catch {
            copy.textContent = 'Copy the address bar';
        }
        window.setTimeout(() => (copy.textContent = 'Copy link'), 2500);
    });

    update();
}

init();
