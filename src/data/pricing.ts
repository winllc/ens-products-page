/*
 * List prices and the rules around them — the one place they are written down.
 *
 * The pricing page, the per-product pricing sections, the homepage teaser, the
 * RSA help-desk savings calculator and the quote estimator all read from this
 * file, at build time and (for the estimator) in the browser. Change a number
 * here and every page and the estimator follow on the next build.
 *
 * The arithmetic lives in src/lib/pricing.ts and is covered by
 * src/lib/pricing.test.ts, including the worked example quoted on the
 * pricing page.
 *
 * List prices are what a reseller sells at too: they are set high enough to
 * carry a 15–25% reseller margin, so they are the same whichever way a
 * customer buys.
 */

import type { ProductId } from './products';

/** A size band. `upTo` is inclusive; the last band of a product has none. */
export interface Tier {
    upTo: number | null;
    /** Annual subscription list price, or null when the band is priced on request. */
    annual: number | null;
    /** True when `annual` is a floor ("$120,000+") rather than a price. */
    startingAt?: boolean;
    /** Overrides the generated "Up to 2,500" style label. */
    label?: string;
}

export interface ProductPricing {
    /** What the tiers count, in the plural: "directory users". */
    unit: string;
    /** Why it is counted that way, when that is worth saying. */
    unitNote?: string;
    tiers: readonly Tier[];
}

export const productPricing: Readonly<Record<ProductId, ProductPricing>> = {
    certalert: {
        unit: 'directory users',
        unitNote: 'Sized by the people in the directory you point it at. Servers are not counted.',
        tiers: [
            { upTo: 2_500, annual: 12_000 },
            { upTo: 10_000, annual: 30_000 },
            { upTo: 50_000, annual: 65_000 },
            { upTo: null, annual: 120_000, startingAt: true, label: 'Enterprise' },
        ],
    },
    'mfa-portal': {
        unit: 'SecurID users',
        unitNote: 'Sized by the users with a SecurID token in the Authentication Manager security domain the portal serves.',
        tiers: [
            { upTo: 2_500, annual: 10_000 },
            { upTo: 10_000, annual: 25_000 },
            { upTo: 50_000, annual: 55_000 },
            { upTo: null, annual: null },
        ],
    },
    readyroom: {
        unit: 'tracked people',
        unitNote:
            'Priced per person ReadyRoom actually tracks, not per directory user, so a few units can start without licensing the whole organization.',
        tiers: [
            { upTo: 500, annual: 6_000 },
            { upTo: 2_500, annual: 15_000 },
            { upTo: 10_000, annual: 35_000 },
            { upTo: null, annual: null },
        ],
    },
    'directory-portal': {
        unit: 'directory users',
        tiers: [
            { upTo: 2_500, annual: 8_000 },
            { upTo: 10_000, annual: 20_000 },
            { upTo: 50_000, annual: 45_000 },
            { upTo: null, annual: null },
        ],
    },
};

/**
 * A perpetual license lists at this multiple of the annual subscription, for
 * buyers whose contract vehicle only allows one-time purchases. Maintenance is
 * then charged yearly on top (see supportTiers).
 */
export const PERPETUAL_MULTIPLE = 2.75;

export type SupportTierId = 'standard' | 'premium';

export interface SupportTier {
    id: SupportTierId;
    name: string;
    summary: string;
    /** Yearly maintenance on a perpetual license, as a fraction of the license. */
    perpetualRate: number;
    /** Yearly add-on to a subscription, as a fraction of the subscription. 0 = included. */
    subscriptionRate: number;
    response: string;
    hours: string;
    features: readonly string[];
}

export const supportTiers: readonly SupportTier[] = [
    {
        id: 'standard',
        name: 'Standard',
        summary: 'Updates, security patches and email support.',
        perpetualRate: 0.2,
        subscriptionRate: 0,
        response: 'Next business day',
        hours: 'Business hours',
        features: ['Product updates and security patches', 'Email support'],
    },
    {
        id: 'premium',
        name: 'Premium',
        summary: 'Faster response and an engineer who knows your deployment.',
        perpetualRate: 0.28,
        subscriptionRate: 0.28,
        response: '4 hours',
        hours: 'Business hours',
        features: ['Everything in Standard', 'Named support engineer', 'Quarterly health check'],
    },
];

/** Suite discount, off the sum of the products taken. The highest band reached applies. */
export const bundleDiscounts: readonly { minProducts: number; rate: number }[] = [
    { minProducts: 2, rate: 0.25 },
    { minProducts: 3, rate: 0.3 },
];

/** Prepaying a multi-year subscription. */
export const multiYear = { years: 3, discount: 0.1 } as const;

export interface PricedService {
    id: string;
    name: string;
    description: string;
    /** Price range; low === high for a fixed price. null = time and materials. */
    low: number | null;
    high: number | null;
    per: string;
}

export const services: Readonly<Record<'install' | 'ato' | 'training' | 'custom', PricedService>> = {
    install: {
        id: 'install',
        name: 'Installation and directory integration',
        description: 'Fixed fee per product. Classified or multi-site installations are quoted above the range.',
        low: 5_000,
        high: 15_000,
        per: 'per product',
    },
    ato: {
        id: 'ato',
        name: 'STIG-hardened image and ATO documentation package',
        description:
            'A STIG-hardened container image and the documentation your ISSM needs for the authorization package.',
        low: 10_000,
        high: 25_000,
        per: 'per deployment',
    },
    training: {
        id: 'training',
        name: 'Training',
        description: 'Administrator, help desk or Trusted Agent sessions, on site or remote.',
        low: 2_500,
        high: 2_500,
        per: 'per half-day session',
    },
    custom: {
        id: 'custom',
        name: 'Custom schema and form work',
        description: 'Directory Services Portal forms and schema mappings beyond the standard set.',
        low: null,
        high: null,
        per: 'time and materials',
    },
};

/** Free evaluation: the product's container, run on your own hardware. */
export const evaluation = { days: 30, price: 0 } as const;

/** Paid pilot, credited in full toward the first year. */
export const pilot = { days: 90, price: 5_000 } as const;

/**
 * Federal acquisition thresholds (FAR 2.101), used to tell buyers which
 * purchasing route an order fits. Inflation-adjusted every five years; these
 * are the values in effect from 1 October 2025.
 */
export const thresholds = {
    microPurchase: 15_000,
    simplifiedAcquisition: 350_000,
    effective: 'October 1, 2025',
} as const;

/**
 * What enterprise certificate-management platforms commonly cost a year,
 * quoted on the CertAlert pricing section as the comparison point.
 */
export const enterpriseCertificatePlatformRange = { low: 100_000, high: 500_000 } as const;

/** RSA Operations Portal value anchor: what one PIN-reset help desk ticket costs. */
export const pinResetTicketCost = { low: 20, high: 40 } as const;
