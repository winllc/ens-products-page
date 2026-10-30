---
title: "Software bills of materials"
version: "1.0"
date: "2026-10-30"
owner: "ENS Solutions, LLC"
---

# Software bills of materials

This note says which software bills of materials (SBOMs) ENS Solutions produces for CertAlert, the Directory Services Portal, ReadyRoom and the RSA Operations Portal, where a customer gets them, how to verify the one attached to an image, and how the licensing portal's own SBOM is made. The SBOM files themselves live with each release, not in this pack; the one file this artifact carries is the licensing portal's.

## Document control

| Item | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-10-30 |
| Owner | ENS Solutions, LLC |
| Review cycle | Annual, and at each major release of any product |
| Applies to | Every release built by the current pipelines: CertAlert `main` e21a31a, Directory Services Portal `main` 5b04576 (v0.0.5), ReadyRoom (`in-n-out-work`) `main` 84553c6 (v0.0.5), RSA Operations Portal `main` 183b562; the licensing portal at the build that served this file |

## What ENS produces

| Property | Value |
|---|---|
| Format | SPDX 2.3, JSON |
| Generator | syft, through `anchore/sbom-action` pinned by commit in each repository's `ci.yml` |
| Scope | One SBOM per container image, built from the image itself (operating-system packages and application dependencies as syft identifies them) |
| When | On every image build; shipped on every release tag |
| Files per release | CertAlert: `sbom-cert-alert.spdx.json`. Directory Services Portal: `sbom-directory-services-portal-api.spdx.json`, `sbom-directory-services-portal-web.spdx.json`. ReadyRoom: `sbom-in-n-out-work.spdx.json`, `sbom-postgres.spdx.json`. RSA Operations Portal: `sbom-rsa-operations-portal.spdx.json`, `sbom-rsa-operations-portal-connector.spdx.json`, `sbom-mysql.spdx.json` |
| Attestation | Each application image's SBOM is attached to the image as a cosign attestation of type `spdxjson`, signed keyless through Sigstore with the release workflow's GitHub identity, by digest. The bundled database images' SBOMs ship in the download only |
| Checksums | Every SBOM file is listed in the release's `SHA256SUMS`, which is GPG-signed when the release key is configured |

The SBOMs describe what is in the image. For the RSA Operations Portal's Connector, that includes the RSA Authentication Manager SDK jars and the libraries RSA ships inside them (Jython with its bundled commons-compress and Guava), which is why the Connector's accepted-risk list in `.trivyignore` is read alongside its SBOM.

## Where to get them

1. Sign in to the ENS licensing portal and open **Downloads** (`/account/downloads`).
2. Pick the product and expand the version. The SBOM files are listed with their size and SHA-256, next to the bundle, the chart and `SHA256SUMS`.
3. Download them like any other release file: each link is a short-lived presigned link and the download is recorded in the account's history.

Any account that holds a license for the product can download its releases, an evaluation license included, so a free evaluation is enough to obtain the SBOMs for a security review. Every earlier version remains listed, so the SBOM of a release a customer runs today stays available.

## How to verify the attestation

```bash
# the digest of the version you run
docker buildx imagetools inspect ghcr.io/winllc/cert-alert:<version>

# the SBOM attestation on that digest
cosign verify-attestation --type spdxjson ghcr.io/winllc/cert-alert@<digest> \
  --certificate-identity-regexp 'https://github.com/winllc/cert-alert/.github/workflows/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Use the image name and repository from the table on the documentation site's releases page for the other products (`winllc/directory-services-portal`, `winllc/in-n-out-work`, `winllc/rsa-operations-portal`). The command prints the attestation's payload, which carries the SPDX document, once the signature and the identity check pass. Cosign reaches Sigstore's public services to do this, so on an air-gapped network verify on a connected machine first. The downloaded file can be checked against `SHA256SUMS` with `sha256sum -c SHA256SUMS --ignore-missing`.

## The licensing portal's own SBOM

The licensing portal and product site are one Node.js application (Astro). Its SBOM, `ens-products-page.spdx.json` in this artifact, is generated at every build of the portal from the application's locked dependencies, so the file an account downloads describes the build that served it. It is regenerated, not hand-maintained, and carries the build's version and date inside the SPDX document. It is not attested with cosign; the portal is not delivered to customers as an image.

## Requesting an SBOM for a specific release

If a release is not visible on the Downloads page (an account without a license for that product, a site that cannot reach the portal, or a version older than the account's first license), ask ENS through the product site's contact page or the support address, naming the product and the exact version, and ENS sends the SBOM files and `SHA256SUMS` by presigned link, with the same checksums the Downloads page shows. SBOMs are also provided on request in advance of a purchase for a security review, under the same evaluation terms.

## Evidence index

- `cert-alert`, `directory-services-portal`, `in-n-out-work`, `rsa-operations-portal`: `.github/workflows/ci.yml` (the syft steps and `cosign attest --type spdxjson`)
- `rsa-operations-portal`: `.trivyignore`
- `ens-products-page`: `compliance/sbom/generated/ens-products-page.spdx.json` (generated at build), `src/data/compliance/manifest.ts`
- Documentation: `https://winllc.github.io/ens-apps-documentation/releases/` (file list, image names, verification), `https://winllc.github.io/ens-apps-documentation/fips-and-stig/` (supply-chain table)
