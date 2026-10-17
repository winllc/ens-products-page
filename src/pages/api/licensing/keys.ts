/*
 * The public keys license files are signed with, for building them into the
 * applications. Rotation: add the new key to LICENSE_SIGNING_KEY, list the
 * old one in LICENSE_TRUSTED_KEYS, ship applications that embed both. With
 * LICENSE_SIGNING_KEY_P256 set there are two current keys, Ed25519 and
 * ECDSA P-256; applications embed both.
 */
import type { APIRoute } from 'astro';
import { algorithmName, keyAlgorithm, keyIdFor, publicKeyBase64 } from '../../../lib/licensing/license';
import { signingKeys, trustedKeys } from '../../../server/keys';

export const prerender = false;

export const GET: APIRoute = () => {
    const current = new Set(signingKeys().map((k) => k.id));
    const keys = [...trustedKeys().values()].map((k) => ({
        id: keyIdFor(k),
        algorithm: algorithmName[keyAlgorithm(k)!],
        format: 'spki-der-base64',
        publicKey: publicKeyBase64(k),
        current: current.has(keyIdFor(k)),
    }));
    return Response.json({ keys });
};
