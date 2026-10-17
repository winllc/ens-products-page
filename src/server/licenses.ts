/*
 * Issuing and managing licenses. Every way a license comes to exist or
 * change goes through here: self-service evaluations, licenses ENS issues
 * against an order, installation binding, renewal, revocation. Each writes
 * the audit log.
 *
 * A license row keeps the payload and signed token of its current revision.
 * Any change re-signs the license with the same id and revision + 1; the
 * applications keep the highest revision they have seen, so an older file
 * can't be put back once a newer one is installed.
 */

import { editions, EVALUATIONS_PER_PRODUCT, type Edition } from '../data/licensing';
import { product as productInfo, type ProductId } from '../data/products';
import { buildPayload, newLicenseId, normalizeInstallationId, type IssueRequest } from '../lib/licensing/issue';
import {
    licenseFile,
    licenseState,
    signToken,
    summaryLines,
    verifyLicense,
    type LicensePayload,
    type LicenseState,
} from '../lib/licensing/license';
import { isAdmin, type Account } from './accounts';
import { audit } from './audit';
import { db, nowIso, transaction } from './db';
import { signingKey, trustedKeys } from './keys';

interface LicenseRow {
    id: string;
    account_id: string;
    product: ProductId;
    edition: Edition;
    label: string;
    revision: number;
    payload: string;
    token: string;
    key_id: string;
    issued_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    revoked_reason: string | null;
    order_reference: string;
    created_by: string | null;
}

export interface License extends Omit<LicenseRow, 'payload'> {
    payload: LicensePayload;
    /** Revoked wins over whatever the dates say. */
    status: LicenseState | 'revoked';
    daysLeft: number | null;
}

export class LicenseActionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LicenseActionError';
    }
}

function hydrate(row: LicenseRow, now = new Date()): License {
    const payload = JSON.parse(row.payload) as LicensePayload;
    const { state, daysLeft } = licenseState(payload, now);
    return { ...row, payload, status: row.revoked_at ? 'revoked' : state, daysLeft: row.revoked_at ? null : daysLeft };
}

export function licenseById(id: string): License | null {
    const row = db().prepare('SELECT * FROM licenses WHERE id = ?').get(id) as LicenseRow | undefined;
    return row ? hydrate(row) : null;
}

/** The license, if this account may see it: its owner, or an administrator. */
export function licenseFor(account: Account, id: string): License | null {
    const l = licenseById(id);
    return l && (l.account_id === account.id || isAdmin(account)) ? l : null;
}

export function licensesOf(accountId: string): License[] {
    return (db().prepare('SELECT * FROM licenses WHERE account_id = ? ORDER BY issued_at DESC').all(accountId) as unknown as LicenseRow[]).map(
        (r) => hydrate(r),
    );
}

export function allLicenses(filter: { search?: string; status?: string } = {}): (License & { owner_email: string })[] {
    const q = `%${(filter.search ?? '').trim().toLowerCase()}%`;
    const rows = db()
        .prepare(
            `SELECT l.*, a.email AS owner_email FROM licenses l JOIN accounts a ON a.id = l.account_id
             WHERE lower(l.id) LIKE ? OR lower(a.email) LIKE ? OR lower(a.organization) LIKE ? OR lower(l.order_reference) LIKE ?
             ORDER BY l.issued_at DESC LIMIT 500`,
        )
        .all(q, q, q, q) as unknown as (LicenseRow & { owner_email: string })[];
    const licenses = rows.map((r) => ({ ...hydrate(r), owner_email: r.owner_email }));
    return filter.status ? licenses.filter((l) => l.status === filter.status) : licenses;
}

function store(payload: LicensePayload, fields: { accountId: string; label: string; orderReference: string; createdBy: string }): void {
    const key = signingKey();
    const token = signToken(payload, key);
    db()
        .prepare(
            `INSERT INTO licenses (id, account_id, product, edition, label, revision, payload, token, key_id, issued_at, expires_at, order_reference, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
            payload.id,
            fields.accountId,
            payload.product,
            payload.edition,
            fields.label,
            payload.revision,
            JSON.stringify(payload),
            token,
            key.id,
            payload.issuedAt,
            payload.expiresAt,
            fields.orderReference,
            fields.createdBy,
        );
}

/** Signs a changed payload as the next revision of an existing license. */
function resign(license: License, change: (p: LicensePayload) => LicensePayload): LicensePayload {
    const key = signingKey();
    const next = change({ ...license.payload, revision: license.revision + 1, issuedAt: nowIso() });
    db()
        .prepare('UPDATE licenses SET revision = ?, payload = ?, token = ?, key_id = ?, expires_at = ? WHERE id = ? AND revision = ?')
        .run(next.revision, JSON.stringify(next), signToken(next, key), key.id, next.expiresAt, license.id, license.revision);
    return next;
}

/** buildPayload rejects bad input with plain errors; surface them as messages the form can show. */
function payloadFor(req: IssueRequest): LicensePayload {
    try {
        return buildPayload(req, { id: newLicenseId(), revision: 1 });
    } catch (err) {
        throw new LicenseActionError((err as Error).message);
    }
}

function requireVerified(owner: Account): void {
    if (!owner.email_verified_at) {
        throw new LicenseActionError('Confirm your email address before taking a license');
    }
    if (owner.disabled_at) {
        throw new LicenseActionError('This account is disabled');
    }
}

/* ---- Customer: evaluations ---------------------------------------------- */

export function evaluationsTaken(accountId: string, product: ProductId): number {
    const row = db()
        .prepare("SELECT COUNT(*) AS n FROM licenses WHERE account_id = ? AND product = ? AND edition = 'evaluation'")
        .get(accountId, product) as { n: number };
    return row.n;
}

export function canTakeEvaluation(account: Account, product: ProductId): boolean {
    return evaluationsTaken(account.id, product) < EVALUATIONS_PER_PRODUCT;
}

export function issueEvaluation(account: Account, product: ProductId, installationId?: string | null): License {
    requireVerified(account);
    return transaction(() => {
        if (!canTakeEvaluation(account, product)) {
            throw new LicenseActionError(
                `You already have a ${productInfo(product).name} evaluation. Ask us to extend it, or about a paid pilot.`,
            );
        }
        const payload = payloadFor({
            product,
            edition: 'evaluation',
            licensee: { name: account.name, organization: account.organization, email: account.email },
            installationId,
        });
        store(payload, { accountId: account.id, label: `${productInfo(product).name} evaluation`, orderReference: '', createdBy: account.id });
        audit({
            actor: account.id,
            account: account.id,
            license: payload.id,
            action: 'license.issued',
            detail: `${product} evaluation`,
            details: { product, edition: 'evaluation', quantity: payload.limit.quantity, expiresAt: payload.expiresAt },
        });
        return licenseById(payload.id)!;
    });
}

/* ---- Customer: managing their licenses ---------------------------------- */

export function downloadLicense(actor: Account, license: License): { filename: string; content: string } {
    const name = productInfo(license.product).name;
    const content = licenseFile(
        license.token,
        summaryLines(license.payload, { product: name, edition: editions[license.edition].name }),
    );
    audit({
        actor: actor.id,
        account: license.account_id,
        license: license.id,
        action: 'license.downloaded',
        detail: `revision ${license.revision}`,
        details: { product: license.product, revision: license.revision },
    });
    return { filename: `${license.product}-${license.id}-r${license.revision}.lic`, content };
}

export function bindInstallation(actor: Account, license: License, raw: string | null): License {
    if (license.status === 'revoked') {
        throw new LicenseActionError('A revoked license can’t be changed');
    }
    let installationId: string | null;
    try {
        installationId = normalizeInstallationId(raw);
    } catch (err) {
        throw new LicenseActionError((err as Error).message);
    }
    if (installationId === license.payload.installationId) {
        return license;
    }
    transaction(() => {
        resign(license, (p) => ({ ...p, installationId }));
        audit({
            actor: actor.id,
            account: license.account_id,
            license: license.id,
            action: 'license.bound',
            detail: installationId ? `bound to ${installationId}` : 'binding removed',
            details: { 'installationId.old': license.payload.installationId ?? null, 'installationId.new': installationId, revision: license.revision + 1 },
        });
    });
    return licenseById(license.id)!;
}

export function renameLicense(actor: Account, license: License, label: string): License {
    const clean = label.trim().replace(/\s+/g, ' ').slice(0, 120);
    transaction(() => {
        db().prepare('UPDATE licenses SET label = ? WHERE id = ?').run(clean, license.id);
        audit({
            actor: actor.id,
            account: license.account_id,
            license: license.id,
            action: 'license.renamed',
            detail: clean,
            details: { 'label.old': license.label, 'label.new': clean },
        });
    });
    return licenseById(license.id)!;
}

/* ---- Administration ------------------------------------------------------ */

function requireAdmin(actor: Account): void {
    if (!isAdmin(actor)) {
        throw new LicenseActionError('Administrators only');
    }
}

export function issueLicense(
    actor: Account,
    owner: Account,
    req: Omit<IssueRequest, 'licensee'> & { licenseeOrganization?: string },
    fields: { label?: string; orderReference?: string } = {},
): License {
    requireAdmin(actor);
    requireVerified(owner);
    const { licenseeOrganization, ...rest } = req;
    const payload = payloadFor({
        ...rest,
        licensee: {
            name: owner.name,
            organization: licenseeOrganization?.trim() || owner.organization,
            email: owner.email,
        },
    });
    transaction(() => {
        store(payload, {
            accountId: owner.id,
            label: fields.label?.trim() || `${productInfo(req.product).name} ${editions[req.edition].name.toLowerCase()}`,
            orderReference: fields.orderReference?.trim() ?? '',
            createdBy: actor.id,
        });
        audit({
            actor: actor.id,
            account: owner.id,
            license: payload.id,
            action: 'license.issued',
            detail: `${req.product} ${req.edition}, ${payload.limit.quantity} ${payload.limit.unit}${fields.orderReference ? `, order ${fields.orderReference}` : ''}`,
            details: {
                product: req.product,
                edition: req.edition,
                quantity: payload.limit.quantity,
                unit: payload.limit.unit,
                support: payload.support,
                expiresAt: payload.expiresAt,
                installationId: payload.installationId,
                orderReference: fields.orderReference?.trim() || null,
            },
        });
    });
    return licenseById(payload.id)!;
}

const DAY = 24 * 60 * 60 * 1000;

/** Moves the expiry (or, on a perpetual license, the end of maintenance) to a new date. */
export function renewLicense(actor: Account, license: License, until: Date, orderReference = ''): License {
    requireAdmin(actor);
    if (license.status === 'revoked') {
        throw new LicenseActionError('Reinstate the license before renewing it');
    }
    if (!Number.isFinite(until.getTime()) || until.getTime() < Date.now() + DAY) {
        throw new LicenseActionError('Renew to a date at least a day from now');
    }
    const iso = until.toISOString();
    transaction(() => {
        resign(license, (p) => (p.edition === 'perpetual' ? { ...p, maintenanceUntil: iso } : { ...p, expiresAt: iso }));
        if (orderReference.trim()) {
            db().prepare('UPDATE licenses SET order_reference = ? WHERE id = ?').run(orderReference.trim(), license.id);
        }
        audit({
            actor: actor.id,
            account: license.account_id,
            license: license.id,
            action: 'license.renewed',
            detail: `${license.edition === 'perpetual' ? 'maintenance' : 'expiry'} to ${iso.slice(0, 10)}${orderReference ? `, order ${orderReference}` : ''}`,
            details:
                license.edition === 'perpetual'
                    ? { 'maintenanceUntil.old': license.payload.maintenanceUntil ?? null, 'maintenanceUntil.new': iso, orderReference: orderReference.trim() || null }
                    : { 'expiresAt.old': license.payload.expiresAt, 'expiresAt.new': iso, orderReference: orderReference.trim() || null },
        });
    });
    return licenseById(license.id)!;
}

export function revokeLicense(actor: Account, license: License, reason: string): License {
    requireAdmin(actor);
    const why = reason.trim().slice(0, 300) || 'No reason given';
    transaction(() => {
        db().prepare('UPDATE licenses SET revoked_at = ?, revoked_reason = ? WHERE id = ?').run(nowIso(), why, license.id);
        audit({ actor: actor.id, account: license.account_id, license: license.id, action: 'license.revoked', detail: why, details: { reason: why } });
    });
    return licenseById(license.id)!;
}

export function reinstateLicense(actor: Account, license: License): License {
    requireAdmin(actor);
    transaction(() => {
        db().prepare('UPDATE licenses SET revoked_at = NULL, revoked_reason = NULL WHERE id = ?').run(license.id);
        audit({ actor: actor.id, account: license.account_id, license: license.id, action: 'license.reinstated' });
    });
    return licenseById(license.id)!;
}

/* ---- Public ---------------------------------------------------------------- */

/**
 * What an application with a network route may ask about a license: whether
 * it has been revoked, and the latest revision. No customer details.
 */
export function publicStatus(id: string): {
    id: string;
    product: ProductId;
    edition: Edition;
    status: License['status'];
    revision: number;
    expiresAt: string | null;
} | null {
    const l = licenseById(id);
    if (!l) return null;
    return { id: l.id, product: l.product, edition: l.edition, status: l.status, revision: l.revision, expiresAt: l.payload.expiresAt };
}

/** Checks a license file a customer pastes or uploads: signature, then what we know about it. */
export function inspectFile(text: string): { payload: LicensePayload; state: LicenseState; known: License | null } {
    const payload = verifyLicense(text, trustedKeys());
    return { payload, state: licenseState(payload).state, known: licenseById(payload.id) };
}
