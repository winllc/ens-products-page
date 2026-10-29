/*
 * What a license is and what it unlocks: the editions, and every product's
 * features. The site issues licenses from this file and the applications
 * enforce the same ids, so a feature added here must also be wired into its
 * application (and listed in that application's README), and an id must
 * never be renamed once licenses carrying it have been issued.
 *
 * Feature ids appear in license files as "<product>.<feature>". A license
 * lists every standard feature of its product; enterprise features are added
 * for the top size band, evaluations and pilots, or when ENS ticks
 * "Enterprise" on the order.
 */

import { productPricing } from './pricing';
import type { ProductId } from './products';

export type Edition = 'evaluation' | 'pilot' | 'subscription' | 'perpetual';

export interface EditionPolicy {
    name: string;
    /** Default length; null when it never expires. */
    days: number | null;
    /** Days the application keeps full use after expiry, with a warning, before going read-only. */
    graceDays: number;
    /** The application shows an evaluation banner. */
    watermark: boolean;
}

export const editions: Record<Edition, EditionPolicy> = {
    evaluation: { name: 'Evaluation', days: 30, graceDays: 7, watermark: true },
    pilot: { name: 'Pilot', days: 90, graceDays: 0, watermark: false },
    subscription: { name: 'Subscription', days: 365, graceDays: 30, watermark: false },
    perpetual: { name: 'Perpetual', days: null, graceDays: 0, watermark: false },
};

/** Free evaluations an account may download per product. */
export const EVALUATIONS_PER_PRODUCT = 1;

/** Days a customer may add to an evaluation themselves, once, from its license page. After that it's the paid pilot. */
export const EVALUATION_EXTENSION_DAYS = 30;

/** How far over its size a deployment may go before it stops taking on more (LicenseCheck.OVERAGE_TOLERANCE). */
export const OVERAGE_TOLERANCE = 0.1;

export interface Feature {
    /** The id after "<product>." in a license file. */
    id: string;
    name: string;
    description: string;
    /** Only in the top size band, evaluations and pilots, or when ENS adds it to an order. */
    enterprise?: boolean;
    /**
     * Announced but not yet in the product. Shown as planned on the site and
     * never written into a new license; the id is reserved so files issued
     * before the flag was set keep verifying, and so the applications can
     * gate it the day it ships.
     */
    roadmap?: boolean;
}

export const productFeatures: Record<ProductId, readonly Feature[]> = {
    certalert: [
        { id: 'directory-sync', name: 'Directory sweeps', description: 'Finds every certificate people and servers publish in the directory.' },
        { id: 'changelog-sync', name: 'Changelog sync', description: 'Picks up directory changes within minutes from the changelog, between full sweeps.' },
        { id: 'notifications', name: 'Email notifications', description: 'Warns points of contact by email, with digests and email alerts.' },
        { id: 'metrics', name: 'Metrics', description: 'Trends across the whole directory: expiry, issuing authorities, revocation.' },
        { id: 'projects', name: 'Projects', description: 'Groups servers into projects with their own administrators.' },
        { id: 'revocation-checks', name: 'Revocation checks', description: 'Checks every certificate against OCSP and CRLs.' },
        { id: 'endpoint-checks', name: 'Endpoint checks', description: 'Probes servers for the certificate they actually serve.' },
        { id: 'risky-names', name: 'Risk analysis', description: 'Flags certificates with risky names, keys and algorithms.' },
        { id: 'directory-cleanup', name: 'Directory cleanup', description: 'Removes expired certificates and stale entries from the directory.' },
        { id: 'classification-banners', name: 'Classification banners', description: 'Configurable banners for classified networks.' },
        { id: 'multi-directory', name: 'Multiple directories', description: 'Sweeps more than one directory or forest from one installation.', enterprise: true, roadmap: true },
    ],
    readyroom: [
        { id: 'attendance', name: 'Attendance tracking', description: 'Logon, lock, unlock and logoff from the Windows client, turned into daily status.' },
        { id: 'calendar', name: 'Calendar', description: 'Leave, telework and events on a shared calendar.' },
        { id: 'absence-alerts', name: 'Absence alerts', description: 'Emails managers when someone has not checked in.' },
        { id: 'metrics', name: 'Metrics, reports and exports', description: 'Accountability metrics, personal and group reports as PDF, CSV or Excel, and scheduled emailed reports.' },
        { id: 'org-chart', name: 'Org chart', description: 'The organization chart, with live status.' },
        { id: 'classification-banners', name: 'Classification banners', description: 'Configurable banners for classified networks.' },
    ],
    'mfa-portal': [
        { id: 'self-service', name: 'Self-service', description: 'Users register, test and reset their own tokens, and request exemptions.' },
        { id: 'trusted-agents', name: 'Trusted agents', description: 'Token distribution, lost and deprovisioned tokens, appointments and the trusted-agent directory.' },
        { id: 'help-desk', name: 'Help desk', description: 'User search, unlocks, emergency codes and PIN resets.' },
        { id: 'shipments', name: 'Shipments and sites', description: 'Token inventory, sites and shipments between them.' },
        { id: 'scheduled-jobs', name: 'Scheduled jobs', description: 'Expiry and appointment emails, trusted-agent re-syncs and lost-token monitoring.' },
        { id: 'branding', name: 'Branding', description: 'Your logo, colours, messages and email templates.' },
        { id: 'reports', name: 'Reports', description: 'Overview, site and trusted-agent reports.' },
        { id: 'bulk-upload', name: 'Bulk trusted-agent upload', description: 'Registers trusted agents in bulk from a CSV file.' },
        { id: 'group-email', name: 'Group email', description: 'Messages to every user, trusted agent or site at once.' },
    ],
    'directory-portal': [
        { id: 'directory-editor', name: 'Directory editor', description: 'Browse, search and edit any LDAP directory through admin-defined forms.' },
        { id: 'form-builder', name: 'Form builder', description: 'Definitions and forms for custom schemas, without code.' },
        { id: 'self-service-profile', name: 'Self-service profiles', description: 'People keep their own directory entries up to date.' },
        { id: 'white-pages', name: 'White pages', description: 'Directory search for everyone, with per-user and per-group permissions.' },
        { id: 'smart-card-sign-in', name: 'Smart-card sign-in', description: 'X.509 client-certificate sign-in, CAC and PIV included.' },
        { id: 'metrics', name: 'Metrics and dashboards', description: 'Counts and trends across the directory, on dashboards you build.' },
        { id: 'data-analysis', name: 'Data-quality analysis', description: 'Finds missing, malformed and duplicate data, with CSV export of the findings.' },
        { id: 'schema-transfer', name: 'Schema import and export', description: 'Moves schema between directories.' },
    ],
};

/**
 * What an evaluation covers: the second size band, so a trial pointed at a
 * real directory sees all of it rather than a sample of the smallest.
 */
export function evaluationLimit(product: ProductId): number {
    const second = productPricing[product].tiers[1]?.upTo;
    if (second === null || second === undefined) {
        throw new Error(`${product} has no second size band to evaluate at`);
    }
    return second;
}

/** The features a license can carry today: everything in the catalog that isn't still on the roadmap. */
export function shippedFeatures(product: ProductId): Feature[] {
    return productFeatures[product].filter((f) => !f.roadmap);
}

/** The enterprise features that can be sold today, across every product. */
export function sellableEnterpriseFeatures(): { product: ProductId; feature: Feature }[] {
    return (Object.keys(productFeatures) as ProductId[]).flatMap((product) =>
        shippedFeatures(product)
            .filter((f) => f.enterprise)
            .map((feature) => ({ product, feature })),
    );
}

/** The feature ids a license of this edition and size carries. Roadmap features are never issued. */
export function featuresFor(product: ProductId, edition: Edition, enterprise: boolean): string[] {
    const all = enterprise || edition === 'evaluation' || edition === 'pilot';
    return shippedFeatures(product)
        .filter((f) => all || !f.enterprise)
        .map((f) => `${product}.${f.id}`);
}
