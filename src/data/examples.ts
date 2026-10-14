/*
 * Worked examples quoted on the site. They are computed from the price list at
 * build time rather than typed in, so they can never disagree with it, and the
 * tests pin what they come to.
 */

import type { QuoteInput } from '../lib/pricing';

/** A 10,000-user DoD component taking CertAlert and RSA Operations Portal with Mission support. */
export const dodComponentExample: QuoteInput = {
    model: 'subscription',
    lines: [
        { product: 'certalert', quantity: 10_000 },
        { product: 'mfa-portal', quantity: 10_000 },
    ],
    support: 'mission',
    install: true,
    atoPackage: true,
};
