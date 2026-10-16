package com.enssolutions.certalert.licensing;

/**
 * The ENS Solutions license signing public keys this build trusts, copied
 * from https://products.ens-solutions.com/api/licensing/keys (or
 * `npm run license -- public-key` on the signing key). Built in, never read
 * from configuration: a key an operator could change would let anyone sign
 * their own license. Add a new key here before ENS starts signing with it.
 */
final class EnsKeys {
    static final String[] PUBLIC_KEYS = {
        // "MCowBQYDK2VwAyEA...", // key id 0123456789abcdef
    };

    private EnsKeys() {}
}
