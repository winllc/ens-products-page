/*
 * Passwords and one-time tokens.
 *
 * Passwords are hashed with scrypt (N=2^15, r=8, p=1, 64-byte key) and a
 * random salt, stored as "scrypt$N$r$p$salt$hash". Session and email tokens
 * are random 32-byte values handed to the user; only their SHA-256 is stored,
 * so a copy of the database does not let anyone sign in.
 */

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
    new Promise<Buffer>((resolve, reject) =>
        scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
    );

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) {
        return false;
    }
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: MAXMEM,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to compare against when the account doesn't exist, so timing doesn't reveal it. */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
    dummy ??= hashPassword(randomBytes(16).toString('hex'));
    return dummy;
}

export function newToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function newId(prefix: string): string {
    return `${prefix}_${randomBytes(10).toString('hex')}`;
}
