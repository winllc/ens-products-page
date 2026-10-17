/*
 * The license signing keys.
 *
 * Production deployments pass the Ed25519 private key in LICENSE_SIGNING_KEY
 * or LICENSE_SIGNING_KEY_FILE (generate one with `npm run license -- keygen`).
 * With neither set, a key is generated on first start and kept in DATA_DIR,
 * with a warning: licenses signed by it are only as safe as that directory.
 *
 * An ECDSA P-256 key in LICENSE_SIGNING_KEY_P256 or LICENSE_SIGNING_KEY_P256_FILE
 * (`npm run license -- keygen --alg p256`) is optional. When it is set, every
 * license is signed with both keys, so it also verifies on Java runtimes in
 * FIPS mode, which have no Ed25519. It is never generated.
 *
 * The keys never leave the service. Their public halves are published at
 * /api/licensing/keys and are what the applications embed.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyIdFor, publicKeyFromBase64, signingKeyFromPem, type SigningKey } from '../lib/licensing/license';
import { config } from './config';

let signing: SigningKey | null = null;
let signingP256: SigningKey | null | undefined;

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

/** The Ed25519 key. Every license is signed with it. */
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
    try {
        signing = signingKeyFromPem(asPem(pem), 'Ed25519');
    } catch (err) {
        throw new Error(`LICENSE_SIGNING_KEY: ${(err as Error).message}`);
    }
    return signing;
}

/** The ECDSA P-256 key, if one is configured. */
export function signingKeyP256(): SigningKey | null {
    if (signingP256 !== undefined) {
        return signingP256;
    }
    const c = config();
    const pem = c.signingKeyP256Pem ?? (c.signingKeyP256File ? readFileSync(c.signingKeyP256File, 'utf8') : null);
    try {
        signingP256 = pem ? signingKeyFromPem(asPem(pem), 'ECDSA-P256') : null;
    } catch (err) {
        throw new Error(`LICENSE_SIGNING_KEY_P256: ${(err as Error).message}`);
    }
    return signingP256;
}

/** The keys new licenses are signed with: Ed25519, then P-256 if configured. */
export function signingKeys(): SigningKey[] {
    const p256 = signingKeyP256();
    return p256 ? [signingKey(), p256] : [signingKey()];
}

/** Every key a license may be signed with: the current ones and any retired ones still trusted. */
export function trustedKeys(): Map<string, KeyObject> {
    const keys = new Map<string, KeyObject>();
    for (const current of signingKeys()) {
        keys.set(current.id, current.publicKey);
    }
    for (const b64 of config().trustedKeys) {
        let key: KeyObject;
        try {
            key = publicKeyFromBase64(b64);
        } catch (err) {
            throw new Error(`LICENSE_TRUSTED_KEYS: ${(err as Error).message}`);
        }
        keys.set(keyIdFor(key), key);
    }
    return keys;
}

export function resetKeysForTests(): void {
    signing = null;
    signingP256 = undefined;
}
