/*
 * Release downloads: the pure part. Version names and their order, the
 * SHA256SUMS format, which file names may be served, and the order the
 * downloads page lists a version's files in. No S3, no database: the server
 * side is src/server/releases.ts.
 *
 * Each application's CI publishes to
 *
 *   s3://<bucket>/<prefix>/<version>/<file>
 *   s3://<bucket>/<prefix>/latest.txt        newest final version, never a pre-release
 *
 * where <version> is X.Y.Z, or X.Y.Z-suffix for a pre-release.
 */

import type { ProductId } from '../data/products';

/**
 * Each product's folder in the bucket. Not the ProductId: the folders are
 * named after the application repositories, as their CI writes them. The
 * main package is `<prefix>-<version>.tar.gz`.
 */
export const RELEASE_PREFIX: Record<ProductId, string> = {
    certalert: 'cert-alert',
    'directory-portal': 'directory-services-portal',
    readyroom: 'readyroom',
    'mfa-portal': 'rsa-operations-portal',
};

/** X.Y.Z, or X.Y.Z-suffix (dot-separated identifiers) for a pre-release. */
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** A file name the portal will serve: one path segment, nothing odd. */
export const FILE_RE = /^[A-Za-z0-9._-]+$/;

export function isVersion(v: string): boolean {
    return v.length <= 64 && VERSION_RE.test(v);
}

export function isPrerelease(v: string): boolean {
    return VERSION_RE.exec(v)?.[4] !== undefined;
}

/** A file name that may be looked up in a listing. Existence is checked separately. */
export function isFileName(name: string): boolean {
    return name.length <= 200 && FILE_RE.test(name) && !name.includes('..');
}

/**
 * Semantic-version precedence: numeric major, minor, patch; a pre-release
 * comes before its final version; pre-release identifiers compare
 * numerically when both are numbers, numbers before words, words in ASCII
 * order, and a shorter list first when one is a prefix of the other.
 */
export function compareVersions(a: string, b: string): number {
    const ma = VERSION_RE.exec(a);
    const mb = VERSION_RE.exec(b);
    if (!ma || !mb) return a < b ? -1 : a > b ? 1 : 0;
    for (let i = 1; i <= 3; i++) {
        const d = Number(ma[i]) - Number(mb[i]);
        if (d !== 0) return Math.sign(d);
    }
    const pa = ma[4];
    const pb = mb[4];
    if (pa === undefined || pb === undefined) {
        return pa === pb ? 0 : pa === undefined ? 1 : -1;
    }
    const ia = pa.split('.');
    const ib = pb.split('.');
    for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
        const x = ia[i]!;
        const y = ib[i]!;
        const nx = /^\d+$/.test(x);
        const ny = /^\d+$/.test(y);
        if (nx && ny) {
            const d = Number(x) - Number(y);
            if (d !== 0) return Math.sign(d);
        } else if (nx !== ny) {
            return nx ? -1 : 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return Math.sign(ia.length - ib.length);
}

/** Newest first. */
export function sortVersions(versions: Iterable<string>): string[] {
    return [...versions].sort((a, b) => compareVersions(b, a));
}

/**
 * SHA256SUMS as sha256sum writes it (`<hex>  <name>`, or `<hex> *<name>` in
 * binary mode), or the BSD form (`SHA256 (<name>) = <hex>`). Names are
 * reduced to their last path segment; anything else is skipped. Returns
 * name -> lower-case hex.
 */
export function parseSha256Sums(text: string): Map<string, string> {
    const sums = new Map<string, string>();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const gnu = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
        const bsd = gnu ? null : /^SHA256 \((.+)\) = ([0-9a-fA-F]{64})$/.exec(line);
        const [hex, path] = gnu ? [gnu[1]!, gnu[2]!] : bsd ? [bsd[2]!, bsd[1]!] : [null, null];
        if (!hex || !path) continue;
        const name = path.replace(/^.*\//, '');
        if (isFileName(name)) sums.set(name, hex.toLowerCase());
    }
    return sums;
}

/**
 * Where a file sorts within its version: the package first (the main one,
 * then variants such as `-native`), then the Helm chart, the SBOMs,
 * SHA256SUMS and its signature, then anything else.
 */
export function fileRank(prefix: string, version: string, name: string): number {
    if (name === `${prefix}-${version}.tar.gz`) return 0;
    if (name.startsWith(`${prefix}-${version}-`) && name.endsWith('.tar.gz')) return 1;
    if (name.endsWith('.tgz')) return 2;
    if (name.startsWith('sbom-') && name.endsWith('.spdx.json')) return 3;
    if (name === 'SHA256SUMS') return 4;
    if (name === 'SHA256SUMS.asc') return 5;
    return 6;
}

export function sortFiles<T extends { name: string }>(prefix: string, version: string, files: T[]): T[] {
    return [...files].sort((a, b) => fileRank(prefix, version, a.name) - fileRank(prefix, version, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 1.2 GB, 350 MB, 4.1 KB: decimal units, as the size a browser shows. */
export function formatBytes(n: number): string {
    if (n < 1000) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n;
    let u = -1;
    while (v >= 1000 && u < units.length - 1) {
        v /= 1000;
        u++;
    }
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}
