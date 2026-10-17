package com.enssolutions.license;

import com.enssolutions.license.LicenseVerifier.Algorithm;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Provider;
import java.security.Security;
import java.security.Signature;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Checks the license fixtures on whatever Java runtime and security providers it is started
 * with, and first confirms that runtime is in the FIPS configuration it is said to be in. CI runs
 * it on Red Hat's OpenJDK in FIPS mode (the UBI 9 image the applications ship on) and on
 * BouncyCastle FIPS in approved-only mode: job {@code licensing-fips} in .github/workflows/ci.yml.
 *
 * <p>Not a JUnit test: it needs nothing but the library, so it runs on a bare JRE.
 *
 * <pre>
 * java -cp target/classes:target/test-classes com.enssolutions.license.FipsCheck &lt;fixtures dir&gt; &lt;mode&gt;
 *   mode: redhat-fips       the first provider must be SunPKCS11-NSS-FIPS
 *         bc-fips-approved  the first provider must be BCFIPS, in approved-only mode
 *         any               no requirement (to compare with an ordinary runtime)
 * </pre>
 *
 * Whatever the runtime: dual-signed and P-256-only licenses must verify, through the ECDSA P-256
 * signature when there is no Ed25519, a tampered P-256 file must be refused, and an application's
 * {@link LicenseManager} must come up licensed. Ed25519-only licenses must verify when the runtime
 * has Ed25519 and otherwise be refused with {@code UNSUPPORTED_ALGORITHM}. Exits 1 if anything
 * else happens.
 */
public final class FipsCheck {
    private static final List<String> failures = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("Usage: FipsCheck <fixtures dir> <redhat-fips|bc-fips-approved|any>");
            System.exit(2);
        }
        Path fixtures = Path.of(args[0]);
        String mode = args[1];

        System.out.println("Java " + System.getProperty("java.runtime.version") + " (" + System.getProperty("java.vendor") + ")");
        Provider[] providers = Security.getProviders();
        for (Provider p : providers) System.out.println("  provider " + p.getName() + " " + p.getVersionStr());

        switch (mode) {
            case "redhat-fips" -> require(providers[0].getName().equals("SunPKCS11-NSS-FIPS"),
                    "Red Hat OpenJDK FIPS mode is on (first provider SunPKCS11-NSS-FIPS)");
            case "bc-fips-approved" -> {
                require(providers[0].getName().equals("BCFIPS"), "BouncyCastle FIPS is the first provider");
                Object approvedOnly = Class.forName("org.bouncycastle.crypto.CryptoServicesRegistrar")
                        .getMethod("isInApprovedOnlyMode").invoke(null);
                require(Boolean.TRUE.equals(approvedOnly), "BouncyCastle FIPS is in approved-only mode");
            }
            case "any" -> { }
            default -> throw new IllegalArgumentException("Unknown mode " + mode);
        }

        String[] ed = Files.readString(fixtures.resolve("test-public-key.txt")).trim().split(" ");
        String[] ec = Files.readString(fixtures.resolve("test-public-key-p256.txt")).trim().split(" ");
        LicenseVerifier verifier = LicenseVerifier.trusting(ed[1], ec[1]);
        boolean ed25519 = verifier.isSupported(Algorithm.ED25519);
        System.out.println("Ed25519 available: " + ed25519);
        require(verifier.isSupported(Algorithm.ECDSA_P256), "ECDSA P-256 is available");
        System.out.println("SHA256withECDSA from " + Signature.getInstance("SHA256withECDSA").getProvider().getName());

        accepted(verifier, fixtures, "dual-signed.lic", ed25519 ? ed[0] : ec[0]);
        accepted(verifier, fixtures, "p256-only.lic", ec[0]);
        refused(verifier, fixtures, "tampered-p256.lic", LicenseException.Reason.BAD_SIGNATURE);
        for (String name : new String[] {"subscription.lic", "evaluation-bound.lic", "perpetual.lic"}) {
            if (ed25519) {
                accepted(verifier, fixtures, name, ed[0]);
            } else {
                refused(verifier, fixtures, name, LicenseException.Reason.UNSUPPORTED_ALGORITHM);
            }
        }
        refused(verifier, fixtures, "tampered.lic",
                ed25519 ? LicenseException.Reason.BAD_SIGNATURE : LicenseException.Reason.UNSUPPORTED_ALGORITHM);

        // What an application does with it: install the dual-signed file and come up licensed.
        Path dir = Files.createTempDirectory("ens-license-fips");
        LicenseManager manager = new LicenseManager("certalert", verifier, dir.resolve("certalert.lic"), dir.resolve("state"),
                Optional.empty(), Clock.fixed(Instant.parse("2027-01-01T00:00:00Z"), ZoneOffset.UTC));
        LicenseCheck check = manager.install(Files.readString(fixtures.resolve("dual-signed.lic")));
        require(check.state() == LicenseState.VALID && manager.current().mode() == LicenseState.Mode.FULL,
                "LicenseManager installs dual-signed.lic and is fully licensed (" + check.state() + ")");

        if (!failures.isEmpty()) {
            System.out.println("FAILED: " + String.join("; ", failures));
            System.exit(1);
        }
        System.out.println("All license checks passed.");
    }

    private static void accepted(LicenseVerifier v, Path fixtures, String name, String keyId) {
        try {
            EnsLicense l = v.verify(Files.readString(fixtures.resolve(name)));
            require(l.keyId().equals(keyId), name + " is accepted through key " + keyId + " (got " + l.keyId() + ")");
        } catch (Exception e) {
            require(false, name + " is accepted (" + e + ")");
        }
    }

    private static void refused(LicenseVerifier v, Path fixtures, String name, LicenseException.Reason reason) {
        try {
            v.verify(Files.readString(fixtures.resolve(name)));
            require(false, name + " is refused (" + reason + "), but it was accepted");
        } catch (LicenseException e) {
            require(e.reason() == reason, name + " is refused, " + reason + " (got " + e.reason() + ": " + e.getMessage() + ")");
        } catch (Exception e) {
            require(false, name + " is refused, " + reason + " (" + e + ")");
        }
    }

    private static void require(boolean ok, String what) {
        System.out.println((ok ? "  ok    " : "  FAIL  ") + what);
        if (!ok) failures.add(what);
    }

    private FipsCheck() {}
}
