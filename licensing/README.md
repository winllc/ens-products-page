# Licensing: unlocking features in the applications

The site issues licenses (`/account`, `/admin`); the applications enforce
them. This directory is the application side:

```
licensing/
  java/                 ens-license: the verifier the Java applications use
    src/main/java/...   LicenseVerifier, LicenseManager, LicensePolicy, LicenseCheck
    examples/spring/    Drop-in Spring Boot wiring: interceptor, @RequiresFeature,
                        license screen controller, job guards
  fixtures/             License files signed by the site's code with TEST keys,
                        which the Java tests verify
```

## How a license gets from the site into an application

1. A customer downloads a `.lic` file from their account (an evaluation, or
   a license ENS issued against their order).
2. An administrator copies it to the server and sets `ENS_LICENSE_FILE`,
   passes it in `ENS_LICENSE`, or uploads it on the application's
   *Administration → License* screen.
3. The application checks the signature against the ENS public keys **built
   into it** (Ed25519, or ECDSA P-256 when its Java runtime is in FIPS mode:
   see [FIPS 140-3](#fips-140-3)), then decides what is unlocked. No network
   is involved, so this works the same on an air-gapped enclave.

## The file

```
# ENS Solutions license file
# Product:      CertAlert
# ...readable summary, ignored by every verifier...
-----BEGIN ENS LICENSE-----
<key id>.<payload base64url>.<signature base64url>
-----END ENS LICENSE-----
-----BEGIN ENS LICENSE-----                  (when the portal has a P-256 key)
<P-256 key id>.<the same payload>.<signature>
-----END ENS LICENSE-----
```

Each signature is over the ASCII bytes `<key id>.<payload>`. The key id is
the first 16 hex digits of the SHA-256 of the signing key's public SPKI DER,
which names the algorithm, so the id identifies the algorithm as well as the
key. The **trusted key** decides how its block is checked, never the file:

| Key | Signature |
|---|---|
| Ed25519 | 64 raw bytes (RFC 8032) |
| ECDSA P-256 | SHA-256, DER-encoded (`SHA256withECDSA` in Java, Node's default) |

A file carries one block per signing key, all over the same payload, Ed25519
first. A verifier accepts the file if any block verifies with a key it trusts
and an algorithm its runtime has, trying Ed25519 first; blocks for different
payloads make the file invalid. Libraries before 1.1.0, which the
applications in the field run, read only the first block, so they accept a
dual-signed file through its Ed25519 signature (CI checks this against the
1.0.0 code). From 1.1.0 the Java library refuses text longer than 64 KiB
(`LicenseVerifier.MAX_FILE_CHARS`; a dual-signed file is about 3 kB) and finds
the blocks in one pass, so a crafted upload can't make parsing slow. The payload is JSON (`src/lib/licensing/license.ts` has every
field):

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

Build and install the library (Java 17 or later, no runtime dependencies):

```bash
cd licensing/java && mvn install
```

```xml
<dependency>
    <groupId>com.enssolutions</groupId>
    <artifactId>ens-license</artifactId>
    <version>1.2.0</version>
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
| `ENS_LICENSE_FILE` | `/etc/ens/<product>.lic` | The license file. With the license state in the database (below), read once, to import an existing installation. |
| `ENS_LICENSE_STATE_DIR` | `/var/lib/ens/<product>` | Installation id and highest revisions. Put it on a persistent volume. If it is lost, the installation gets a new id and bound licenses must be re-bound. With the license state in the database (below), likewise read once for the import. |
| `ENS_LICENSE` | (unset) | The license itself rather than a path: the token between the file's `BEGIN` and `END` lines (line breaks allowed; for a file with two blocks, each block's token on its own line), the whole file, or the file base64-encoded (`base64 -w0 license.lic`, the safest choice). The first `current()` call installs it into `ENS_LICENSE_FILE` if no usable license is installed, or if it is a newer revision of the installed license. A different license installed another way, such as an upload, is kept. A license for another product or installation is refused. `environmentLicenseStatus()` says what happened, and the same line is logged through `System.Logger`. |

### Several replicas: license state in the database

`fromEnvironment(product, verifier, releaseDate)` keeps the license file and
the state directory on a local volume, which ties an application to one
replica: two replicas with their own volumes would show two installation ids
and could disagree about revisions. From 1.2.0 the state can live in the
application's own database instead, shared by every replica:

```java
LicenseManager licenses = LicenseManager.fromEnvironment(
        "certalert",
        LicenseVerifier.trusting(EnsKeys.PUBLIC_KEYS),
        Optional.of(buildDate),
        dataSource);                                     // the application's pooled DataSource
```

That is `new LicenseManager(product, verifier, store, releaseDate, clock,
environmentLicense)` with
`new JdbcLicenseStore(dataSource, product).importingFileStateOnFirstUse(licenseFile, stateDir)`,
for an application that wants to put it together itself. Everything else
(`current()`, `install(...)`, `installationId()`, `ENS_LICENSE`) works as
before. `licenseLocation()` says where the license is kept (a path, or "the
database"); `licenseFile()` is null in database mode.

- **One installation id.** It is inserted only if there is none, so replicas
  starting together all get the same one.
- **Revisions only go up.** A revision is raised with
  `UPDATE ... SET revision = ? WHERE ... AND revision < ?` (inserted if
  absent), so concurrent raises end at the highest and nothing lowers it. An
  older revision uploaded on any replica is refused as `SUPERSEDED`.
- **Changes on another replica.** Each `LicenseManager` asks the database
  whether the license changed (one indexed `SELECT` of a version number) at
  most every 5 seconds (`JdbcLicenseStore.DEFAULT_RECHECK_INTERVAL`; the
  three-argument constructor takes another interval), so an upload on one
  replica is in force everywhere within that time, without a query per
  request. The replica that took the upload has it at once.
- **A database outage** for a moment (a fail-over) keeps the license read last
  in force and logs a warning; an upload then fails with an error, and works
  again once the database is back.
- **Plain JDBC**, no Spring and no new dependency (`java.sql` only). Each call
  borrows a connection in auto-commit mode and returns it: give it the pooled
  `DataSource` itself (what Spring Boot's `DataSource` bean is), not a
  transaction-bound proxy.
- The 64 KiB cap applies as before; the database store refuses to write a
  longer text, and the FIPS P-256 co-signature behaviour is unchanged.

#### Tables

The library never creates tables: add them with the application's
migrations (Flyway, e.g. `V<n>__ens_license_state.sql`). The same statements
are in the jar (`com/enssolutions/license/schema/{postgresql,mysql,h2}.sql`,
or `JdbcLicenseStore.Dialect.POSTGRESQL.ddl()` and so on), and the tests
create their tables from those files. PostgreSQL:

```sql
CREATE TABLE ens_license_installation (
    product          VARCHAR(64)  NOT NULL PRIMARY KEY,
    installation_id  VARCHAR(32)  NOT NULL,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE ens_license_file (
    product          VARCHAR(64)  NOT NULL PRIMARY KEY,
    license_text     TEXT         NOT NULL,
    license_version  BIGINT       NOT NULL,
    updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE ens_license_revision (
    product          VARCHAR(64)  NOT NULL,
    license_id       VARCHAR(128) NOT NULL,
    revision         INTEGER      NOT NULL,
    updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (product, license_id)
);
```

MySQL 8.4: the same, with `license_text MEDIUMTEXT`, `DATETIME` for the
timestamps, and `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` after each table.
H2 2.x: the same, with `license_text CLOB`.

| Table | Rows |
|---|---|
| `ens_license_installation` | One per product: the installation id. |
| `ens_license_file` | One per product: the installed license file's text, and a version raised on every write. |
| `ens_license_revision` | One per product and license id: the highest revision accepted. |

Back these tables up with the rest of the database; losing
`ens_license_installation` means a new installation id, as losing the state
directory did.

#### Upgrading an existing installation

No manual step. On its first use against tables with no installation id for
the product, the manager imports the file state it finds at
`ENS_LICENSE_STATE_DIR` and `ENS_LICENSE_FILE`: the highest revisions, the
license file (unless the database already has one), and last the
installation id, so a license bound to that id keeps working. Each step only
inserts what is absent or raises a revision, so replicas starting together
agree, and an interrupted import finishes on the next start. Once the database
has an installation id, the files are never read again; the volume can be
removed after the first start (keep a copy until then). An application that
builds its own store can call `JdbcLicenseStore.importFileState(licenseFile,
stateDir)` directly; it returns whether an installation id was imported and
logs what it copied.

So for an upgrade: release the application with the migration above and the
four-argument `fromEnvironment`, keep the license volume mounted for that
first start, then scale out. A license given in `ENS_LICENSE` is installed
into the database as it was into the file.

Tested with Testcontainers on PostgreSQL 17 and MySQL 8.4, and on H2 in its
own, PostgreSQL and MySQL modes, each with the DDL for that database: one
installation id from 16 concurrent replicas, concurrent revision raises that
never go back, two managers on one database, the import, and an outage. Those
two Testcontainers suites need Docker; without it they are skipped on a
developer machine and fail on CI (when `CI` is set).

### Spring Boot

`java/examples/spring/` is the wiring to copy into each application (it
compiles against Spring Boot 3.5 and 4.1):

- `LicensingConfiguration`: the `LicenseManager` bean, with the release date
  from `build-info` and the license state in the application's `DataSource`
  (add the migration above), and the interceptor registration.
- `LicenseInterceptor`: unlicensed → redirect to the license screen;
  read-only → refuse anything but GET/HEAD; `@RequiresFeature` → 403 unless
  unlocked. Puts the check in the `license` request attribute for views.
- `LicenseController`: the *Administration → License* screen: state,
  installation id, upload.
- `LicensedJobs`: `mayRun("feature")` at the top of each `@Scheduled` job,
  `mayAdd(count)` in syncs.
- `EnsKeys`: the public keys, pasted from `/api/licensing/keys`: the
  Ed25519 key and, for FIPS mode, the ECDSA P-256 key.

Feature ids per product, as the applications should check them:

| Product | Features |
|---|---|
| `certalert` | `directory-sync`, `changelog-sync`, `notifications`, `metrics`, `projects`, `revocation-checks`, `endpoint-checks`, `risky-names`, `directory-cleanup`, `classification-banners`, `multi-directory` (Enterprise) |
| `mfa-portal` | `self-service`, `trusted-agents`, `help-desk`, `shipments`, `scheduled-jobs`, `branding`, `reports`, `bulk-upload`, `group-email` |
| `readyroom` | `attendance`, `calendar`, `absence-alerts`, `metrics` (metrics and reports), `org-chart`, `classification-banners` |
| `directory-portal` | `directory-editor`, `form-builder`, `self-service-profile`, `white-pages`, `smart-card-sign-in`, `metrics`, `data-analysis`, `schema-transfer` |

Ship every app with all of a product's features gated from the start, even
those every license includes today: a feature that's checked can be moved to
a different tier later by changing `src/data/licensing.ts` alone.

## Keys

- **Generate**: `npm run license -- keygen` for the Ed25519 key, and
  `npm run license -- keygen --alg p256` for the ECDSA P-256 key. The private
  keys go in the licensing service's `LICENSE_SIGNING_KEY` and
  `LICENSE_SIGNING_KEY_P256` (secrets; or `..._FILE` paths). The public keys
  go in every application's `EnsKeys`.
- **Rotate**: generate a new key of the same algorithm, add its public half
  to the applications and release them; then switch the setting to the new
  key and list the old public key in `LICENSE_TRUSTED_KEYS` (either
  algorithm). Existing files keep verifying, because applications trust both.
- **Lost key**: files already issued keep working, but nothing new can be
  signed for applications that only trust it. Back the keys up.
- **Check a file**: `npm run license -- verify <file.lic> <public key>...`
  checks every block signed by a key given; add `--alg p256` to check it as
  a Java runtime in FIPS mode will. `inspect` shows each block's key id.
- The fixtures' keys are derived from published values (Ed25519 seed and
  P-256 private scalar both `0x07` × 32). Never put them in a shipped
  application.

## FIPS 140-3

Customers run the applications on FIPS-enabled RHEL and OpenShift. A Java
runtime in FIPS mode does not offer Ed25519, so a license signed only with
Ed25519 can't be checked there and the application stays unlicensed. Every
license therefore also carries an ECDSA P-256 signature once the portal has
a P-256 key.

### What was found (October 2026)

| Runtime | Ed25519 | ECDSA P-256 (`SHA256withECDSA`) |
|---|---|---|
| Red Hat OpenJDK 21.0.12 (UBI 9 `openjdk-21-runtime` 1.24) and 17.0.20, **FIPS mode** | **No**: `Signature.getInstance("Ed25519")` throws `NoSuchAlgorithmException` (SunEC keeps only its `KeyFactory`s; SunPKCS11 has no EdDSA) | Yes, from `SunPKCS11-NSS-FIPS` |
| The same, not in FIPS mode | Yes (SunEC) | Yes (SunEC) |
| BouncyCastle FIPS 2.0.0–2.0.2 and 2.1.0, approved-only, as the only provider | **No**: neither `Signature` nor `KeyFactory` | Yes, from `BCFIPS` |
| BouncyCastle FIPS 2.1.1–2.1.3, approved-only | Yes | Yes |

How Red Hat's OpenJDK decides: at start-up it loads the crypto-policies
`java.config`, then, unless `-Dcom.redhat.fips=false`, asks NSS whether the
system is in FIPS mode (`SECMOD_GetSystemFIPSEnabled`, which reads
`/proc/sys/crypto/fips_enabled`, or the `NSS_FIPS` environment variable).
If so, it replaces its providers with `SunPKCS11-NSS-FIPS`, SUN, SunEC (key
factories only), SunJSSE, SunJCE, SunRsaSign and XMLDSig. Running
`update-crypto-policies --set FIPS` in a container does *not* switch it on;
a FIPS kernel (or `NSS_FIPS=1`) does. `-Dcom.redhat.fips=false` brings
Ed25519 back but takes the whole JVM out of FIPS mode: not a fix.

With library 1.0.0 the result was: on Red Hat FIPS mode every license is
refused ("The signature could not be checked: Ed25519 Signature not
available") and the application is unlicensed; on BouncyCastle FIPS 2.0/2.1.0
approved-only, `LicenseVerifier.trusting(...)` throws at start-up, so an
application whose license bean is built from it does not start at all.

### What the library does (1.1.0)

- `LicenseVerifier.trusting(...)` takes Ed25519 and P-256 keys and never needs
  the runtime to support them; it fails only for a key of another kind.
- `verify` tries the blocks whose key it trusts, Ed25519 first. If the
  runtime lacks an algorithm (`NoSuchAlgorithmException`, a key it can't take,
  or a `ProviderException`), it moves on to the next block. One good
  signature from a trusted key is enough. If none is good it says
  `BAD_SIGNATURE`; if none could be checked, `UNSUPPORTED_ALGORITHM`, with a
  message telling the administrator to ask ENS for a file with an ECDSA P-256
  signature.
- `isSupported(Algorithm)` and `trustedKeys()` let a license screen say what
  the runtime can check.

### Proving it

- `SignatureAlgorithmsTest` simulates runtimes without Ed25519 per verifier
  (a test seam, not a change to the installed providers).
- CI job `licensing-fips` runs `FipsCheck` on the UBI 9 OpenJDK 21 and 17
  runtimes with `NSS_FIPS=1` (real FIPS mode: SunPKCS11 over the NSS FIPS
  token), and on BouncyCastle FIPS 2.0.0, 2.1.0 and 2.1.3 in approved-only
  mode. It first checks the runtime really is in that configuration. It does
  not prove anything about a FIPS kernel beyond what NSS reports (the kernel
  plays no other part in a license check), and it is not a certification.

### Turning it on in production

1. `npm run license -- keygen --alg p256` on a trusted machine; store the
   private key as a secret and back it up like the Ed25519 key.
2. Set `LICENSE_SIGNING_KEY_P256` (or `LICENSE_SIGNING_KEY_P256_FILE`) on the
   licensing service. From then on every license and re-issue is signed with
   both keys; `/api/licensing/keys` lists both as current. Applications from
   before 1.1.0 keep working, through the Ed25519 block.
3. Add the P-256 public key to each application's `EnsKeys`, next to the
   Ed25519 key, with library 1.1.0, and release.
4. Licenses issued before step 2 have no P-256 signature. For a customer on
   FIPS, open the license in `/admin` and use **Re-sign**: the same license
   as the next revision, signed with both keys. *Check a file* tells a
   customer whether a file will work in FIPS mode.

### Statement for product documentation

> **Licensing and FIPS 140-3.** The application checks its license file
> offline, by verifying ENS Solutions' digital signature with the Java
> runtime's own cryptographic providers; the license library contains no
> cryptographic implementation of its own and needs no secret on your
> system. License files carry two signatures over the same content: Ed25519
> and ECDSA P-256 with SHA-256 (FIPS 186-5). When the Java runtime is in FIPS
> mode, such as Red Hat build of OpenJDK on a FIPS-enabled RHEL or OpenShift
> host, the application verifies the ECDSA P-256 signature through the
> runtime's FIPS provider (on Red Hat, the NSS FIPS module through
> SunPKCS11-NSS-FIPS) and does not use Ed25519. Whether a deployment meets
> FIPS 140-3 depends on the Java runtime and its validated cryptographic
> module; ENS Solutions does not supply or claim a validated module. License
> files issued before ECDSA signing was enabled carry only an Ed25519
> signature: if the license screen reports that the runtime can't check
> the license, ask ENS Solutions for a re-issued file.

## Online status (optional)

An application with a network route can call
`GET /api/licensing/licenses/<id>/status` to learn whether a license has been
revoked and its latest revision. It returns no customer details. Nothing
requires it; revocation is otherwise enforced by expiry.
