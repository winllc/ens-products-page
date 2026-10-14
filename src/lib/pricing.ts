/*
 * Pricing arithmetic. Pure functions over src/data/pricing.ts, with no DOM and
 * no Astro, so the same code renders the static price tables at build time,
 * runs the estimator in the browser, and is unit tested on its own.
 *
 * Every amount is whole US dollars: each line is rounded once, and totals are
 * sums of the rounded lines, so what the estimator shows always adds up.
 */

import type { ProductId } from '../data/products';
import {
    PERPETUAL_MULTIPLE,
    bundleDiscounts,
    multiYear,
    pilot,
    productPricing,
    services,
    supportTiers,
    thresholds,
    type SupportTier,
    type SupportTierId,
    type Tier,
} from '../data/pricing';

export type LicenseModel = 'subscription' | 'perpetual';

const usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat('en-US');

export function formatUSD(amount: number): string {
    return usd.format(amount);
}

export function formatCount(n: number): string {
    return count.format(n);
}

export function formatPercent(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

/** "$12,000", "$120,000+", or "Contact us" for a band priced on request. */
export function formatTierPrice(amount: number | null, startingAt = false): string {
    if (amount === null) {
        return 'Contact us';
    }
    return formatUSD(amount) + (startingAt ? '+' : '');
}

function round(amount: number): number {
    return Math.round(amount);
}

/**
 * `rate` of `amount`, rounded to the dollar. The rate is scaled to an integer
 * first so that halves round the way a person would: 35% of $41,250 is
 * $14,437.50 and rounds to $14,438, where 41250 * 0.35 in floating point
 * comes to 14437.4999... and would round down.
 */
export function percentOf(amount: number, rate: number): number {
    return Math.round((amount * Math.round(rate * 10_000)) / 10_000);
}

/** The label a size band is shown under: "Up to 2,500", "2,501–10,000", "Over 50,000". */
export function tierLabel(tiers: readonly Tier[], index: number): string {
    const tier = tiers[index];
    if (!tier) {
        throw new RangeError(`No tier ${index}`);
    }
    if (tier.label) {
        return tier.label;
    }
    const previous = index > 0 ? tiers[index - 1]?.upTo ?? null : null;
    if (tier.upTo === null) {
        return previous === null ? 'Any size' : `Over ${formatCount(previous)}`;
    }
    if (previous === null) {
        return `Up to ${formatCount(tier.upTo)}`;
    }
    return `${formatCount(previous + 1)}–${formatCount(tier.upTo)}`;
}

/** The band a deployment of `quantity` falls in. Band limits are inclusive. */
export function tierIndexFor(productId: ProductId, quantity: number, multiForest = false): number {
    const tiers = productPricing[productId].tiers;
    if (multiForest) {
        return tiers.length - 1;
    }
    const index = tiers.findIndex((t) => t.upTo === null || quantity <= t.upTo);
    return index === -1 ? tiers.length - 1 : index;
}

/** Perpetual license list price for a band's annual subscription price. */
export function perpetualPrice(annual: number): number {
    return percentOf(annual, PERPETUAL_MULTIPLE);
}

/** Lowest annual subscription across a product's bands: the "from" price. */
export function startingPrice(productId: ProductId): number {
    const prices = productPricing[productId].tiers
        .map((t) => t.annual)
        .filter((a): a is number => a !== null);
    return Math.min(...prices);
}

/** Suite discount for a number of products: 0, or the highest band reached. */
export function bundleRate(productCount: number): number {
    let rate = 0;
    for (const band of bundleDiscounts) {
        if (productCount >= band.minProducts) {
            rate = Math.max(rate, band.rate);
        }
    }
    return rate;
}

export function supportTier(id: SupportTierId): SupportTier {
    const tier = supportTiers.find((t) => t.id === id);
    if (!tier) {
        throw new Error(`Unknown support tier: ${id}`);
    }
    return tier;
}

/* ---------------------------------------------------------------- *
 * Quotes
 * ---------------------------------------------------------------- */

export interface QuoteLineInput {
    product: ProductId;
    /** Users, SecurID users or tracked people, per the product's unit. */
    quantity: number;
    /** CertAlert only: several forests always price as Enterprise. */
    multiForest?: boolean;
}

export interface QuoteInput {
    model: LicenseModel;
    lines: readonly QuoteLineInput[];
    support: SupportTierId;
    /** Subscription only: prepay the multi-year term at a discount. */
    prepay?: boolean;
    install?: boolean;
    atoPackage?: boolean;
    trainingSessions?: number;
    pilot?: boolean;
}

export interface QuoteLine {
    product: ProductId;
    quantity: number;
    tierLabel: string;
    /** List price for the chosen model (annual or perpetual), or null if priced on request. */
    list: number | null;
    startingAt: boolean;
}

export interface Range {
    low: number;
    high: number;
}

export interface Quote {
    model: LicenseModel;
    lines: QuoteLine[];
    /** Products taken, priced or not; this is what the suite discount counts. */
    productCount: number;
    bundleRate: number;
    /** Sum of the priced lines at list. */
    listSubtotal: number;
    bundleDiscount: number;
    /** License (perpetual) or subscription (yearly) after the suite discount. */
    netLicense: number;
    support: { tier: SupportTier; rate: number; amount: number; included: boolean };
    /**
     * Software cost that recurs every year: the subscription with its support
     * add-on, or, on a perpetual license, the maintenance.
     */
    annual: number;
    /** Perpetual only: the one-time license. 0 on subscription. */
    oneTimeLicense: number;
    /** Subscription with prepay only. */
    prepay: { years: number; discount: number; total: number; perYear: number } | null;
    services: { id: string; label: string; low: number; high: number }[];
    servicesTotal: Range;
    pilot: { price: number; credit: number } | null;
    /**
     * The first software order: a year of subscription (or the whole prepaid
     * term), or a perpetual license with its first year of maintenance.
     * The pilot credit is taken off it.
     */
    softwareOrder: number;
    /** Software order plus one-time services. */
    yearOne: Range;
    /** Some product is past the top published band and is priced on request. */
    hasUnpricedLines: boolean;
    /** Some product is in a "starting at" band, so totals are floors. */
    isFloor: boolean;
    /** Which purchasing route the software order fits. */
    acquisition: 'micro-purchase' | 'simplified' | 'above-simplified';
}

function clampQuantity(n: number): number {
    if (!Number.isFinite(n) || n < 1) {
        return 1;
    }
    return Math.floor(n);
}

export function quote(input: QuoteInput): Quote {
    const model = input.model;
    const support = supportTier(input.support);

    const lines: QuoteLine[] = input.lines.map((line) => {
        const quantity = clampQuantity(line.quantity);
        const multiForest = line.product === 'certalert' && line.multiForest === true;
        const tiers = productPricing[line.product].tiers;
        const index = tierIndexFor(line.product, quantity, multiForest);
        const tier = tiers[index]!;
        const list =
            tier.annual === null ? null : model === 'perpetual' ? perpetualPrice(tier.annual) : tier.annual;
        return {
            product: line.product,
            quantity,
            tierLabel: tierLabel(tiers, index),
            list,
            startingAt: tier.startingAt === true,
        };
    });

    const productCount = new Set(lines.map((l) => l.product)).size;
    const rate = bundleRate(productCount);
    const listSubtotal = lines.reduce((sum, l) => sum + (l.list ?? 0), 0);
    const bundleDiscount = percentOf(listSubtotal, rate);
    const netLicense = listSubtotal - bundleDiscount;

    const supportRate = model === 'perpetual' ? support.perpetualRate : support.subscriptionRate;
    const supportAmount = percentOf(netLicense, supportRate);

    const annual = model === 'perpetual' ? supportAmount : netLicense + supportAmount;
    const oneTimeLicense = model === 'perpetual' ? netLicense : 0;

    let prepay: Quote['prepay'] = null;
    if (model === 'subscription' && input.prepay) {
        const gross = annual * multiYear.years;
        const discount = percentOf(gross, multiYear.discount);
        const total = gross - discount;
        prepay = { years: multiYear.years, discount, total, perYear: round(total / multiYear.years) };
    }

    const serviceLines: Quote['services'] = [];
    if (input.install && lines.length > 0) {
        const n = lines.length;
        serviceLines.push({
            id: 'install',
            label: `${services.install.name} (${n} ${n === 1 ? 'product' : 'products'})`,
            low: services.install.low! * n,
            high: services.install.high! * n,
        });
    }
    if (input.atoPackage) {
        serviceLines.push({
            id: 'ato',
            label: services.ato.name,
            low: services.ato.low!,
            high: services.ato.high!,
        });
    }
    const sessions = Math.max(0, Math.floor(input.trainingSessions ?? 0));
    if (sessions > 0) {
        serviceLines.push({
            id: 'training',
            label: `${services.training.name} (${sessions} half-day ${sessions === 1 ? 'session' : 'sessions'})`,
            low: services.training.low! * sessions,
            high: services.training.high! * sessions,
        });
    }
    const servicesTotal = serviceLines.reduce(
        (sum, s) => ({ low: sum.low + s.low, high: sum.high + s.high }),
        { low: 0, high: 0 },
    );

    const pilotLine = input.pilot ? { price: pilot.price, credit: pilot.price } : null;

    const firstOrder = model === 'perpetual' ? oneTimeLicense + annual : prepay ? prepay.total : annual;
    const softwareOrder = Math.max(0, firstOrder - (pilotLine?.credit ?? 0));

    const acquisition =
        softwareOrder <= thresholds.microPurchase
            ? 'micro-purchase'
            : softwareOrder <= thresholds.simplifiedAcquisition
              ? 'simplified'
              : 'above-simplified';

    return {
        model,
        lines,
        productCount,
        bundleRate: rate,
        listSubtotal,
        bundleDiscount,
        netLicense,
        support: { tier: support, rate: supportRate, amount: supportAmount, included: supportRate === 0 },
        annual,
        oneTimeLicense,
        prepay,
        services: serviceLines,
        servicesTotal,
        pilot: pilotLine,
        softwareOrder,
        yearOne: { low: softwareOrder + servicesTotal.low, high: softwareOrder + servicesTotal.high },
        hasUnpricedLines: lines.some((l) => l.list === null),
        isFloor: lines.some((l) => l.startingAt),
        acquisition,
    };
}

/** "$20,000" for a fixed amount, "$20,000–$55,000" for a range. */
export function formatRange(range: Range): string {
    return range.low === range.high
        ? formatUSD(range.low)
        : `${formatUSD(range.low)}–${formatUSD(range.high)}`;
}

/* ---------------------------------------------------------------- *
 * RSA Operations Portal help-desk savings
 * ---------------------------------------------------------------- */

/** Yearly help-desk cost avoided when `resetsPerMonth` PIN resets go self-service. */
export function helpDeskSavings(resetsPerMonth: number, costPerTicket: number, selfServiceShare = 1): number {
    const resets = Math.max(0, resetsPerMonth);
    const cost = Math.max(0, costPerTicket);
    const portion = Math.min(1, Math.max(0, selfServiceShare));
    return round(resets * 12 * cost * portion);
}
