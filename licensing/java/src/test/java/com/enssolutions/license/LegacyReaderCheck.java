package com.enssolutions.license;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

/**
 * Checks that applications already in the field read the license files the portal issues now.
 * CI compiles this against ens-license 1.0.0, the library from before ECDSA (git
 * 4313f697e49b51cc3585f49dae5a6d7dabe4ebad), so it uses only what 1.0.0 has, and trusts only the
 * Ed25519 test key, as those applications' EnsKeys do: job {@code java-verifier} in
 * .github/workflows/ci.yml.
 *
 * <pre>
 * java -cp &lt;1.0.0 classes&gt;:&lt;this class&gt; com.enssolutions.license.LegacyReaderCheck &lt;fixtures dir&gt;
 * </pre>
 */
public final class LegacyReaderCheck {
    public static void main(String[] args) throws Exception {
        Path fixtures = Path.of(args[0]);
        String[] ed = Files.readString(fixtures.resolve("test-public-key.txt")).trim().split(" ");
        LicenseVerifier verifier = LicenseVerifier.trusting(ed[1]);
        boolean ok = true;

        for (String name : new String[] {"subscription.lic", "dual-signed.lic"}) {
            EnsLicense l = verifier.verify(Files.readString(fixtures.resolve(name)));
            boolean good = l.keyId().equals(ed[0]);
            System.out.println((good ? "  ok    " : "  FAIL  ") + name + " verifies through the Ed25519 key (" + l.id() + ")");
            ok &= good;
        }

        // ENS_LICENSE given the whole dual-signed file, and an upload of it, as an application does.
        Path dir = Files.createTempDirectory("ens-license-legacy");
        Clock clock = Clock.fixed(Instant.parse("2027-01-01T00:00:00Z"), ZoneOffset.UTC);
        String file = Files.readString(fixtures.resolve("dual-signed.lic"));
        LicenseManager env = new LicenseManager("certalert", verifier, dir.resolve("env.lic"), dir.resolve("env-state"),
                Optional.empty(), clock, Optional.of(file));
        LicenseManager upload = new LicenseManager("certalert", verifier, dir.resolve("up.lic"), dir.resolve("up-state"),
                Optional.empty(), clock);
        boolean viaEnv = env.current().state() == LicenseState.VALID;
        boolean viaUpload = upload.install(file).state() == LicenseState.VALID;
        System.out.println((viaEnv ? "  ok    " : "  FAIL  ") + "ENS_LICENSE with dual-signed.lic is installed and VALID");
        System.out.println((viaUpload ? "  ok    " : "  FAIL  ") + "uploading dual-signed.lic is VALID");
        ok &= viaEnv && viaUpload;

        if (!ok) System.exit(1);
        System.out.println("ens-license 1.0.0 reads the dual-signed license.");
    }

    private LegacyReaderCheck() {}
}
