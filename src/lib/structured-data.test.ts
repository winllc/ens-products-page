import { describe, expect, it } from 'vitest';
import { productPricing } from '../data/pricing';
import { products } from '../data/products';
import { DEFAULT_DOCS_URL } from '../data/site';
import { decodeEntities, jsonLd, offers, organization, productList, SITE_URL, softwareApplication } from './structured-data';

describe('organization', () => {
    it('names the company, its site, logo and a sales contact', () => {
        const org = organization();
        expect(org['@type']).toBe('Organization');
        expect(org.name).toBe('ENS Solutions, LLC');
        expect(org.url).toBe('https://ens-solutions.com/');
        expect(org.logo).toBe(`${SITE_URL}/assets/img/brand/ens-solutions-logo.jpg`);
        expect(org.email).toBe('info@ens-solutions.com');
        const contact = org.contactPoint as Record<string, unknown>;
        expect(contact.url).toBe(`${SITE_URL}/contact.html`);
        expect(contact.telephone).toBe('+1-301-925-4008');
    });
});

describe('productList', () => {
    it('lists every product, in order, with an absolute page URL', () => {
        const list = productList();
        const items = list.itemListElement as { position: number; url: string; name: string; description: string }[];
        expect(list.numberOfItems).toBe(products.length);
        expect(items.map((i) => i.position)).toEqual(products.map((_, i) => i + 1));
        expect(items.map((i) => i.url)).toEqual(products.map((p) => `${SITE_URL}${p.href}`));
        expect(items.map((i) => i.name)).toEqual(products.map((p) => p.name));
        for (const item of items) expect(item.description).not.toMatch(/&[a-z]+;/);
    });
});

describe('offers', () => {
    it('makes one offer per priced band, with the price from pricing.ts, and skips bands priced on request', () => {
        for (const p of products) {
            const tiers = productPricing[p.id].tiers;
            const priced = tiers.filter((t) => t.annual !== null);
            const made = offers(p.id);
            expect(made).toHaveLength(priced.length);
            priced.forEach((tier, i) => {
                const offer = made[i]!;
                expect(offer['@type']).toBe('Offer');
                expect(offer.url).toBe(`${SITE_URL}/pricing.html#price-${p.id}`);
                if (tier.startingAt) {
                    expect(offer.price).toBeUndefined();
                    expect(offer.priceSpecification).toEqual({
                        '@type': 'PriceSpecification',
                        minPrice: tier.annual,
                        priceCurrency: 'USD',
                    });
                } else {
                    expect(offer.price).toBe(tier.annual);
                    expect(offer.priceCurrency).toBe('USD');
                }
            });
        }
    });

    it('labels the bands the way the price tables do', () => {
        const names = offers('certalert').map((o) => o.name);
        expect(names).toEqual([
            'Up to 2,500 directory users, annual subscription',
            '2,501–10,000 directory users, annual subscription',
            '10,001–50,000 directory users, annual subscription',
            'Enterprise or multi-forest directory users, annual subscription',
        ]);
    });
});

describe('softwareApplication', () => {
    it('describes the product with its page, its documentation and its offers', () => {
        const app = softwareApplication('readyroom');
        expect(app['@type']).toBe('SoftwareApplication');
        expect(app.name).toBe('ReadyRoom');
        expect(app.url).toBe(`${SITE_URL}/products/readyroom.html`);
        expect((app.softwareHelp as { url: string }).url).toBe(`${DEFAULT_DOCS_URL}/readyroom/`);
        expect(app.offers).toEqual(offers('readyroom'));
        expect(app.description).toContain('who’s in');
    });

    it('refuses an unknown product', () => {
        expect(() => softwareApplication('nothing' as never)).toThrow(/Unknown product/);
    });
});

describe('decodeEntities', () => {
    it('turns the entities the summaries use into text', () => {
        expect(decodeEntities('who&rsquo;s in &mdash; on top &amp; more &#169; &#x2122;')).toBe('who’s in — on top & more © ™');
    });

    it('leaves an entity it does not know alone', () => {
        expect(decodeEntities('a &unknownthing; b')).toBe('a &unknownthing; b');
    });
});

describe('jsonLd', () => {
    it('is JSON that reads back to the same data', () => {
        const text = jsonLd(organization());
        expect(JSON.parse(text)).toEqual(organization());
    });

    it('can neither close a script element nor form an HTML comment or a demo marker', () => {
        const text = jsonLd({ name: '</script><!--DEMO:READYROOM--> ${READYROOM_DEMO_URL}' });
        expect(text).not.toContain('<');
        expect(text).not.toContain('<!--');
        expect(text).not.toMatch(/<!--(NO)?DEMO:/);
        expect(JSON.parse(text).name).toContain('</script>');
    });

    it('takes a list of documents too', () => {
        const text = jsonLd([organization(), productList()]);
        expect(JSON.parse(text)).toHaveLength(2);
    });
});
