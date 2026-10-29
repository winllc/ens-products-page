/*
 * Structured data (JSON-LD, schema.org) for the pages' <head>, built from the
 * same data files the pages read, so a price or a product name is never typed
 * twice. Pure functions, no DOM and no Astro, so they are unit tested on their
 * own (structured-data.test.ts).
 *
 * A page embeds one with BaseLayout's "head" slot:
 *
 *     <script is:inline type="application/ld+json" slot="head" set:html={jsonLd(organization())} />
 *
 * jsonLd() escapes "<" so that the output can never close the script element
 * or form an HTML comment: the container's render script walks the pages line
 * by line looking for <!--DEMO:...--> markers, and nothing here may look like one.
 */

import { productPricing, type Tier } from '../data/pricing';
import { products, type ProductId } from '../data/products';
import { docsUrl } from '../data/site';
import { tierLabel } from './pricing';

/** The site's address, as in astro.config.mjs. */
export const SITE_URL = 'https://products.ens-solutions.com';

export const ORGANIZATION = {
    name: 'ENS Solutions, LLC',
    url: 'https://ens-solutions.com/',
    logo: `${SITE_URL}/assets/img/brand/ens-solutions-logo.jpg`,
    email: 'info@ens-solutions.com',
    /** E.164, as schema.org prefers; the contact page shows 301-925-4008. */
    telephone: '+1-301-925-4008',
    linkedIn: 'https://www.linkedin.com/company/ens-solutions-llc/',
} as const;

export type JsonLd = Record<string, unknown>;

/** The few HTML entities the product summaries use, as plain text. */
export function decodeEntities(html: string): string {
    const named: Record<string, string> = {
        amp: '&',
        rsquo: '’',
        lsquo: '‘',
        rdquo: '”',
        ldquo: '“',
        mdash: '—',
        ndash: '–',
        nbsp: ' ',
        hellip: '…',
    };
    return html.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
        if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
        if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
        return named[code.toLowerCase()] ?? whole;
    });
}

/** An absolute URL on this site. */
export function absolute(path: string): string {
    return new URL(path, SITE_URL).href;
}

/** schema.org Organization: the company behind the products, for the homepage. */
export function organization(): JsonLd {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: ORGANIZATION.name,
        url: ORGANIZATION.url,
        logo: ORGANIZATION.logo,
        email: ORGANIZATION.email,
        telephone: ORGANIZATION.telephone,
        sameAs: [SITE_URL, ORGANIZATION.linkedIn],
        contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'sales',
            email: ORGANIZATION.email,
            telephone: ORGANIZATION.telephone,
            url: absolute('/contact.html'),
            availableLanguage: 'en',
        },
    };
}

/** schema.org ItemList of the products, in the site's order, each with its page. */
export function productList(): JsonLd {
    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'ENS Solutions products',
        numberOfItems: products.length,
        itemListElement: products.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: absolute(p.href),
            name: p.name,
            description: decodeEntities(p.summary),
        })),
    };
}

/** One schema.org Offer per priced size band; bands priced on request are left out. */
export function offers(id: ProductId): JsonLd[] {
    const pricing = productPricing[id];
    const page = absolute(`/pricing.html#price-${id}`);
    const result: JsonLd[] = [];
    pricing.tiers.forEach((tier: Tier, i) => {
        if (tier.annual === null) return;
        const name = `${tierLabel(pricing.tiers, i)} ${pricing.unit}, annual subscription`;
        if (tier.startingAt) {
            result.push({
                '@type': 'Offer',
                name,
                url: page,
                priceSpecification: {
                    '@type': 'PriceSpecification',
                    minPrice: tier.annual,
                    priceCurrency: 'USD',
                },
                availability: 'https://schema.org/InStock',
            });
        } else {
            result.push({
                '@type': 'Offer',
                name,
                url: page,
                price: tier.annual,
                priceCurrency: 'USD',
                availability: 'https://schema.org/InStock',
            });
        }
    });
    return result;
}

/**
 * schema.org SoftwareApplication for one product, with its subscription offers.
 * For the product and pricing pages.
 */
export function softwareApplication(id: ProductId): JsonLd {
    const p = products.find((x) => x.id === id);
    if (!p) throw new Error(`Unknown product: ${id}`);
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: p.name,
        url: absolute(p.href),
        description: decodeEntities(p.summary),
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Linux',
        softwareHelp: { '@type': 'CreativeWork', url: docsUrl(`${p.docsPath}/`) },
        author: { '@type': 'Organization', name: ORGANIZATION.name, url: ORGANIZATION.url },
        offers: offers(id),
    };
}

/**
 * The JSON text for a <script type="application/ld+json">. "<" is written as
 * <, which JSON parsers read back as "<", so the text can hold neither
 * "</script>" nor "<!--": nothing in it can end the script element, and the
 * render script's line-based <!--DEMO:...--> markers cannot be imitated.
 */
export function jsonLd(data: JsonLd | JsonLd[]): string {
    return JSON.stringify(data).replace(/</g, '\\u003c');
}
