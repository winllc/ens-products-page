import { describe, expect, it } from 'vitest';
import { compareVersions, fileRank, formatBytes, isFileName, isPrerelease, isVersion, parseSha256Sums, sortFiles, sortVersions } from './releases';

describe('release versions', () => {
    it('accepts X.Y.Z and X.Y.Z-suffix, and nothing else', () => {
        for (const v of ['1.0.0', '10.20.30', '1.2.0-rc.1', '2.0.0-beta', '1.0.0-alpha-2.x']) expect(isVersion(v)).toBe(true);
        for (const v of ['1.0', 'v1.0.0', '1.0.0-', '1.0.0+build', '01.0.0', '1.0.0-rc..1', '../1.0.0', '1.0.0/', 'latest.txt', '', '1.0.0-rc.1\n'])
            expect(isVersion(v)).toBe(false);
    });

    it('marks a suffix as a pre-release', () => {
        expect(isPrerelease('1.2.0-rc.1')).toBe(true);
        expect(isPrerelease('1.2.0')).toBe(false);
    });

    it('sorts newest first by semantic version, not by text', () => {
        expect(sortVersions(['1.0.0', '1.10.0', '1.2.0', '1.2.0-rc.1', '1.1.0', '2.0.0-alpha', '1.2.0-rc.10', '1.2.0-rc.2', '1.2.0-beta'])).toEqual([
            '2.0.0-alpha',
            '1.10.0',
            '1.2.0',
            '1.2.0-rc.10',
            '1.2.0-rc.2',
            '1.2.0-rc.1',
            '1.2.0-beta',
            '1.1.0',
            '1.0.0',
        ]);
    });

    it('follows semver precedence for pre-release identifiers', () => {
        // semver.org, item 11: each is lower than the next.
        const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
        for (let i = 1; i < chain.length; i++) {
            expect(compareVersions(chain[i - 1]!, chain[i]!)).toBe(-1);
            expect(compareVersions(chain[i]!, chain[i - 1]!)).toBe(1);
        }
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    });
});

describe('SHA256SUMS', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const c = 'c'.repeat(64);

    it('reads sha256sum text and binary lines and the BSD form', () => {
        const sums = parseSha256Sums(
            [`${a}  cert-alert-1.0.0.tar.gz`, `${b} *cert-alert-1.0.0.tgz`, `SHA256 (sbom-cert-alert.spdx.json) = ${c}`, ''].join('\n'),
        );
        expect([...sums]).toEqual([
            ['cert-alert-1.0.0.tar.gz', a],
            ['cert-alert-1.0.0.tgz', 'b'.repeat(64)],
            ['sbom-cert-alert.spdx.json', c],
        ]);
    });

    it('keeps the last path segment, takes CRLF, and skips what it cannot read', () => {
        const sums = parseSha256Sums(
            [`${a}  ./dist/readyroom-1.0.0.tar.gz`, '# comment', 'not a checksum line', `${'a'.repeat(63)}  short.tgz`, `${c}  bad name.tgz`, `${b}  chart.tgz\r`].join(
                '\r\n',
            ),
        );
        expect([...sums.keys()]).toEqual(['readyroom-1.0.0.tar.gz', 'chart.tgz']);
    });
});

describe('release file names', () => {
    it('allows plain names only', () => {
        for (const f of ['cert-alert-1.0.0.tar.gz', 'SHA256SUMS', 'SHA256SUMS.asc', 'sbom-x.spdx.json', 'chart_1.tgz']) expect(isFileName(f)).toBe(true);
        for (const f of ['..', '../latest.txt', 'a..b', '.. ', 'a/b', 'a\\b', '%2e%2e', 'name with space', 'ünïcode', 'a;b', 'a"b', '', 'x'.repeat(201)])
            expect(isFileName(f)).toBe(false);
    });

    it('lists the package first, then the chart, SBOMs, SHA256SUMS and its signature', () => {
        const names = [
            'SHA256SUMS.asc',
            'notes.txt',
            'sbom-image.spdx.json',
            'SHA256SUMS',
            'directory-services-portal-1.0.0-native.tar.gz',
            'directory-services-portal-1.0.0.tgz',
            'sbom-chart.spdx.json',
            'directory-services-portal-1.0.0.tar.gz',
        ];
        expect(sortFiles('directory-services-portal', '1.0.0', names.map((name) => ({ name }))).map((f) => f.name)).toEqual([
            'directory-services-portal-1.0.0.tar.gz',
            'directory-services-portal-1.0.0-native.tar.gz',
            'directory-services-portal-1.0.0.tgz',
            'sbom-chart.spdx.json',
            'sbom-image.spdx.json',
            'SHA256SUMS',
            'SHA256SUMS.asc',
            'notes.txt',
        ]);
        expect(fileRank('readyroom', '1.0.0', 'readyroom-1.0.0.tar.gz')).toBe(0);
    });

    it('shows sizes the way a browser does', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(4_100)).toBe('4.1 KB');
        expect(formatBytes(350_000_000)).toBe('350 MB');
        expect(formatBytes(1_200_000_000)).toBe('1.2 GB');
    });
});
