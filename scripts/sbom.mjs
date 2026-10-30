#!/usr/bin/env node
/*
 * Writes the licensing portal's own software bill of materials, in SPDX
 * JSON, from the installed dependency tree: `npm sbom --sbom-format spdx
 * --omit dev`, into compliance/sbom/generated/ens-products-page.spdx.json.
 *
 * `npm run build` runs this before `astro build`, so the file exists when
 * the compliance documentation pack is bundled into the server (the SBOM
 * artifact in the manifest names it). The directory is gitignored except
 * for its .gitkeep: the file is a build output, never committed.
 *
 * Needs node_modules installed (npm reads the tree, not the registry) and a
 * version in package.json (npm refuses to make a package URL without one).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'compliance', 'sbom', 'generated', 'ens-products-page.spdx.json');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sbom = execFileSync(npm, ['sbom', '--sbom-format', 'spdx', '--omit', 'dev'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
});

// Parse it, so a broken document never reaches the pack, and write it back compact-but-readable.
const doc = JSON.parse(sbom);
if (doc.spdxVersion !== 'SPDX-2.3' || !Array.isArray(doc.packages)) {
    throw new Error('npm sbom did not produce an SPDX 2.3 document');
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.error(`sbom: ${doc.packages.length} packages written to ${out.slice(root.length + 1)}`);
