package com.enssolutions.certalert.licensing;

/**
 * The ENS Solutions license signing public keys this build trusts, copied
 * from https://products.ens-solutions.com/api/licensing/keys (or
 * `npm run license -- public-key` on the signing key). Built in, never read
 * from configuration: a key an operator could change would let anyone sign
 * their own license. Add a new key here before ENS starts signing with it.
 *
 * List both current keys: the Ed25519 key, and the ECDSA P-256 key that a
 * Java runtime in FIPS mode (which has no Ed25519) checks licenses with.
 */
final class EnsKeys {
    static final String[] PUBLIC_KEYS = {
        // "MCowBQYDK2VwAyEA...",                     // Ed25519, key id 0123456789abcdef
        // "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...", // ECDSA P-256, key id fedcba9876543210
    };

    private EnsKeys() {}
}
