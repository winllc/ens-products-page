/*
 * The compliance documentation pack in the licensing service: who may read
 * it, which artifacts are published, the files the service generates from
 * the control matrix and the manifest, the ZIP of everything, and the audit
 * events for all of it.
 *
 * Access is per account: an administrator grants it at /admin/accounts/<id>
 * or /admin/compliance (compliance.granted / compliance.revoked), and it
 * holds only while the account is enabled and its email confirmed.
 * Administrators read everything. An artifact reaches customers only once an
 * administrator publishes it (compliance.published / compliance.unpublished);
 * until then administrators alone see it, marked unpublished. Every download
 * is compliance.downloaded, which the customer sees in their own history.
 *
 * The manifest (src/data/compliance/manifest.ts), the control matrix
 * (controls.ts) and the document bytes (compliance-files.ts) are parameters
 * with those defaults, so the tests run on fixtures.
 */

import { controls as allControls } from '../data/compliance/controls';
import { complianceArtifacts } from '../data/compliance/manifest';
import { CONTROL_FAMILIES, type ArtifactFile, type ComplianceArtifact, type Control } from '../data/compliance/types';
import { products, type ProductId } from '../data/products';
import { accountById, isAdmin, type Account } from './accounts';
import { audit } from './audit';
import { complianceSource } from './compliance-files';
import { db, nowIso, transaction } from './db';
import { zip } from './zip';

export type Manifest = readonly ComplianceArtifact[];
export type Controls = readonly Control[];
/** Reads a document's text by its path under compliance/; undefined when there is no such file. */
export type SourceReader = (path: string) => string | undefined;

export interface VisibleArtifact extends ComplianceArtifact {
    published: boolean;
    published_at: string | null;
}

export class ComplianceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ComplianceError';
    }
}

/** Downloads an account may make in an hour, as for releases. */
export const COMPLIANCE_DOWNLOAD_LIMIT = 120;
export const COMPLIANCE_DOWNLOAD_WINDOW_MINUTES = 60;

const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,80}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,120}$/;

export function isArtifactId(s: string): boolean {
    return ARTIFACT_ID.test(s);
}

export function isFileName(s: string): boolean {
    return FILE_NAME.test(s) && !s.includes('..');
}

/* ---- Access ---------------------------------------------------------------- */

/** Administrators always; customers once granted, while enabled and with a confirmed email. */
export function canRead(account: Account | null | undefined): boolean {
    if (!account || account.disabled_at) return false;
    if (isAdmin(account)) return true;
    return account.compliance_access_at !== null && account.email_verified_at !== null;
}

/** Grants the pack to an account. False when it already had it (nothing is recorded). */
export function grant(admin: Account, target: Account): boolean {
    const current = accountById(target.id);
    if (!current) throw new ComplianceError('No such account');
    if (current.compliance_access_at) return false;
    transaction(() => {
        db().prepare('UPDATE accounts SET compliance_access_at = ?, compliance_access_by = ? WHERE id = ?').run(nowIso(), admin.id, target.id);
        audit({ actor: admin.id, account: target.id, action: 'compliance.granted' });
    });
    return true;
}

/** Takes the pack away again. False when the account did not have it. */
export function revoke(admin: Account, target: Account): boolean {
    const current = accountById(target.id);
    if (!current) throw new ComplianceError('No such account');
    if (!current.compliance_access_at) return false;
    transaction(() => {
        db().prepare('UPDATE accounts SET compliance_access_at = NULL, compliance_access_by = NULL WHERE id = ?').run(target.id);
        audit({ actor: admin.id, account: target.id, action: 'compliance.revoked' });
    });
    return true;
}

export interface AccessHolder extends Account {
    /** The granting administrator's address, if that account still exists. */
    granted_by_email: string | null;
}

/** Every account with access, most recently granted first. */
export function accountsWithAccess(): AccessHolder[] {
    const rows = db()
        .prepare(
            `SELECT a.id, a.email, a.name, a.organization, a.phone, a.role, a.email_verified_at, a.disabled_at, a.created_at, a.last_login_at,
                    a.compliance_access_at, a.compliance_access_by, g.email AS granted_by_email
             FROM accounts a LEFT JOIN accounts g ON g.id = a.compliance_access_by
             WHERE a.compliance_access_at IS NOT NULL
             ORDER BY a.compliance_access_at DESC`,
        )
        .all() as unknown as AccessHolder[];
    return rows;
}

/* ---- Publishing --------------------------------------------------------------- */

interface PublishedRow {
    id: string;
    published_at: string | null;
    published_by: string | null;
}

/** The publish state of every artifact the database has heard of, by id. */
export function publishedState(): Map<string, PublishedRow> {
    const rows = db().prepare('SELECT id, published_at, published_by FROM compliance_artifacts').all() as unknown as PublishedRow[];
    return new Map(rows.map((r) => [r.id, r]));
}

export function isPublished(id: string): boolean {
    return publishedState().get(id)?.published_at != null;
}

function known(id: string, manifest: Manifest): ComplianceArtifact {
    const a = manifest.find((x) => x.id === id);
    if (!a) throw new ComplianceError('No such artifact');
    return a;
}

/** Publishes an artifact to the accounts with access. False when it already was. */
export function publish(admin: Account, id: string, manifest: Manifest = complianceArtifacts): boolean {
    const a = known(id, manifest);
    if (isPublished(id)) return false;
    transaction(() => {
        db()
            .prepare(
                `INSERT INTO compliance_artifacts (id, published_at, published_by) VALUES (?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET published_at = excluded.published_at, published_by = excluded.published_by`,
            )
            .run(id, nowIso(), admin.id);
        audit({
            actor: admin.id,
            action: 'compliance.published',
            detail: `${a.title} ${a.version}`,
            target: { type: 'compliance-artifact', id, name: a.title },
            details: { artifact: id, version: a.version },
        });
    });
    return true;
}

/** Takes an artifact back to administrators only. False when it was not published. */
export function unpublish(admin: Account, id: string, manifest: Manifest = complianceArtifacts): boolean {
    const a = known(id, manifest);
    if (!isPublished(id)) return false;
    transaction(() => {
        db().prepare('UPDATE compliance_artifacts SET published_at = NULL, published_by = NULL WHERE id = ?').run(id);
        audit({
            actor: admin.id,
            action: 'compliance.unpublished',
            detail: `${a.title} ${a.version}`,
            target: { type: 'compliance-artifact', id, name: a.title },
            details: { artifact: id, version: a.version },
        });
    });
    return true;
}

/**
 * The artifacts an account sees: the published ones, or every one for an
 * administrator, each flagged. Nothing for an account that cannot read the
 * pack. In manifest order.
 */
export function visibleArtifacts(account: Account | null | undefined, manifest: Manifest = complianceArtifacts): VisibleArtifact[] {
    if (!canRead(account)) return [];
    const state = publishedState();
    const admin = isAdmin(account);
    const out: VisibleArtifact[] = [];
    for (const a of manifest) {
        const published_at = state.get(a.id)?.published_at ?? null;
        const published = published_at !== null;
        if (published || admin) out.push({ ...a, published, published_at });
    }
    return out;
}

export function visibleArtifact(account: Account | null | undefined, id: string, manifest: Manifest = complianceArtifacts): VisibleArtifact | null {
    if (!isArtifactId(id)) return null;
    return visibleArtifacts(account, manifest).find((a) => a.id === id) ?? null;
}

/** The artifacts for the product pages: those covering the product, in manifest order. Published or not: the pages only say what the pack contains. */
export function artifactsFor(product: ProductId, manifest: Manifest = complianceArtifacts): ComplianceArtifact[] {
    return manifest.filter((a) => a.products === 'all' || a.products.includes(product));
}

/* ---- Generated files ------------------------------------------------------------- */

const CSV_BOM = '\uFEFF';

/** RFC 4180: a field is quoted when it holds a quote, a comma or a line break, with quotes doubled. */
export function csvField(v: string | null | undefined): string {
    const s = v ?? '';
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CONTROLS_CSV_COLUMNS = ['id', 'family', 'title', 'product', 'status', 'implementation', 'evidence', 'customer_responsibility'] as const;

const productName = (id: ProductId) => products.find((p) => p.id === id)?.name ?? id;

/**
 * The control matrix as CSV, one row per control and product, with a UTF-8
 * byte order mark so Excel reads it as UTF-8 and CRLF line ends (RFC 4180).
 */
export function controlsCsv(controls: Controls = allControls): string {
    const lines = [CONTROLS_CSV_COLUMNS.join(',')];
    for (const c of controls) {
        for (const p of products) {
            const impl = c.products[p.id];
            if (!impl) continue;
            lines.push(
                [c.id, c.family, c.title, p.name, impl.status, impl.implementation, impl.evidence.join('; '), impl.customerResponsibility ?? '']
                    .map(csvField)
                    .join(','),
            );
        }
    }
    return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

/** The control matrix as JSON: the families, the products by id, and the controls as the site holds them. */
export function controlsJson(controls: Controls = allControls, now = new Date()): string {
    return `${JSON.stringify(
        {
            standard: 'NIST SP 800-53 Rev. 5',
            generated: now.toISOString(),
            families: CONTROL_FAMILIES,
            products: Object.fromEntries(products.map((p) => [p.id, p.name])),
            controls,
        },
        null,
        2,
    )}\n`;
}

/** The manifest as JSON: what each artifact is and the files it holds, without where the bytes come from. */
export function manifestJson(manifest: Manifest = complianceArtifacts, now = new Date()): string {
    return `${JSON.stringify(
        {
            generated: now.toISOString(),
            artifacts: manifest.map((a) => ({
                id: a.id,
                kind: a.kind,
                title: a.title,
                summary: a.summary,
                products: a.products === 'all' ? products.map((p) => p.id) : a.products,
                version: a.version,
                date: a.date,
                files: a.files.map((f) => ({ name: f.name, title: f.title, contentType: f.contentType })),
            })),
        },
        null,
        2,
    )}\n`;
}

export interface FileSources {
    manifest?: Manifest;
    controls?: Controls;
    read?: SourceReader;
}

/**
 * One file's bytes: a bundled document, or a generated one. Null when the
 * manifest names a file the build does not hold, which the route reports as
 * a 404 and logs.
 */
export function fileContent(file: ArtifactFile, sources: FileSources = {}): Buffer | null {
    const s = file.source;
    switch (s.kind) {
        case 'file': {
            const text = (sources.read ?? complianceSource)(s.path);
            return text === undefined ? null : Buffer.from(text, 'utf8');
        }
        case 'controls-csv':
            return Buffer.from(controlsCsv(sources.controls), 'utf8');
        case 'controls-json':
            return Buffer.from(controlsJson(sources.controls), 'utf8');
        case 'manifest-json':
            return Buffer.from(manifestJson(sources.manifest), 'utf8');
    }
}

/** The file's size in bytes, for the listing; null when the build does not hold it. */
export function fileSize(file: ArtifactFile, sources: FileSources = {}): number | null {
    return fileContent(file, sources)?.length ?? null;
}

export function findFile(artifact: ComplianceArtifact, name: string): ArtifactFile | null {
    if (!isFileName(name)) return null;
    return artifact.files.find((f) => f.name === name) ?? null;
}

/** The first Markdown file of an artifact: the document the page renders. */
export function documentOf(artifact: ComplianceArtifact): { file: ArtifactFile; path: string } | null {
    for (const f of artifact.files) {
        if (f.source.kind === 'file' && /\.md$/i.test(f.source.path)) return { file: f, path: f.source.path };
    }
    return null;
}

export const PACKAGE_NAME = 'package.zip';

/**
 * Every file of every artifact given, under <artifact id>/<file>, plus a
 * README.txt naming the versions and the date. Files the build lacks are
 * named in the README instead of silently left out.
 */
export function packageZip(artifacts: readonly ComplianceArtifact[], sources: FileSources = {}, now = new Date()): Buffer {
    const entries: { name: string; data: Buffer; date?: Date }[] = [];
    const readme: string[] = [
        'ENS Solutions compliance documentation pack',
        `Generated ${now.toISOString().slice(0, 10)} by the licensing portal.`,
        '',
        'Each folder is one artifact; its version and the date of its last revision are given here',
        'and in the document itself. Questions: info@ens-solutions.com.',
        '',
    ];
    for (const a of artifacts) {
        readme.push(`${a.id}/  ${a.title}`, `    version ${a.version}, revised ${a.date}; covers ${a.products === 'all' ? 'all products' : a.products.map(productName).join(', ')}`);
        const date = Number.isFinite(Date.parse(a.date)) ? new Date(`${a.date}T00:00:00Z`) : now;
        for (const f of a.files) {
            const data = fileContent(f, sources);
            if (!data) {
                readme.push(`    ${f.name}  (not in this build)`);
                continue;
            }
            readme.push(`    ${f.name}  ${f.title}`);
            entries.push({ name: `${a.id}/${f.name}`, data, date: f.source.kind === 'file' ? date : now });
        }
        readme.push('');
    }
    return zip([{ name: 'README.txt', data: Buffer.from(`${readme.join('\n')}\n`, 'utf8'), date: now }, ...entries]);
}

/* ---- Downloads ------------------------------------------------------------------------ */

/** Records compliance.downloaded against the account, as release.downloaded is. */
export function recordDownload(actor: Account, artifact: string, file: string, details: Record<string, unknown> = {}): void {
    audit({
        actor: actor.id,
        account: actor.id,
        action: 'compliance.downloaded',
        detail: `${artifact}: ${file}`,
        target: { type: 'compliance-artifact', id: artifact, name: file },
        details: { artifact, file, ...details },
    });
}

/** Downloads recorded per artifact id (the package under "package"), from the audit log. */
export function downloadCounts(): Map<string, number> {
    const rows = db()
        .prepare("SELECT target_id AS id, COUNT(*) AS n FROM audit_events WHERE action = 'compliance.downloaded' AND outcome = 'success' GROUP BY target_id")
        .all() as { id: string | null; n: number }[];
    return new Map(rows.filter((r) => r.id !== null).map((r) => [r.id!, r.n]));
}
