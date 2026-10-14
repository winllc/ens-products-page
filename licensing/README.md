# Licensing: unlocking features in the applications

The site issues licenses (`/account`, `/admin`); the applications enforce
them. This directory is the application side:

```
licensing/
  java/                 ens-license: the verifier the Java applications use
    src/main/java/...   LicenseVerifier, LicenseManager, LicensePolicy, LicenseCheck
    examples/spring/    Drop-in Spring Boot wiring: interceptor, @RequiresFeature,
                        license screen controller, job guards
  fixtures/             License files signed by the site's code with a TEST key,
                        which the Java tests verify
```

## How a license gets from the site into an application

1. A customer downloads a `.lic` file from their account (an evaluation, or
   a license ENS issued against their order).
2. An administrator copies it to the server and sets `ENS_LICENSE_FILE`, or
   uploads it on the application's *Administration → License* screen.
3. The application checks the Ed25519 signature against the ENS public keys
   **built into it**, then decides what is unlocked. No network is involved,
   so this works the same on an air-gapped enclave.

## The file

```
# ENS Solutions license file
# Product:      CertAlert
# ...readable summary, ignored by every verifier...
-----BEGIN ENS LICENSE-----
<key id>.<payload base64url>.<signature base64url>
-----END ENS LICENSE-----
```

The signature is Ed25519 over the ASCII bytes `<key id>.<payload>`. The
payload is JSON (`src/lib/licensing/license.ts` has every field):

| Field | Meaning in the application |
|---|---|
| `product` | Must be this application's product id, or the file is refused. |
| `features` | `"<product>.<feature>"` ids. A feature is usable only if listed. The catalog is `src/data/licensing.ts`. |
| `limit.quantity`, `limit.unit` | Size covered: directory users, SecurID users or tracked people. |
| `notBefore`, `expiresAt`, `graceDays` | Dates. `expiresAt` is null for perpetual. |
| `maintenanceUntil` | Perpetual only: releases built after it are not covered. |
| `installationId` | If set, only the installation showing that id accepts the file. |
| `revision` | Goes up on every re-issue; an installation never goes back to a lower one. |
| `watermark` | Show the evaluation banner. |

## What the application does

| State | Mode | Behaviour |
|---|---|---|
| `VALID` | full | Everything the `features` list allows. |
| `GRACE` (expired, within `graceDays`) | full | Same, plus a renewal warning for administrators. |
| `EXPIRED` | read-only | Data visible and exportable; no changes; scheduled jobs, syncs and notifications pause. |
| `RELEASE_NOT_COVERED` (perpetual) | read-only | This build is newer than maintenance; renew or run an older release. |
| `MISSING`, `INVALID`, `WRONG_PRODUCT`, `WRONG_INSTALLATION`, `SUPERSEDED`, `NOT_YET_VALID` | unlicensed | Only sign-in and the license screen. |

Over the size limit: warn up to 10% over (`LicenseCheck.OVERAGE_TOLERANCE`),
then stop taking on more people, servers or tokens. Never remove anything.

The site's licensing page (`/licensing.html`) tells customers exactly these
rules, so keep the two in step.

## Using it from a Java application

Build and install the library (Java 21, no runtime dependencies):

```bash
cd licensing/java && mvn install
```

```xml
<dependency>
    <groupId>com.enssolutions</groupId>
    <artifactId>ens-license</artifactId>
    <version>1.0.0</version>
</dependency>
```

Then:

```java
LicenseManager licenses = LicenseManager.fromEnvironment(
        "certalert",
        LicenseVerifier.trusting(EnsKeys.PUBLIC_KEYS),   // built in, never configurable
        Optional.of(buildDate));                         // for perpetual maintenance

LicenseCheck check = licenses.current();                 // cheap; re-reads the file only when it changes
check.mode();                                            // FULL, READ_ONLY or UNLICENSED
check.isFeatureEnabled("revocation-checks");             // or "certalert.revocation-checks"
check.mayAdd(peopleRepository.count());                  // size limit
check.showEvaluationBanner();
check.showRenewalWarning();
check.message();                                         // one sentence for the license screen
licenses.installationId();                               // e.g. CA-7F3K-29QD, for binding
licenses.install(uploadedText);                          // license screen upload
```

| Environment | Default | |
|---|---|---|
| `ENS_LICENSE_FILE` | `/etc/ens/<product>.lic` | The license file. |
| `ENS_LICENSE_STATE_DIR` | `/var/lib/ens/<product>` | Installation id and highest revisions. Put it on a persistent volume. If it is lost, the installation gets a new id and bound licenses must be re-bound. |

### Spring Boot

`java/examples/spring/` is the wiring to copy into each application (it
compiles against Spring Boot 3.5 and 4.1):

- `LicensingConfiguration`: the `LicenseManager` bean, with the release date
  from `build-info`, and the interceptor registration.
- `LicenseInterceptor`: unlicensed → redirect to the license screen;
  read-only → refuse anything but GET/HEAD; `@RequiresFeature` → 403 unless
  unlocked. Puts the check in the `license` request attribute for views.
- `LicenseController`: the *Administration → License* screen: state,
  installation id, upload.
- `LicensedJobs`: `mayRun("feature")` at the top of each `@Scheduled` job,
  `mayAdd(count)` in syncs.
- `EnsKeys`: the public keys, pasted from `/api/licensing/keys`.

Feature ids per product, as the applications should check them:

| Product | Features |
|---|---|
| `certalert` | `directory-sync`, `changelog-sync`, `notifications`, `metrics`, `projects`, `revocation-checks`, `endpoint-checks`, `risky-names`, `directory-cleanup`, `classification-banners`, `multi-directory` (Enterprise) |
| `mfa-portal` | `self-service`, `trusted-agents`, `help-desk`, `shipments`, `scheduled-jobs`, `branding` |
| `readyroom` | `attendance`, `calendar`, `absence-alerts`, `metrics`, `org-chart`, `classification-banners` |
| `directory-portal` | `directory-editor`, `form-builder`, `self-service-profile`, `white-pages`, `smart-card-sign-in` |

Ship every app with all of a product's features gated from the start, even
those every license includes today: a feature that's checked can be moved to
a different tier later by changing `src/data/licensing.ts` alone.

## Keys

- **Generate**: `npm run license -- keygen`. The private key goes in the
  licensing service's `LICENSE_SIGNING_KEY` (a secret). The public key goes in
  every application's `EnsKeys`.
- **Rotate**: generate a new key, add its public half to the applications and
  release them; then switch `LICENSE_SIGNING_KEY` to the new key and list the
  old public key in `LICENSE_TRUSTED_KEYS`. Existing files keep verifying,
  because applications trust both.
- **Lost key**: files already issued keep working, but nothing new can be
  signed for applications that only trust it. Back the key up.
- The fixtures' key is derived from a published seed. Never put it in a
  shipped application.

## Online status (optional)

An application with a network route can call
`GET /api/licensing/licenses/<id>/status` to learn whether a license has been
revoked and its latest revision. It returns no customer details. Nothing
requires it; revocation is otherwise enforced by expiry.
