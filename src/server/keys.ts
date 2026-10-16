/*
 * The license signing key.
 *
 * Production deployments pass the Ed25519 private key in LICENSE_SIGNING_KEY
 * or LICENSE_SIGNING_KEY_FILE (generate one with `npm run license -- keygen`).
 * With neither set, a key is generated on first start and kept in DATA_DIR,
 * with a warning: licenses signed by it are only as safe as that directory.
 *
 * The key never leaves the service. Its public half is published at
 * /api/licensing/keys and is what the applications embed.
 */

import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyIdFor, signingKeyFromPem, type SigningKey } from '../lib/licensing/license';
import { config } from './config';

let signing: SigningKey | null = null;

export function generateSigningKeyPem(): string {
    const { privateKey } = generateKeyPairSync('ed25519');
    return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/**
 * A PEM, or the same key on one line as base64 PKCS#8 (what `keygen` prints
 * for .env files, which can't hold a multi-line value).
 */
export function asPem(value: string): string {
    const v = value.trim();
    if (v.includes('-----BEGIN')) return v;
    const body = v.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
    return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

export function signingKey(): SigningKey {
    if (signing) {
        return signing;
    }
    const c = config();
    let pem = c.signingKeyPem;
    if (!pem && c.signingKeyFile) {
        pem = readFileSync(c.signingKeyFile, 'utf8');
    }
    if (!pem) {
        const path = resolve(c.dataDir, 'license-signing-key.pem');
        if (!existsSync(path)) {
            mkdirSync(c.dataDir, { recursive: true });
            writeFileSync(path, generateSigningKeyPem(), { mode: 0o600 });
            console.warn(
                `licensing: no LICENSE_SIGNING_KEY set; generated one at ${path}. ` +
                    'Back it up: licenses signed with it stop verifying if it is lost.',
            );
        }
        pem = readFileSync(path, 'utf8');
    }
    signing = signingKeyFromPem(asPem(pem));
    return signing;
}

/** Every key a license may be signed with: the current one and any retired ones still trusted. */
export function trustedKeys(): Map<string, KeyObject> {
    const keys = new Map<string, KeyObject>();
    const current = signingKey();
    keys.set(current.id, current.publicKey);
    for (const b64 of config().trustedKeys) {
        const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
        keys.set(keyIdFor(key), key);
    }
    return keys;
}

export function resetKeysForTests(): void {
    signing = null;
}
