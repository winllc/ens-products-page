import { describe, expect, it } from 'vitest';
import { dodComponentExample } from '../data/examples';
import { productPricing, thresholds } from '../data/pricing';
import { products } from '../data/products';
import {
    bundleRate,
    formatRange,
    formatTierPrice,
    helpDeskSavings,
    perpetualPrice,
    quote,
    startingPrice,
    tierIndexFor,
    tierLabel,
} from './pricing';

describe('price list', () => {
    it('prices every product on the site', () => {
        for (const p of products) {
            expect(productPricing[p.id]).toBeDefined();
        }
    });

    it('keeps each product’s bands in ascending order, open-ended last', () => {
        for (const { tiers } of Object.values(productPricing)) {
            const limits = tiers.map((t) => t.upTo);
            expect(limits.at(-1)).toBeNull();
            const closed = limits.slice(0, -1) as number[];
            expect(closed).toEqual([...closed].sort((a, b) => a - b));
            expect(closed.every((n) => n !== null)).toBe(true);
        }
    });
});

describe('tiers', () => {
    it('treats band limits as inclusive', () => {
        expect(tierIndexFor('certalert', 2_500)).toBe(0);
        expect(tierIndexFor('certalert', 2_501)).toBe(1);
        expect(tierIndexFor('certalert', 10_000)).toBe(1);
        expect(tierIndexFor('certalert', 50_001)).toBe(3);
    });

    it('prices multi-forest CertAlert as Enterprise at any size', () => {
        expect(tierIndexFor('certalert', 1_000, true)).toBe(3);
    });

    it('labels bands', () => {
        const tiers = productPricing.readyroom.tiers;
        expect(tierLabel(tiers, 0)).toBe('Up to 500');
        expect(tierLabel(tiers, 1)).toBe('501–2,500');
        expect(tierLabel(tiers, 3)).toBe('Over 10,000');
        expect(tierLabel(productPricing.certalert.tiers, 3)).toBe('Enterprise or multi-forest');
    });

    it('formats prices, floors and on-request bands', () => {
        expect(formatTierPrice(12_000)).toBe('$12,000');
        expect(formatTierPrice(120_000, true)).toBe('$120,000+');
        expect(formatTierPrice(null)).toBe('Contact us');
    });

    it('lists perpetual licenses at 2.5–3x the subscription', () => {
        for (const { tiers } of Object.values(productPricing)) {
            for (const t of tiers) {
                if (t.annual !== null) {
                    const ratio = perpetualPrice(t.annual) / t.annual;
                    expect(ratio).toBeGreaterThanOrEqual(2.5);
                    expect(ratio).toBeLessThanOrEqual(3);
                }
            }
        }
    });

    it('starts ReadyRoom at $6,000 a year', () => {
        expect(startingPrice('readyroom')).toBe(6_000);
    });
});

describe('suite discount', () => {
    it('starts at two products', () => {
        expect(bundleRate(1)).toBe(0);
        expect(bundleRate(2)).toBe(0.25);
        expect(bundleRate(3)).toBe(0.3);
        expect(bundleRate(4)).toBe(0.3);
    });
});

describe('quote', () => {
    it('includes Standard support in a subscription', () => {
        const q = quote({ model: 'subscription', lines: [{ product: 'certalert', quantity: 2_000 }], support: 'standard' });
        expect(q.annual).toBe(12_000);
        expect(q.support.included).toBe(true);
        expect(q.acquisition).toBe('micro-purchase');
    });

    it('charges maintenance yearly on a perpetual license', () => {
        const q = quote({ model: 'perpetual', lines: [{ product: 'certalert', quantity: 2_000 }], support: 'standard' });
        expect(q.oneTimeLicense).toBe(33_000);
        expect(q.annual).toBe(6_600);
        expect(q.softwareOrder).toBe(39_600);
    });

    it('comes to roughly $55K a year for the worked DoD example', () => {
        const q = quote(dodComponentExample);
        expect(q.listSubtotal).toBe(55_000);
        expect(q.bundleRate).toBe(0.25);
        expect(q.netLicense).toBe(41_250);
        expect(q.support.amount).toBe(14_438);
        expect(q.annual).toBe(55_688);
        expect(q.servicesTotal.low).toBe(20_000);
        expect(q.acquisition).toBe('simplified');
        expect(q.softwareOrder).toBeLessThanOrEqual(thresholds.simplifiedAcquisition);
    });

    it('takes 10% off a three-year prepay', () => {
        const q = quote({ model: 'subscription', lines: [{ product: 'readyroom', quantity: 400 }], support: 'standard', prepay: true });
        expect(q.prepay).toEqual({ years: 3, discount: 1_800, total: 16_200, perYear: 5_400 });
        expect(q.softwareOrder).toBe(16_200);
    });

    it('credits the pilot toward year one', () => {
        const q = quote({ model: 'subscription', lines: [{ product: 'directory-portal', quantity: 5_000 }], support: 'standard', pilot: true });
        expect(q.softwareOrder).toBe(15_000);
    });

    it('leaves bands priced on request out of the totals but counts them for the discount', () => {
        const q = quote({
            model: 'subscription',
            lines: [
                { product: 'readyroom', quantity: 20_000 },
                { product: 'directory-portal', quantity: 1_000 },
            ],
            support: 'standard',
        });
        expect(q.hasUnpricedLines).toBe(true);
        expect(q.bundleRate).toBe(0.25);
        expect(q.annual).toBe(6_000);
    });

    it('marks Enterprise CertAlert totals as floors', () => {
        const q = quote({ model: 'subscription', lines: [{ product: 'certalert', quantity: 80_000 }], support: 'standard' });
        expect(q.isFloor).toBe(true);
        expect(q.annual).toBe(120_000);
    });

    it('prices installation per product and training per session', () => {
        const q = quote({
            model: 'subscription',
            lines: [
                { product: 'certalert', quantity: 100 },
                { product: 'readyroom', quantity: 100 },
                { product: 'mfa-portal', quantity: 100 },
            ],
            support: 'standard',
            install: true,
            trainingSessions: 2,
        });
        expect(q.servicesTotal).toEqual({ low: 20_000, high: 50_000 });
        expect(formatRange(q.servicesTotal)).toBe('$20,000–$50,000');
    });

    it('cleans up nonsense quantities', () => {
        const q = quote({ model: 'subscription', lines: [{ product: 'certalert', quantity: -5 }], support: 'standard' });
        expect(q.lines[0]!.quantity).toBe(1);
    });
});

describe('help-desk savings', () => {
    it('matches the $72K–$144K anchor for 300 resets a month', () => {
        expect(helpDeskSavings(300, 20)).toBe(72_000);
        expect(helpDeskSavings(300, 40)).toBe(144_000);
        expect(helpDeskSavings(300, 30, 0.5)).toBe(54_000);
    });
});
