/*
 * RSA Operations Portal help-desk savings calculator. Recomputes on every
 * input; the arithmetic is helpDeskSavings() in src/lib/pricing.ts.
 */
import { productPricing } from '../data/pricing';
import { formatUSD, helpDeskSavings, tierIndexFor } from '../lib/pricing';

function init(): void {
    const root = document.getElementById('savings-calc');
    const form = root?.querySelector('form');
    if (!root || !form) {
        return;
    }
    form.hidden = false;

    const num = (name: string) => {
        const input = form.elements.namedItem(name) as HTMLInputElement;
        const value = Number(input.value);
        return Number.isFinite(value) ? value : 0;
    };
    const out = (key: string) => root.querySelector<HTMLElement>(`[data-out="${key}"]`)!;

    const update = () => {
        const savings = helpDeskSavings(num('resets'), num('cost'), num('share') / 100);
        const tiers = productPricing['mfa-portal'].tiers;
        const tier = tiers[tierIndexFor('mfa-portal', Math.max(1, num('users')))]!;

        out('savings').textContent = formatUSD(savings);
        if (tier.annual === null) {
            out('price').textContent = 'Contact us';
            out('net').textContent = '—';
            out('note').textContent = 'Above 50,000 users the portal is priced on request.';
            return;
        }
        out('price').textContent = formatUSD(tier.annual);
        const net = savings - tier.annual;
        out('net').textContent = (net < 0 ? '−' : '') + formatUSD(Math.abs(net));
        out('note').textContent =
            net > 0 && tier.annual > 0
                ? `PIN resets alone cover the subscription ${(savings / tier.annual).toFixed(1)} times over, before lockouts, lost tokens and Trusted Agent time.`
                : 'PIN resets alone do not cover the subscription at these numbers; lockouts, lost tokens and Trusted Agent time are not counted here.';
    };

    form.addEventListener('input', update);
    form.addEventListener('submit', (e) => e.preventDefault());
    update();
}

init();
