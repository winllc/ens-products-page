/*
 * The product line, in the order the site lists it.
 *
 * Everything that names a product in more than one place reads it from here:
 * the nav's product menu, the homepage cards, the "more products" strip on
 * every product page, the pricing page, the estimator, and the contact form's
 * topic list. Adding a product starts with an entry here, then its page under
 * src/pages/products/ (built on ProductLayout) and its tiers in
 * src/data/pricing.ts.
 */

export type ProductId = 'certalert' | 'mfa-portal' | 'readyroom' | 'directory-portal';

/** A screenshot at two sizes: full width, and a narrower crop for phones. */
export interface Screenshot {
    src: string;
    width: number;
    height: number;
    mobileSrc: string;
    mobileWidth: number;
    mobileHeight: number;
    alt: string;
}

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
    /** Whether it can be bought today. Drives the badge on cards and the product page. */
    status: 'available' | 'coming-soon';
    /** Two or three sentences for the product cards. */
    summary: string;
    /** The screenshot on the product's cards. */
    cardShot: Screenshot;
    /** The product's section of the documentation site, e.g. "cert-alert". */
    docsPath: string;
}

export const products: readonly Product[] = [
    {
        id: 'readyroom',
        name: 'ReadyRoom',
        navLabel: 'ReadyRoom',
        tagline: 'Attendance and accountability',
        href: '/products/readyroom.html',
        demoKey: 'READYROOM',
        status: 'available',
        summary:
            'Know who&rsquo;s in without a sign-in sheet. Windows sign-ins, locks and sign-outs become daily attendance and accountability for your directory, with managers alerted when someone isn&rsquo;t in by their expected time.',
        cardShot: {
            src: '/assets/img/screens/readyroom-home.jpg',
            width: 1440,
            height: 852,
            mobileSrc: '/assets/img/screens/readyroom-home-mobile.jpg',
            mobileWidth: 640,
            mobileHeight: 583,
            alt: 'ReadyRoom home page showing a manager\'s team, 86% accounted for',
        },
        docsPath: 'readyroom',
    },
    {
        id: 'certalert',
        name: 'CertAlert',
        navLabel: 'CertAlert',
        tagline: 'Certificate expiration visibility',
        href: '/products/certalert.html',
        demoKey: 'CERTALERT',
        status: 'available',
        summary:
            'Certificate expiration visibility for your whole directory. Indexes every certificate people and servers publish, alerts each server&rsquo;s points of contact before one lapses, and checks revocation and what servers are actually serving.',
        cardShot: {
            src: '/assets/img/screens/certalert-metrics.jpg',
            width: 1440,
            height: 900,
            mobileSrc: '/assets/img/screens/certalert-metrics-mobile.jpg',
            mobileWidth: 700,
            mobileHeight: 460,
            alt: 'CertAlert metrics: certificates valid, expiring soon and expired, and a chart of issued against expiring',
        },
        docsPath: 'cert-alert',
    },
    {
        id: 'mfa-portal',
        name: 'RSA Operations Portal',
        navLabel: 'RSA Portal',
        tagline: 'For RSA SecurID',
        href: '/products/mfa-portal.html',
        demoKey: 'MFA_PORTAL',
        status: 'available',
        summary:
            'Run your RSA SecurID program from one portal. Self-service token activation and PIN resets, a Trusted Agent directory with appointments, help desk tools, and token shipments to every site &mdash; on top of RSA Authentication Manager.',
        cardShot: {
            src: '/assets/img/screens/rsa-portal-user-details.jpg',
            width: 1440,
            height: 900,
            mobileSrc: '/assets/img/screens/rsa-portal-user-details-mobile.jpg',
            mobileWidth: 720,
            mobileHeight: 814,
            alt: 'RSA Operations Portal user details: a user\'s account, their SecurID token and PIN reset, lost-token and emergency-code actions',
        },
        docsPath: 'rsa-operations-portal',
    },
    {
        id: 'directory-portal',
        name: 'Directory Services Portal',
        navLabel: 'Directory Portal',
        tagline: 'LDAP directories with custom schemas',
        href: '/products/directory-portal.html',
        demoKey: 'DIRECTORY_PORTAL',
        status: 'available',
        summary:
            'A web front end for LDAP directories with custom schemas. Build forms for any object class, publish scoped read/write or white-pages directories, grant access by user or group, and let people update their own details.',
        cardShot: {
            src: '/assets/img/screens/directory-portal-staff.jpg',
            width: 1440,
            height: 900,
            mobileSrc: '/assets/img/screens/directory-portal-staff-mobile.jpg',
            mobileWidth: 620,
            mobileHeight: 560,
            alt: 'Directory Services Portal staff directory listing employees',
        },
        docsPath: 'directory-services-portal',
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
