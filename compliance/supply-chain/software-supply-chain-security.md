---
title: "Software supply chain security"
version: "1.0"
date: "2026-10-30"
owner: "ENS Solutions, LLC"
---

# Software supply chain security

This document describes where the components of CertAlert, the Directory Services Portal, ReadyRoom and the RSA Operations Portal come from, how the images, charts and release packages are built, signed and delivered, how a customer verifies a release before installing it, and where the gaps are. It is written from the repositories' build files, workflows and documentation at the revisions below; nothing in it is a plan.

## Document control

| Item | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-10-30 |
| Owner | ENS Solutions, LLC |
| Review cycle | Annual, and at each major release of any product |
| Applies to | CertAlert `main` e21a31a; Directory Services Portal `main` 5b04576 (v0.0.5); ReadyRoom (`in-n-out-work`) `main` 84553c6 (v0.0.5); RSA Operations Portal `main` 183b562; documentation `master` ab820d1 |

## Components and their sources

| Component | Source | How the version is fixed |
|---|---|---|
| Java libraries (Spring Boot, Spring Security, OpenSAML, UnboundID, JDBC drivers and the rest) | Maven Central | Declared in `build.gradle.kts` (CertAlert), `build.gradle` (ReadyRoom), `backend/pom.xml` (Directory Services Portal) and the Maven reactor `pom.xml` (RSA Operations Portal); versions come from the Spring Boot BOM or are pinned explicitly, with security pins ahead of the BOM where needed (for example Guava 33.7.2 in all four) |
| JavaScript (Directory Services Portal web tier: React 19, Vite 8; the accessibility scanners) | npm | `package-lock.json` at the repository root (Directory Services Portal) and `a11y/package-lock.json` (CertAlert); `npm audit --omit=dev --audit-level=high` runs in CI for the portal |
| Base images | Red Hat Universal Base Image 9: `ubi9/openjdk-21` and `ubi9/openjdk-21-runtime` (CertAlert, Directory Services Portal API, ReadyRoom), `ubi9/nginx-126` and `ubi9/nodejs-22` (Directory Services Portal web), `ubi9/ubi` with `java-17-openjdk-headless` (RSA Portal and Connector); `eclipse-temurin:21-jdk` as a build-only stage for ReadyRoom | Pinned by digest in every Dockerfile; Dependabot proposes new digests weekly, except the RSA images whose base is a build argument updated by hand |
| Database images bundled in the release packages | `postgres:17.11-alpine` (CertAlert), `postgres:16` (ReadyRoom), `mysql:8.4.x` (RSA Operations Portal), from Docker Hub | Pinned by tag in the release compose files; SBOMs of these images ship with the release; they are not built on UBI, which the FIPS page states |
| GitHub Actions | GitHub Marketplace | Pinned to a commit SHA with the version in a comment, in every workflow of all four repositories; Dependabot keeps them current |
| Build tools (Trivy 0.75.0, cosign v3.1.3 or v2.6.1, syft through `anchore/sbom-action`) | Their GitHub releases | Downloaded by exact version; Trivy's archive is checked against a SHA-256 in the workflow before it runs |
| RSA Authentication Manager SDK (`am-client` 8.8) and the libraries RSA ships with it | RSA, vendored by ENS under `rsaapp-connector/rsa-lib` and identical copies in `rsaapp-api` and `rsaapp-portal` | Stored under Git LFS (`.gitattributes`: `*.jar filter=lfs`); never upgraded independently of RSA; constraints in the README's "Dependency Constraints" |

## Base-image policy

Runtime images are Red Hat UBI 9, pinned by digest, built in multi-stage Dockerfiles whose build stages are pinned too. The images run as non-root users (uid 185, 1001 or `tomcat`) and the Helm charts run them with a read-only root file system, no capabilities, no privilege escalation and the `RuntimeDefault` seccomp profile. A new base digest arrives through Dependabot and is rebuilt, scanned and published like any other change; a vulnerability in the base that Red Hat has not fixed yet is the usual reason for a `.trivyignore` entry (CertAlert's three pcre2 entries, expiring 2026-11-17, are this case). Nothing is downloaded at container start.

## Build integrity

- Every build runs in GitHub Actions from the repository; nothing is built or published by hand.
- Workflow permissions default to `contents: read`; `packages: write` and `id-token: write` are granted only to the job that publishes, and `attestations: write` only to CertAlert's `image` job.
- Dependencies are resolved from declared, locked versions; base images and Actions are content-addressed (digest, commit SHA).
- Every image is scanned with Trivy before it is pushed, and the build fails on a fixable HIGH or CRITICAL finding; accepted exceptions carry a reason and an expiry.
- Every pull request builds the complete release bundle and chart as a dry run (`0.0.0-pr<n>`), kept as a workflow artifact, so packaging differences show before a release.
- A release tag's `image` job first checks that the release bucket and credentials are configured and fails before building anything if they are not.

The builds are reproducible in their inputs (same commit, same digests, same locked versions), not bit-for-bit reproducible in their outputs; ENS does not claim reproducible builds.

## Signing and attestation

On a `v*` tag, in the GitHub `release` environment:

- **Images** are signed with cosign, keyless through Sigstore, using the workflow's GitHub OIDC token as the identity, always by digest (`cosign sign --yes <image>@<digest>`).
- **SBOMs** (SPDX 2.3 JSON, generated with syft) are attached to each image as a signed attestation of type `spdxjson` (`cosign attest --yes --type spdxjson`).
- **Helm charts**, pushed to `oci://ghcr.io/winllc/charts/<chart>`, are signed with cosign by digest.
- **SLSA build provenance** is recorded for CertAlert's image with `actions/attest-build-provenance`, pushed to the registry beside the image and recorded on the repository; it names the workflow, commit and runner that built it. The other three products do not record provenance attestations.
- **Checksums**: `SHA256SUMS` covers the bundle, the chart and the SBOMs; `SHA256SUMS.asc` is a detached GPG signature by the ENS release signing key, made in a throwaway keyring, and exists only when the key is configured on the repository. The job summary says whether the release was signed. The release key is separate from the license signing keys.
- **Upload** to the private release bucket uses an IAM role assumed through GitHub's OIDC provider, trusted for `repo:winllc/<repo>:environment:release` (with the `v*` tag ref for ReadyRoom and the RSA Operations Portal); long-lived access keys are a warned fallback.

## Release channels

| Channel | What | Where |
|---|---|---|
| Container images | `ghcr.io/winllc/cert-alert`, `ghcr.io/winllc/directory-services-portal-api` and `-web`, `ghcr.io/winllc/in-n-out-work`, `ghcr.io/winllc/rsa-operations-portal` and `-connector` | GitHub Container Registry, tagged with the version; signed and attested on release tags |
| Helm charts | `oci://ghcr.io/winllc/charts/{cert-alert, directory-services-portal, readyroom, rsa-operations-portal}` | Same registry; also in the download |
| Release bundles | `<product>-<version>.tar.gz` (compose files pinned to the release images, installer, upgrade and backup scripts, the images as archives for air-gapped sites), the chart `.tgz`, the Directory Services Portal's native package, `sbom-*.spdx.json`, `SHA256SUMS`, `SHA256SUMS.asc` | A private S3 bucket under `<product>/<version>/`; customers download through the licensing portal's Downloads page (`/account/downloads`) as short-lived presigned links, with entitlement checked and each download audited |

Nothing is attached to GitHub Releases; the public repositories' tags carry no installable assets.

## How a customer verifies a release

From the documentation site's releases page:

```bash
# The download
gpg --import ens-solutions-release.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing

# An image and its SBOM attestation (ReadyRoom shown; use the table above for the others)
cosign verify ghcr.io/winllc/in-n-out-work@<digest> \
  --certificate-identity-regexp 'https://github.com/winllc/in-n-out-work/.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation --type spdxjson ghcr.io/winllc/in-n-out-work@<digest> \
  --certificate-identity-regexp 'https://github.com/winllc/in-n-out-work/.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# The chart
cosign verify ghcr.io/winllc/charts/readyroom@<digest> \
  --certificate-identity-regexp 'https://github.com/winllc/in-n-out-work/.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# CertAlert only: the build provenance
gh attestation verify oci://ghcr.io/winllc/cert-alert@<digest> --repo winllc/cert-alert
```

The GPG key's fingerprint must be checked against one ENS gives the customer separately, never against anything in the download. Cosign contacts Sigstore's public services to verify a keyless signature, so on an air-gapped network the verification is done on a connected machine before the images are mirrored.

## SBOM availability

An SPDX 2.3 JSON SBOM of every container image is produced on every build and shipped with every release in the download (`sbom-<image>.spdx.json`), as well as attested on the image. Any account that holds a license for a product, an evaluation license included, can download them from `/account/downloads`. The SBOM README in this pack has the details, including the licensing portal's own SBOM.

## Vulnerability handling

How findings in these components are found, rated, fixed or accepted, and disclosed is in the vulnerability management policy in this pack. The short version: Dependabot weekly, Trivy on every image with a failing gate, CodeQL in three of four repositories, a published disclosure address, remediation targets by severity, and risk acceptances only with a written justification, an expiry and compensating controls.

## The vendored RSA SDK

The RSA Operations Portal depends on RSA's Authentication Manager SDK, which RSA supplies as jars rather than through a public repository. ENS vendors `am-client` 8.8 and the libraries RSA ships with it under Git LFS in three modules, and documents the constraints: the jars are Java 8 bytecode on Spring 3.2, so the Connector stays on Spring Framework 3.2.18 and Spring Security 3.2.10 (the last releases of those lines) on Tomcat 9, and the api, connector and mock modules compile with `--release 8`. The one jar replaced is commons-beanutils (1.11.0 from Maven Central for CVE-2025-48734).

The risk statement: these are end-of-life frameworks whose known vulnerabilities (twenty-three CVEs at this revision) cannot be patched, only accepted with an expiry (2027-04-18) and compensated. The compensations in the code are that only the Portal can reach the Connector (NetworkPolicy, no published port), that it must present a client certificate and a shared secret before anything is parsed, that the Hessian endpoint rebuilds only allow-listed classes, and that Authentication Manager's replies pass a JEP 290 deserialization filter. The provenance of the jars themselves is RSA's distribution; ENS cannot produce an SBOM attestation from RSA for them, and the syft-generated SBOM lists what it can identify inside them. What cryptography the SDK uses is RSA's to state.

## Gaps

- **GPG signing is optional.** `SHA256SUMS.asc` exists only when `RELEASE_GPG_PRIVATE_KEY` is set on the repository; a release made without it is unsigned at the checksum level (the cosign signatures and attestations do not depend on it). No public key fingerprint is published yet; the Downloads page links to the key only when the portal is configured with it.
- **SLSA provenance only for CertAlert.** The Directory Services Portal, ReadyRoom and the RSA Operations Portal publish cosign signatures and SBOM attestations but no build provenance attestation.
- **No CodeQL in the RSA Operations Portal repository.**
- **The RSA base image digest is updated by hand**, because its Dockerfile takes the base as build arguments that Dependabot cannot follow.
- **Branch protection, required reviews and the `release` environment's reviewers** are organization settings the repositories do not show; ENS confirms them separately.
- **Not reproducible bit for bit.** Inputs are pinned; outputs are not compared across builds.
- **The ReadyRoom Windows agent** is distributed as PowerShell scripts that are not code-signed; there is no MSI.
- **The database images** in the release packages come from Docker Hub by tag and are not built on UBI.

## Evidence index

- `cert-alert`: `.github/workflows/ci.yml` (`image` and `release` jobs: Trivy, syft, cosign, `attest-build-provenance`, GPG, OIDC upload), `.github/dependabot.yml`, `.trivyignore`, `Dockerfile`, `build.gradle.kts`, `a11y/package-lock.json`, `deploy/release/`
- `directory-services-portal`: `.github/workflows/ci.yml` (`image` and `release` jobs), `.github/dependabot.yml`, `.trivyignore`, `backend/Dockerfile`, `web/Dockerfile`, `backend/pom.xml`, `package-lock.json`, `deploy/package/`
- `in-n-out-work`: `.github/workflows/ci.yml` (`image` job), `.github/dependabot.yml`, `.trivyignore`, `Dockerfile`, `build.gradle`, `deploy/bundle/`, `powershell/`
- `rsa-operations-portal`: `.github/workflows/ci.yml` (`image` job), `.github/dependabot.yml`, `.trivyignore`, `.gitattributes`, `pom.xml`, `rsaapp-connector/pom.xml`, `rsaapp-connector/rsa-lib/`, `rsaapp-portal/Dockerfile`, `rsaapp-connector/Dockerfile`, `scripts/release-bundle.sh`, `README.md` (sections "Releases" and "Dependency Constraints")
- `ens-products-page`: `src/pages/trust.astro`, `compliance/vulnerability-management-policy.md`, `compliance/sbom/README.md`
- Documentation: `https://winllc.github.io/ens-apps-documentation/releases/`, `https://winllc.github.io/ens-apps-documentation/fips-and-stig/` (image bases and the supply-chain table), `https://winllc.github.io/ens-apps-documentation/directory-services-portal/security/` (supply chain section)
