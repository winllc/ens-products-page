/*
 * The product line, in the order the site lists it.
 *
 * Everything that names a product in more than one place reads it from here:
 * the nav, the homepage cards, the pricing page, the estimator, and the
 * contact form's topic list. Adding a product starts with an entry here, then
 * its page under src/pages/products/ and its tiers in src/data/pricing.ts.
 */

export type ProductId = 'certalert' | 'mfa-portal' | 'readyroom' | 'directory-portal';

export interface Product {
    id: ProductId;
    /** Full name, as used in headings and the contact form. */
    name: string;
    /** Shorter label where the nav is tight. */
    navLabel: string;
    /** One-line positioning, as on the product page's eyebrow. */
    tagline: string;
    /** Path of the product page. Kept from the hand-written site, so old links work. */
    href: string;
    /**
     * Name of the demo URL variable, without the _DEMO_URL suffix. The render
     * script resolves ${NAME_DEMO_URL} and the <!--DEMO:NAME--> blocks at
     * container start.
     */
    demoKey: string;
}

export const products: readonly Product[] = [
    {
        id: 'readyroom',
        name: 'ReadyRoom',
        navLabel: 'ReadyRoom',
        tagline: 'Attendance and accountability',
        href: '/products/readyroom.html',
        demoKey: 'READYROOM',
    },
    {
        id: 'certalert',
        name: 'CertAlert',
        navLabel: 'CertAlert',
        tagline: 'Certificate expiration visibility',
        href: '/products/certalert.html',
        demoKey: 'CERTALERT',
    },
    {
        id: 'mfa-portal',
        name: 'RSA Operations Portal',
        navLabel: 'RSA Operations Portal',
        tagline: 'For RSA SecurID',
        href: '/products/mfa-portal.html',
        demoKey: 'MFA_PORTAL',
    },
    {
        id: 'directory-portal',
        name: 'Directory Services Portal',
        navLabel: 'Directory Portal',
        tagline: 'LDAP directories with custom schemas',
        href: '/products/directory-portal.html',
        demoKey: 'DIRECTORY_PORTAL',
    },
];

export function product(id: ProductId): Product {
    const found = products.find((p) => p.id === id);
    if (!found) {
        throw new Error(`Unknown product: ${id}`);
    }
    return found;
}

/**
 * Contact form topics, keyed by the ?product= value that pre-selects them.
 * Product pages, the pricing page and the estimator link here.
 */
export const contactTopics: Readonly<Record<string, string>> = {
    ...Object.fromEntries(products.map((p) => [p.id, p.name])),
    pricing: 'Pricing and quotes',
    pilot: 'Paid pilot',
};

/**
 * Longest message the contact form takes. Some mail clients truncate long
 * mailto: links, and the form hands its message over as one.
 */
export const CONTACT_MESSAGE_LIMIT = 1500;
