#!/usr/bin/env node
/*
 * License key and file tools, for the people who run the licensing service.
 *
 *   npm run license -- keygen [--alg ed25519|p256]
 *                                          New signing key: the private PEM for
 *                                          LICENSE_SIGNING_KEY (Ed25519, the
 *                                          default) or LICENSE_SIGNING_KEY_P256
 *                                          (ECDSA P-256), and the public key the
 *                                          applications embed
 *   npm run license -- public-key <file>   Key id and public key of a private key
 *                                          (PEM, or one-line base64 PKCS#8)
 *   npm run license -- inspect <file.lic>  Decode a license file, without checking it
 *   npm run license -- verify <file.lic> <public-key-base64>... [--alg ed25519|p256]
 *                                          Check every signature in a license
 *                                          file made by one of the keys given.
 *                                          --alg p256 checks it the way a Java
 *                                          runtime in FIPS mode will: without
 *                                          Ed25519
 *
 * Plain JavaScript on node:crypto, so it runs anywhere Node 22 does, with no
 * build step. The format is described in src/lib/licensing/license.ts.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const command = argv[0];

/** Pulls `--alg <value>` (or `--alg=<value>`) out of the arguments. */
function option(name) {
    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === `--${name}`) {
            const [, value] = argv.splice(i, 2);
            if (value === undefined) fail(`--${name} needs a value`);
            return value;
        }
        if (argv[i].startsWith(`--${name}=`)) return argv.splice(i, 1)[0].slice(name.length + 3);
    }
    return undefined;
}
const ALGS = { ed25519: 'Ed25519', p256: 'ECDSA P-256' };
const alg = option('alg');
if (alg !== undefined && !(alg in ALGS)) fail(`--alg is ed25519 or p256, not ${alg}`);
const args = argv.slice(1);

const keyId = (pub) => createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
const pubB64 = (pub) => pub.export({ type: 'spki', format: 'der' }).toString('base64');

/** ed25519, p256, or null: the key, not the file, decides the algorithm. */
function algorithmOf(key) {
    if (key.asymmetricKeyType === 'ed25519') return 'ed25519';
    if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') return 'p256';
    return null;
}

/** Every armored block's token, or the text as one bare token. */
function tokens(text) {
    const found = [...text.matchAll(/-----BEGIN ENS LICENSE-----([\s\S]*?)-----END ENS LICENSE-----/g)].map((m) => m[1].replace(/\s+/g, ''));
    return found.length ? found : [text.replace(/\s+/g, '')];
}

function parts(token) {
    const p = token.split('.');
    if (p.length !== 3 || p.some((s) => !/^[A-Za-z0-9_-]+$/.test(s))) fail('Not an ENS license');
    return { kid: p[0], payload: p[1], signature: p[2] };
}

/** What a signature looks like, for inspect, which has no keys: 64 raw bytes or a DER SEQUENCE. */
function looksLike(signature) {
    const sig = Buffer.from(signature, 'base64url');
    if (sig.length === 64) return 'Ed25519';
    if (sig[0] === 0x30 && sig.length >= 8 && sig.length <= 72) return 'ECDSA P-256';
    return 'unknown';
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

switch (command) {
    case 'keygen': {
        const p256 = alg === 'p256';
        const { privateKey, publicKey } = p256 ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('ed25519');
        const variable = p256 ? 'LICENSE_SIGNING_KEY_P256' : 'LICENSE_SIGNING_KEY';
        console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim());
        console.error(`\nAlgorithm:  ${p256 ? ALGS.p256 : ALGS.ed25519}\nKey id:     ${keyId(publicKey)}\nPublic key: ${pubB64(publicKey)}`);
        console.error(`\nThe same private key on one line, for an .env file:\n${variable}=${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`);
        console.error('\nThe PEM above (on stdout) is the private key: store it as a secret and never commit it.');
        break;
    }
    case 'public-key': {
        if (!args[0]) fail('Usage: license public-key <private-key.pem>');
        const text = readFileSync(args[0], 'utf8').trim();
        const priv = text.includes('-----BEGIN')
            ? createPrivateKey(text)
            : createPrivateKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'pkcs8' });
        const pub = createPublicKey(priv);
        const a = algorithmOf(pub);
        if (!a) fail(`Not a license signing key: ${pub.asymmetricKeyType}`);
        console.log(`${keyId(pub)} ${pubB64(pub)}`);
        console.error(ALGS[a]);
        break;
    }
    case 'inspect': {
        if (!args[0]) fail('Usage: license inspect <file.lic>');
        const all = tokens(readFileSync(args[0], 'utf8')).map(parts);
        const { kid, payload } = all[0];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const signatures = all.map((t) => ({ keyId: t.kid, looksLike: looksLike(t.signature), samePayload: t.payload === payload }));
        console.log(JSON.stringify({ keyId: kid, signatures, ...decoded }, null, 2));
        break;
    }
    case 'verify': {
        if (!args[0] || args.length < 2) fail('Usage: license verify <file.lic> <public-key-base64>... [--alg ed25519|p256]');
        const all = tokens(readFileSync(args[0], 'utf8')).map(parts);
        const payload = all[0].payload;
        if (all.some((t) => t.payload !== payload)) fail('INVALID: the blocks hold different licenses');
        const keys = new Map();
        for (const b64 of args.slice(1)) {
            const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
            if (!algorithmOf(key)) fail(`Not a license public key: ${key.asymmetricKeyType}`);
            keys.set(keyId(key), key);
        }
        let valid = 0;
        let invalid = 0;
        for (const t of all) {
            const key = keys.get(t.kid);
            const a = key && algorithmOf(key);
            if (!key) {
                console.log(`  key ${t.kid}: not one of those given, not checked`);
            } else if (alg && a !== alg) {
                console.log(`  key ${t.kid} (${ALGS[a]}): skipped, --alg ${alg}`);
            } else {
                const data = Buffer.from(`${t.kid}.${payload}`, 'ascii');
                const sig = Buffer.from(t.signature, 'base64url');
                const ok = a === 'ed25519' ? verify(null, data, key, sig) : verify('sha256', data, { key, dsaEncoding: 'der' }, sig);
                console.log(`  key ${t.kid} (${ALGS[a]}): ${ok ? 'signature valid' : 'SIGNATURE DOES NOT MATCH'}`);
                ok ? valid++ : invalid++;
            }
        }
        if (invalid) fail('INVALID: a signature does not match; the file was changed or damaged');
        if (!valid) fail(alg ? `INVALID: no ${ALGS[alg]} signature from the keys given` : `Signed with ${all.map((t) => t.kid).join(', ')}, none of them among the keys given`);
        const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        console.log(`VALID: ${p.product} ${p.edition} for ${p.licensee.organization || p.licensee.name}, ${p.limit.quantity} ${p.limit.unit}, expires ${p.expiresAt ?? 'never'}`);
        break;
    }
    default:
        fail('Commands: keygen [--alg ed25519|p256], public-key <pem>, inspect <file>, verify <file> <public-key>... [--alg ed25519|p256]');
}
