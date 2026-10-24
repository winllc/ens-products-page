/*
 * Release downloads: reading the private release bucket, and presigned links
 * into it.
 *
 * The applications' CI writes the bucket (src/lib/releases.ts has the
 * layout); the portal only reads it, with s3:ListBucket and s3:GetObject, and
 * never streams a release itself: a download is a 302 to a presigned GET URL
 * that works for RELEASES_URL_TTL seconds. Packages carry container images
 * and run to 1.5 GB, which is S3's job, not this service's.
 *
 * Listings (ListObjectsV2 with a delimiter), latest.txt and each version's
 * SHA256SUMS are cached in memory for RELEASES_LISTING_TTL seconds, so a busy
 * downloads page costs a few requests every few minutes. A failed request is
 * not cached.
 *
 * The client is the AWS SDK v3, with credentials from its standard chain
 * (environment, shared config, instance or task role). The same code talks to
 * AWS S3, Cloudflare R2 and MinIO: RELEASES_S3_ENDPOINT and
 * RELEASES_S3_FORCE_PATH_STYLE point it elsewhere.
 */

import { GetObjectCommand, ListObjectsV2Command, S3Client, type ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ProductId } from '../data/products';
import { RELEASE_PREFIX, isFileName, isPrerelease, isVersion, parseSha256Sums, sortFiles, sortVersions } from '../lib/releases';
import type { Account } from './accounts';
import { audit, recordLockout } from './audit';
import { config, type ReleasesConfig } from './config';
import { allow } from './rate-limit';

export interface ReleaseFile {
    name: string;
    size: number;
    /** From the version's SHA256SUMS; null for files it doesn't list (itself, its signature). */
    sha256: string | null;
}

export interface ReleaseVersion {
    version: string;
    prerelease: boolean;
    /** The version latest.txt names. */
    latest: boolean;
}

export interface ProductReleases {
    product: ProductId;
    prefix: string;
    /** From latest.txt; failing that, the newest final version listed. Null if there is none. */
    latest: string | null;
    /** Newest first. */
    versions: ReleaseVersion[];
}

/** SHA256SUMS and latest.txt are small; anything bigger is not what CI writes. */
const MAX_SMALL_OBJECT = 1024 * 1024;

export function releasesConfig(): ReleasesConfig | null {
    return config().releases;
}

export function releasesEnabled(): boolean {
    return releasesConfig() !== null;
}

/* ---- The client --------------------------------------------------------- */

let client: S3Client | null = null;

function s3(): S3Client {
    const cfg = releasesConfig();
    if (!cfg) throw new Error('Release downloads are not configured (RELEASES_S3_BUCKET)');
    client ??= new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint ?? undefined,
        forcePathStyle: cfg.forcePathStyle,
        // Only the checksums S3 itself requires. The SDK's newer defaults add
        // checksum headers that some S3-compatible stores reject.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 3,
        // A slow store shouldn't hold a page for long.
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 },
    });
    return client;
}

/* ---- Cache ---------------------------------------------------------------- */

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

/** One request per key per TTL, shared by concurrent callers; failures are retried next time. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { expires: now + releasesConfig()!.listingTtl * 1000, value });
    value.catch(() => {
        if (cache.get(key)?.value === value) cache.delete(key);
    });
    if (cache.size > 2_000) {
        for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    }
    return value;
}

/* ---- Reading the bucket ---------------------------------------------------- */

async function listAll(prefix: string): Promise<{ folders: string[]; objects: { key: string; size: number }[] }> {
    const cfg = releasesConfig()!;
    const folders: string[] = [];
    const objects: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
        const page: ListObjectsV2CommandOutput = await s3().send(
            new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token }),
        );
        for (const p of page.CommonPrefixes ?? []) if (p.Prefix) folders.push(p.Prefix.slice(prefix.length).replace(/\/$/, ''));
        for (const o of page.Contents ?? []) if (o.Key) objects.push({ key: o.Key, size: o.Size ?? 0 });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return { folders, objects };
}

/** A small text object, or null if it isn't there. */
async function readSmall(key: string): Promise<string | null> {
    const cfg = releasesConfig()!;
    try {
        const res = await s3().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        if ((res.ContentLength ?? 0) > MAX_SMALL_OBJECT) {
            (res.Body as { destroy?: () => void } | undefined)?.destroy?.();
            return null;
        }
        return (await res.Body?.transformToString('utf-8')) ?? null;
    } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
        throw err;
    }
}

/** A product's versions, newest first, and which is the latest. */
export function productReleases(product: ProductId): Promise<ProductReleases> {
    const prefix = RELEASE_PREFIX[product];
    return cached(`versions:${prefix}`, async () => {
        const [{ folders }, latestText] = await Promise.all([listAll(`${prefix}/`), readSmall(`${prefix}/latest.txt`)]);
        const names = sortVersions(folders.filter(isVersion));
        const named = latestText?.trim() ?? '';
        const latest = names.includes(named) && !isPrerelease(named) ? named : (names.find((v) => !isPrerelease(v)) ?? null);
        return {
            product,
            prefix,
            latest,
            versions: names.map((version) => ({ version, prerelease: isPrerelease(version), latest: version === latest })),
        };
    });
}

/** A version's files, in the order the page lists them, with their SHA-256 from SHA256SUMS. Empty if the version isn't there. */
export function versionFiles(product: ProductId, version: string): Promise<ReleaseFile[]> {
    const prefix = RELEASE_PREFIX[product];
    if (!isVersion(version)) return Promise.resolve([]);
    return cached(`files:${prefix}/${version}`, async () => {
        const folder = `${prefix}/${version}/`;
        const { objects } = await listAll(folder);
        const files = objects.map((o) => ({ name: o.key.slice(folder.length), size: o.size })).filter((f) => isFileName(f.name));
        const sums = files.some((f) => f.name === 'SHA256SUMS') ? parseSha256Sums((await readSmall(`${folder}SHA256SUMS`)) ?? '') : new Map<string, string>();
        return sortFiles(
            prefix,
            version,
            files.map((f) => ({ ...f, sha256: sums.get(f.name) ?? null })),
        );
    });
}

/** The file, if it is in that version's listing. */
export async function findFile(product: ProductId, version: string, file: string): Promise<ReleaseFile | null> {
    if (!isVersion(version) || !isFileName(file)) return null;
    return (await versionFiles(product, version)).find((f) => f.name === file) ?? null;
}

/** Runs fn over items, at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

/* ---- Download links ------------------------------------------------------------ */

/**
 * A presigned GET for one release file, good for RELEASES_URL_TTL seconds,
 * that makes the browser save it under its own name. Check entitlement and
 * that the file is listed first: this signs whatever it is given.
 */
export function presignedUrl(product: ProductId, version: string, file: string): Promise<string> {
    const cfg = releasesConfig();
    if (!cfg) throw new Error('Release downloads are not configured (RELEASES_S3_BUCKET)');
    const command = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: `${RELEASE_PREFIX[product]}/${version}/${file}`,
        ResponseContentDisposition: `attachment; filename="${file}"`,
    });
    return getSignedUrl(s3(), command, { expiresIn: cfg.urlTtl });
}

/** Records release.downloaded against the account, as license.downloaded is. */
export function recordDownload(actor: Account, product: ProductId, version: string, file: string): void {
    audit({
        actor: actor.id,
        account: actor.id,
        action: 'release.downloaded',
        detail: `${product} ${version}: ${file}`,
        target: { type: 'release', id: `${RELEASE_PREFIX[product]}/${version}/${file}`, name: file },
        details: { product, version, file },
    });
}

/** Per account, generous: a whole version is five or six files. */
export const DOWNLOAD_LIMIT = 120;
const DOWNLOAD_WINDOW_MINUTES = 60;

/** True when the account has asked for too many links this hour; recorded as auth.lockout (collapsed). */
export function downloadLimited(account: Account): boolean {
    if (allow(`release-download:${account.id}`, DOWNLOAD_LIMIT, DOWNLOAD_WINDOW_MINUTES * 60_000)) return false;
    recordLockout({
        bucket: 'release-download',
        attempted: account.email,
        account: account.id,
        reason: `rate limited: more than ${DOWNLOAD_LIMIT} release downloads in ${DOWNLOAD_WINDOW_MINUTES} minutes`,
    });
    return true;
}

/* ---- Tests ------------------------------------------------------------------------ */

/** Tests: use this client (one whose `send` is mocked, say), or null to build one from the config again. */
export function setS3ClientForTests(c: S3Client | null): void {
    client = c;
}

export function resetReleasesForTests(): void {
    cache.clear();
    client = null;
}
