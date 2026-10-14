/*
 * The public keys license files are signed with, for building them into the
 * applications. Rotation: add the new key to LICENSE_SIGNING_KEY, list the
 * old one in LICENSE_TRUSTED_KEYS, ship applications that embed both.
 */
import type { APIRoute } from 'astro';
import { keyIdFor, publicKeyBase64 } from '../../../lib/licensing/license';
import { signingKey, trustedKeys } from '../../../server/keys';

export const prerender = false;

export const GET: APIRoute = () => {
    const current = signingKey().id;
    const keys = [...trustedKeys().values()].map((k) => ({
        id: keyIdFor(k),
        algorithm: 'Ed25519',
        format: 'spki-der-base64',
        publicKey: publicKeyBase64(k),
        current: keyIdFor(k) === current,
    }));
    return Response.json({ keys });
};
