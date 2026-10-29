/*
 * Building a license payload from what was sold (or asked for, for an
 * evaluation). The rules come from src/data/licensing.ts; this file only
 * applies them, so the account pages, the admin pages and the tests all issue
 * licenses the same way.
 */

import { randomBytes } from 'node:crypto';
import { editions, evaluationLimit, featuresFor, type Edition } from '../../data/licensing';
import { productPricing, type SupportTierId } from '../../data/pricing';
import type { ProductId } from '../../data/products';
import { LICENSE_FORMAT, type LicensePayload } from './license';

export const ISSUER = 'ENS Solutions, LLC';
const DAY = 24 * 60 * 60 * 1000;

export interface IssueRequest {
    product: ProductId;
    edition: Edition;
    licensee: { name: string; organization: string; email: string };
    /** Ignored for evaluations, which are always sized by evaluationLimit (the second band). */
    quantity?: number;
    support?: SupportTierId;
    start?: Date;
    /** Term in calendar years: a subscription's term, or a perpetual license's maintenance. */
    years?: number;
    /** Term in days, overriding years and the edition's default. */
    days?: number;
    installationId?: string | null;
    /** Unlock Enterprise features below the Enterprise band. */
    enterprise?: boolean;
}

/** lic_ followed by 20 lowercase hex digits. */
export function newLicenseId(): string {
    return `lic_${randomBytes(10).toString('hex')}`;
}

/** Installation ids are what the application shows on its license screen. */
export function normalizeInstallationId(raw: string | null | undefined): string | null {
    const id = (raw ?? '').trim().toUpperCase();
    if (!id) {
        return null;
    }
    if (!/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(id)) {
        throw new Error('An installation id is 6 to 64 letters, digits and dashes, as the application shows it');
    }
    return id;
}

function isEnterpriseSize(product: ProductId, quantity: number): boolean {
    const tiers = productPricing[product].tiers;
    const topClosed = tiers[tiers.length - 2]?.upTo;
    const top = tiers[tiers.length - 1];
    return top?.annual !== null && topClosed !== undefined && topClosed !== null && quantity > topClosed;
}

/** The same date and time, n calendar years on (29 February lands on 28 February). */
export function addYears(date: Date, n: number): Date {
    const d = new Date(date.getTime());
    d.setUTCFullYear(d.getUTCFullYear() + n);
    if (d.getUTCDate() !== date.getUTCDate()) {
        d.setUTCDate(0);
    }
    return d;
}

export function buildPayload(
    req: IssueRequest,
    meta: { id: string; revision: number; now?: Date },
): LicensePayload {
    const policy = editions[req.edition];
    const now = meta.now ?? new Date();
    const start = req.start ?? now;

    const quantity =
        req.edition === 'evaluation' ? evaluationLimit(req.product) : Math.floor(req.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity < 1) {
        throw new Error('A license must cover at least one user');
    }

    // A subscription (and perpetual maintenance) runs in calendar years unless
    // days are given; evaluations and pilots run their fixed number of days.
    const years = req.years ?? (req.edition === 'subscription' || req.edition === 'perpetual' ? 1 : undefined);
    if (req.days !== undefined && (!Number.isFinite(req.days) || req.days < 1)) {
        throw new Error('A license term must be at least one day');
    }
    if (years !== undefined && (!Number.isInteger(years) || years < 1 || years > 10)) {
        throw new Error('A license term is 1 to 10 years');
    }
    const end =
        req.days !== undefined
            ? new Date(start.getTime() + req.days * DAY)
            : years !== undefined && req.edition !== 'evaluation' && req.edition !== 'pilot'
              ? addYears(start, years)
              : policy.days === null
                ? null
                : new Date(start.getTime() + policy.days * DAY);
    const expiresAt = req.edition === 'perpetual' ? null : end;
    const maintenanceUntil = req.edition === 'perpetual' ? end : null;
    const enterprise = req.enterprise === true || isEnterpriseSize(req.product, quantity);

    return {
        format: LICENSE_FORMAT,
        id: meta.id,
        revision: meta.revision,
        issuer: ISSUER,
        product: req.product,
        edition: req.edition,
        licensee: {
            name: req.licensee.name.trim(),
            organization: req.licensee.organization.trim(),
            email: req.licensee.email.trim().toLowerCase(),
        },
        limit: { quantity, unit: productPricing[req.product].unit },
        features: featuresFor(req.product, req.edition, enterprise),
        support: req.edition === 'evaluation' ? 'standard' : (req.support ?? 'standard'),
        issuedAt: now.toISOString(),
        notBefore: start.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        graceDays: policy.graceDays,
        maintenanceUntil: maintenanceUntil?.toISOString() ?? null,
        installationId: normalizeInstallationId(req.installationId),
        watermark: policy.watermark,
    };
}
