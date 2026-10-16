#!/usr/bin/env node
/*
 * License key and file tools, for the people who run the licensing service.
 *
 *   npm run license -- keygen              New Ed25519 signing key: the private
 *                                          PEM for LICENSE_SIGNING_KEY, and the
 *                                          public key the applications embed
 *   npm run license -- public-key <file>   Key id and public key of a private key
 *                                          (PEM, or one-line base64 PKCS#8)
 *   npm run license -- inspect <file.lic>  Decode a license file, without checking it
 *   npm run license -- verify <file.lic> <public-key-base64>...
 *                                          Check a license file's signature
 *
 * Plain JavaScript on node:crypto, so it runs anywhere Node 22 does, with no
 * build step. The format is described in src/lib/licensing/license.ts.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);

const keyId = (pub) => createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
const pubB64 = (pub) => pub.export({ type: 'spki', format: 'der' }).toString('base64');

function token(text) {
    const m = text.match(/-----BEGIN ENS LICENSE-----([\s\S]*?)-----END ENS LICENSE-----/);
    return (m ? m[1] : text).replace(/\s+/g, '');
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

switch (command) {
    case 'keygen': {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim());
        console.error(`\nKey id:     ${keyId(publicKey)}\nPublic key: ${pubB64(publicKey)}`);
        console.error(`\nThe same private key on one line, for an .env file:\nLICENSE_SIGNING_KEY=${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`);
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
        console.log(`${keyId(pub)} ${pubB64(pub)}`);
        break;
    }
    case 'inspect': {
        if (!args[0]) fail('Usage: license inspect <file.lic>');
        const [kid, payload] = token(readFileSync(args[0], 'utf8')).split('.');
        console.log(JSON.stringify({ keyId: kid, ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) }, null, 2));
        break;
    }
    case 'verify': {
        if (!args[0] || args.length < 2) fail('Usage: license verify <file.lic> <public-key-base64>...');
        const [kid, payload, signature] = token(readFileSync(args[0], 'utf8')).split('.');
        const key = args
            .slice(1)
            .map((b64) => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' }))
            .find((k) => keyId(k) === kid);
        if (!key) fail(`Signed with key ${kid}, which is not one of those given`);
        const ok = verify(null, Buffer.from(`${kid}.${payload}`, 'ascii'), key, Buffer.from(signature, 'base64url'));
        if (!ok) fail('INVALID: the signature does not match');
        const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        console.log(`VALID: ${p.product} ${p.edition} for ${p.licensee.organization || p.licensee.name}, ${p.limit.quantity} ${p.limit.unit}, expires ${p.expiresAt ?? 'never'}`);
        break;
    }
    default:
        fail('Commands: keygen, public-key <pem>, inspect <file>, verify <file> <public-key>...');
}
