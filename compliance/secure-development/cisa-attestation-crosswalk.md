---
title: "CISA Secure Software Development Attestation Form: crosswalk to evidence"
version: "1.0"
date: "2026-10-30"
owner: "ENS Solutions, LLC"
---

# CISA Secure Software Development Attestation Form: crosswalk to evidence

This document maps the four attestation areas of the CISA Secure Software Development Attestation Form (the common form for software producers selling to federal agencies under OMB M-22-18 and M-23-16) to the evidence in the ENS Solutions repositories for CertAlert, the Directory Services Portal, ReadyRoom and the RSA Operations Portal. It is a crosswalk, not a signed attestation: where the evidence exists it is named, and where it does not, or where it is an organization setting the repositories cannot show, the line says "not yet" or "owner to confirm" so that the person who signs the form knows exactly what they are attesting to. The SSDF evidence document in this pack gives the practice-level detail.

## Document control

| Item | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-10-30 |
| Owner | ENS Solutions, LLC |
| Review cycle | Annual, at each major release, and before any attestation is signed |
| Applies to | CertAlert `main` e21a31a; Directory Services Portal `main` 5b04576 (v0.0.5); ReadyRoom (`in-n-out-work`) `main` 84553c6 (v0.0.5); RSA Operations Portal `main` 183b562 |

## 1. The software is developed and built in secure environments

| Form item | Evidence | Status |
|---|---|---|
| Separating and protecting each environment used in development and build | Builds run in GitHub-hosted runners from the repository; nothing is built by hand. Each workflow's default permission is `contents: read`; `packages: write`, `id-token: write` and (CertAlert) `attestations: write` are granted only to the `image` or `release` job (`ci.yml`, all four). | Evidenced for the build environment. Developer workstations are not covered by anything in the repositories: **owner to confirm**. |
| Regularly logging, monitoring and auditing trust relationships | Release upload uses an IAM role assumed through GitHub's OIDC provider, trusted only for `repo:winllc/<repo>:environment:release` (and the `v*` tag ref for ReadyRoom and RSA); the job summary records which credentials were used (releases page, "Upload role and the `release` environment"). | Evidenced for the release trust relationship. GitHub audit-log review: **owner to confirm**. |
| Enforcing multi-factor authentication and conditional access | Not visible in the repositories. | **Not yet shown.** Whether MFA is required on the GitHub organization and on the AWS account is an organization setting ENS confirms separately. |
| Documenting and minimizing use of software products that create security risk | Dependencies are declared (Gradle, Maven, `package-lock.json`), base images and Actions pinned, and every image scanned; the one known-risk component, the RSA Authentication Manager SDK on Spring 3.2, is documented with its constraints and compensating controls (RSA `README.md`, "Dependency Constraints"; `.trivyignore`; vulnerability management policy). | Evidenced. |
| Encrypting sensitive data | Secrets in CI are GitHub secrets, used only in a throwaway GPG keyring removed after signing; AWS access keys are a warned fallback behind the OIDC role. | Evidenced for the pipeline. Encryption on developer machines: **owner to confirm**. |
| Implementing defensive cybersecurity practices, including continuous monitoring | CodeQL on push, pull request and weekly (CertAlert, Directory Services Portal, ReadyRoom); Trivy on every image; Dependabot weekly; `npm audit` (Directory Services Portal). | Evidenced for three repositories. **Not yet** for the RSA Operations Portal, which has no CodeQL workflow. Monitoring of the build infrastructure itself is GitHub's. |

## 2. The producer makes a good-faith effort to maintain trusted source code supply chains

| Form item | Evidence | Status |
|---|---|---|
| Automated tools or comparable processes to maintain trusted supply chains | Every GitHub Action pinned to a commit SHA; every base image to a digest; Trivy and cosign downloaded by version and Trivy checksum-verified; Dependabot proposes updates weekly for every ecosystem (`.github/dependabot.yml`, all four). | Evidenced. One exception stated: the RSA base image digest is a build argument updated by hand. |
| Addressing the security of internal code | Pull requests to `main`, CI gates on tests, scans and accessibility, CodeQL where present. Whether reviews are required before merge (branch protection) is not visible. | Partly evidenced. Branch protection: **owner to confirm**. |
| Addressing the security of third-party components | Trivy gate on fixable HIGH and CRITICAL findings; accepted risks with justification and expiry; the vendored RSA SDK jars under Git LFS with their constraints documented. | Evidenced. |

## 3. The producer maintains provenance for internal and third-party code

| Form item | Evidence | Status |
|---|---|---|
| Maintaining provenance data for internal code | Git history; releases built from tags by CI; cosign signatures bind each image and chart to the workflow identity `https://github.com/winllc/<repo>/.github/workflows/*` and GitHub's OIDC issuer. CertAlert additionally records SLSA build provenance (`actions/attest-build-provenance`, verifiable with `gh attestation verify`). | Evidenced for CertAlert in full. For the other three, signatures and SBOM attestations exist; a SLSA provenance attestation does **not yet**. |
| Maintaining provenance data for third-party components | SPDX 2.3 SBOMs generated with syft for every image on every build, shipped with each release and attached to the images as signed `spdxjson` attestations (all four). | Evidenced. |

## 4. The producer employs automated tools to check for security vulnerabilities

| Form item | Evidence | Status |
|---|---|---|
| Automated tools run on a continuous basis before release | Trivy on every image build with a failing gate; CodeQL weekly and on every change (three repositories); Dependabot weekly; test suites, image smoke tests and bundle installs on every push and pull request. | Evidenced; CodeQL **not yet** for the RSA Operations Portal. |
| Operating a vulnerability disclosure program | `/.well-known/security.txt` (RFC 9116) and the trust page name the contact, the acknowledgement target (three business days) and the expectations for reporters. | Evidenced. |
| A policy or process to address discovered vulnerabilities before release | The vulnerability management policy in this pack: severities, remediation targets, risk acceptance rules, how fixes ship. The build itself refuses to produce an image with a fixable HIGH or CRITICAL finding. | Evidenced as policy; measured performance against the targets does **not yet** exist. |

## What a signer should know

Before signing the common form, ENS should be able to say yes, from its own settings, to the items marked **owner to confirm**: MFA on the GitHub organization and the AWS account, branch protection with required reviews on `main` in all four repositories, required reviewers on the `release` environment, and the handling of code on developer machines. The items marked **not yet** (a CodeQL workflow for the RSA Operations Portal, SLSA provenance for three products, a record of remediation times) are engineering and process work; the form allows a plan of action and milestones for them, and this document does not pretend they are done.

## Evidence index

- All four repositories: `.github/workflows/ci.yml` (`permissions:` blocks; `image` and `release` jobs; the cosign, syft and GPG steps), `.github/dependabot.yml`, `.trivyignore`, the Dockerfiles
- `cert-alert`, `directory-services-portal`, `in-n-out-work`: `.github/workflows/codeql.yml`
- `cert-alert`: `.github/workflows/ci.yml`, step "Attest the image's build provenance"
- `rsa-operations-portal`: `.gitattributes`, `rsaapp-connector/rsa-lib/`, `README.md` (section "Dependency Constraints")
- `ens-products-page`: `public/.well-known/security.txt`, `src/pages/trust.astro`, `compliance/vulnerability-management-policy.md`, `compliance/secure-development/ssdf-evidence.md`
- Documentation: `https://winllc.github.io/ens-apps-documentation/releases/` (verification; the `release` environment and OIDC role), `https://winllc.github.io/ens-apps-documentation/fips-and-stig/` (supply-chain table)
