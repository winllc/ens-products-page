---
title: "Secure Software Development Framework (NIST SP 800-218) evidence"
version: "1.0"
date: "2026-10-30"
owner: "ENS Solutions, LLC"
---

# Secure Software Development Framework (NIST SP 800-218) evidence

This document maps the practices of NIST SP 800-218, the Secure Software Development Framework (SSDF) version 1.1, to what the ENS Solutions repositories show for CertAlert, the Directory Services Portal, ReadyRoom and the RSA Operations Portal: repository paths, CI job names and documentation pages a reviewer can open. Each practice is marked **Evidenced** (the repositories show it), **Partly evidenced** (part of it is in the repositories, the rest is a procedure or a setting ENS confirms separately) or **Not evidenced** (nothing in the repositories shows it). It describes practice, not a certification, and it does not claim anything that is organization-level configuration ENS cannot show in code.

## Document control

| Item | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-10-30 |
| Owner | ENS Solutions, LLC |
| Review cycle | Annual, and at each major release of any product |
| Applies to | CertAlert `main` e21a31a; Directory Services Portal `main` 5b04576 (v0.0.5); ReadyRoom (`in-n-out-work`) `main` 84553c6 (v0.0.5); RSA Operations Portal `main` 183b562; documentation `master` ab820d1 |

Repository abbreviations: CA = `cert-alert`, DSP = `directory-services-portal`, RR = `in-n-out-work` (ReadyRoom), RSA = `rsa-operations-portal`. "All four" means each of these repositories.

## PO: Prepare the Organization

| Practice | Status | Evidence |
|---|---|---|
| PO.1 Define security requirements for software development | Partly evidenced | The requirements are written into the code and documentation rather than a standalone standard: the ENS platform baseline (banner, session limits, headers, audit trail, revocation) is described on the suite FIPS and STIG page and implemented in each product; this pack's vulnerability management policy sets severities and targets. There is no separate written secure-development standard. |
| PO.2 Implement roles and responsibilities | Partly evidenced | Roles are small and visible in the pipelines: releases are signed and uploaded only in the GitHub `release` environment, which the releases page says is to carry required reviewers; the product owner signs `.trivyignore` acceptances (RSA `.trivyignore`, "Accepted by the product owner on 2026-10-18" and "2026-10-28"). Training records are not in the repositories. |
| PO.3 Implement supporting toolchains | Evidenced | Every GitHub Action is pinned to a commit SHA with the version in a comment, and Dependabot keeps them current (`.github/dependabot.yml`, all four). Trivy and cosign are downloaded by version and Trivy's archive is checked against a SHA-256 before use (`ci.yml`, `image` job, all four). SBOMs are generated with syft through `anchore/sbom-action`. The toolchain itself is therefore under the same change control as the code. |
| PO.4 Define and use criteria for software security checks | Evidenced | The criteria are in the workflows: the build fails on any HIGH or CRITICAL vulnerability with a fix (`trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`), on a serious or critical axe-core violation (CA `a11y/scan.mjs`, `BLOCKING = {serious, critical}`; DSP `accessibility`, RR `accessibility`, RSA `accessibility` jobs), on `npm audit --audit-level=high` (DSP), and on any failing test. Accepted exceptions must carry a reason and an expiry (`.trivyignore` headers, all four). |
| PO.5 Implement and maintain secure environments for software development | Partly evidenced | What the code shows: workflow permissions default to `contents: read`; `packages: write`, `id-token: write` and (CA) `attestations: write` are granted to the `image` or `release` job only; long-lived AWS keys are a warned fallback behind an OIDC-assumed role; GPG keys live only in a throwaway keyring removed after signing. What the code cannot show: multi-factor authentication on the GitHub organization, branch protection and required reviews on `main`, and the protection rules on the `release` environment. ENS confirms those separately (see the CISA crosswalk). |

## PS: Protect the Software

| Practice | Status | Evidence |
|---|---|---|
| PS.1 Protect all forms of code from unauthorized access and tampering | Partly evidenced | Source is in Git on GitHub with pull requests; releases are built from tags by CI, never by hand. Branch protection is an organization setting not visible here. The RSA SDK jars are stored under Git LFS (`.gitattributes`, `*.jar filter=lfs`), so their content is addressed by hash. |
| PS.2 Provide a mechanism for verifying software release integrity | Evidenced | On a release tag CI signs each image and the Helm chart with cosign (keyless, Sigstore, the workflow's OIDC identity, always by digest) and attaches each image's SPDX SBOM as a signed attestation (`ci.yml`, "Sign the image(s) and the chart, and attest the image's SBOM", all four). CA also records SLSA build provenance with `actions/attest-build-provenance`. The bundle's `SHA256SUMS` is GPG-signed when the release key is configured; the pipeline says in its summary whether it was. Verification commands are on the releases page and the trust page. |
| PS.3 Archive and protect each software release | Evidenced | Releases are uploaded to a private S3 bucket under `<product>/<version>/` and served to customers only as short-lived presigned links from the licensing portal, with entitlement checked on every download and each download audited (`releases/` page; `ens-products-page` `src/server`). Every release's SBOMs and checksums are kept with it. Workflow artifacts keep the bundle for 30 days as well. |

## PW: Produce Well-Secured Software

| Practice | Status | Evidence |
|---|---|---|
| PW.1 Design software to meet security requirements and mitigate risks | Evidenced | Each product's security page documents its authentication chain, authorization model, open endpoints, outbound connections and hardening checklist, written from the code; the architecture pages (CA, DSP, RSA) and the RSA integration page describe the trust boundaries and exactly which classes each hop accepts. Threat-driven controls are visible in the code: SSRF guards on webhooks (CA `webhook/WebhookAddressGuard.java`, DSP `webhooks/UrlGuard.java`, RR `webhook/WebhookAddressPolicy.java`, RSA `webhook/SsrfGuard.java`), deserialization allow-lists (CA `session/SessionAttributeSerialization.java`, RSA `session/SessionAttributeCodec.java`, RSA Connector `security/AuthManagerReplyFilter.java`), and fail-closed audit for Authentication Manager changes (RSA `audit/AuditLog.java`). |
| PW.2 Review the software design to verify compliance with security requirements | Partly evidenced | Design review happens in pull requests (the repositories' histories show numbered pull requests merged to `main`); there is no separate design-review record. The documentation site's release checklist requires the docs to be checked against the code before a tag. |
| PW.4 Reuse existing, well-secured software when feasible | Evidenced | Authentication, sessions, CSRF and SAML/OIDC come from Spring Security and OpenSAML rather than ENS code; cryptography comes from the Java runtime's providers and no application implements its own (suite FIPS and STIG page, "Where the cryptography comes from"); images are built on Red Hat UBI 9. The one component that cannot be kept current, the RSA SDK, is isolated in the Connector behind mutual TLS and filters (vulnerability management policy, worked example). |
| PW.5 Create source code by adhering to secure coding practices | Evidenced | Server-side validation and escaping: Jakarta Bean Validation on DTOs (CA `web/dto/`), `FormValidator` and `@LdapFilter`/`@ValidDn` (DSP), form validators (RSA `validators/`), LDAP filter escaping (all three directory products), formula-neutralised CSV and XLSX exports (CA and RR `export/CsvTableWriter.java`, DSP `transfer/Csv.java`, RSA `audit/AuditAdminController.java`), CRLF-safe logging (CA `LogSafe.java`, RSA Connector `logging/CrlfSafePatternLayout.java`), constant-time secret comparison for proxy secrets and tokens (security pages), and security headers with a CSP that allows no inline scripts (CA `security/SecurityHeaders.java`, DSP `config/SecurityConfig.java` and nginx templates, RR `config/SecurityHeadersConfig.java`, RSA `security/SecurityHeaders.java`). |
| PW.6 Configure the compilation, interpreter, and build processes to improve executable security | Evidenced | Builds run in CI from pinned toolchains; images are multi-stage with a digest-pinned build stage and a digest-pinned runtime stage, run as non-root (CA, DSP API and RR uid 185; DSP web and RSA Portal uid 1001; RSA Connector the `tomcat` user); the Helm charts set `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]` and the `RuntimeDefault` seccomp profile (`values.yaml`, all four). The RSA Connector refuses to start on a JVM without serialization filters. |
| PW.7 Review and/or analyze human-readable code to identify vulnerabilities | Partly evidenced | CodeQL (java-kotlin and javascript-typescript) runs on push, pull request and weekly in CA, DSP and RR (`.github/workflows/codeql.yml`). RSA has no CodeQL workflow. Human review happens in pull requests; whether a review is required before merge is an organization setting. |
| PW.8 Test executable code to identify vulnerabilities | Evidenced | Unit and integration suites run on every push and pull request: CA `build` and `test-postgres` (898 test methods at this revision, Testcontainers PostgreSQL); DSP `api-test` (366) and `web-test` (13 Vitest files); RR `build` (1,157) and `windows-client` (Pester on Windows and Linux); RSA `build` (about 1,040 across four modules). End-to-end business tests exist in each (for example RR `src/test/java/com/winllc/innoutwork/cron/AbsenceAlertProcessTest.java` and RSA `rsaapp-portal/src/test/java/com/winllc/rsaapp/portal/helpdesk/HelpDeskDecisionsTest.java`). Each image is started and smoke-tested, the bundles are installed and upgraded in CI (CA `release-bundle`, DSP `bundle`, RR `bundle`, RSA `compose` and `podman-bundle`), and the Helm charts are installed in a kind cluster (`helm` jobs). No fuzzing and no penetration testing are in the pipelines. |
| PW.9 Configure software to have secure settings by default | Evidenced | Headers and CSRF always on; TLS 1.2 and 1.3 only where protocols are set; plain HTTP refused to other hosts (CA `deploy/release/install.sh`) or bound to loopback (DSP `deploy/package/docker/install.sh`); the application refuses to start with security off outside the `dev` profile (CA `security/SecurityOffGuard.java`); demo directories refused outside demo mode (DSP `config/StartupChecks.java`, RR `config/ApplicationProperties.java`); revocation on by default (RR `security/x509/X509Config.java`; CA `ocsp-then-crl` soft-fail when unset); mutual TLS to the Connector in new installations (RSA `util/connector-tls.sh`); webhook and secrets keys generated on new installations. The settings that are not secure by default (banner, concurrent sessions, CA `allow-unverified-crl`) are listed in each product's STIG table. |

## RV: Respond to Vulnerabilities

| Practice | Status | Evidence |
|---|---|---|
| RV.1 Identify and confirm vulnerabilities on an ongoing basis | Evidenced | Dependabot weekly (all four), Trivy on every image build (all four), CodeQL (CA, DSP, RR), `npm audit` (DSP), and a published disclosure address in `ens-products-page/public/.well-known/security.txt` and the trust page. The RSA repository's lack of CodeQL is the gap. |
| RV.2 Assess, prioritize, and remediate vulnerabilities | Partly evidenced | The gate fails the build on fixable HIGH and CRITICAL findings; accepted risks carry a reason and an expiry after which the build fails again (`.trivyignore`, all four; CA three entries to 2026-11-17, RSA twenty-three to 2027-04-18, DSP and RR none). The severity scale and remediation targets (Critical 7 days, High 30, Medium 90, Low next release) are written in this pack's vulnerability management policy; they are commitments of that policy, not yet a record of measured performance. |
| RV.3 Analyze vulnerabilities to identify their root causes | Partly evidenced | Root-cause notes exist where a vulnerability led to a design change: the `.trivyignore` comments explain per CVE why the vulnerable path is absent and record a run-time class-loading verification; README upgrade notes describe the reason for changes such as the webhook egress proxy and the plain-HTTP refusal. There is no separate root-cause register. |

## Summary

| Group | Evidenced | Partly evidenced | Not evidenced |
|---|---|---|---|
| PO | PO.3, PO.4 | PO.1, PO.2, PO.5 | none |
| PS | PS.2, PS.3 | PS.1 | none |
| PW | PW.1, PW.4, PW.5, PW.6, PW.8, PW.9 | PW.2, PW.7 | none |
| RV | RV.1 | RV.2, RV.3 | none |

The "partly evidenced" items share two causes: organization settings on GitHub that the code cannot show (multi-factor authentication, branch protection, required reviewers on the `release` environment), and written process documents that until this pack did not exist (a secure-development standard, measured remediation performance, a root-cause register). The CISA attestation crosswalk in this pack lists the first group as statements ENS confirms separately.

## Evidence index

- All four repositories: `.github/workflows/ci.yml` (jobs named above), `.github/dependabot.yml`, `.trivyignore`, `Dockerfile`s, `deploy/helm/*/values.yaml`, `docs/accessibility/`
- `cert-alert`: `.github/workflows/codeql.yml`, `a11y/scan.mjs`, `deploy/release/install.sh`, `src/main/java/com/winllc/certalert/security/SecurityOffGuard.java`, `security/SecurityHeaders.java`, `session/SessionAttributeSerialization.java`, `webhook/WebhookAddressGuard.java`, `export/CsvTableWriter.java`, `LogSafe.java`, `web/dto/`
- `directory-services-portal`: `.github/workflows/codeql.yml`, `deploy/package/docker/install.sh`, `backend/src/main/java/com/winllc/dsp/config/StartupChecks.java`, `config/SecurityConfig.java`, `service/FormValidator.java`, `web/validation/`, `webhooks/UrlGuard.java`, `transfer/Csv.java`, `web/nginx/templates/default.conf.template`
- `in-n-out-work`: `.github/workflows/codeql.yml`, `src/main/java/com/winllc/innoutwork/config/SecurityHeadersConfig.java`, `config/ApplicationProperties.java`, `security/x509/X509Config.java`, `webhook/WebhookAddressPolicy.java`, `export/CsvTableWriter.java`, `src/test/java/com/winllc/innoutwork/cron/AbsenceAlertProcessTest.java`, `powershell/tests/`
- `rsa-operations-portal`: `.gitattributes`, `util/connector-tls.sh`, `rsaapp-portal/src/main/java/com/winllc/rsaapp/portal/security/SecurityHeaders.java`, `session/SessionAttributeCodec.java`, `audit/AuditLog.java`, `audit/AuditAdminController.java`, `webhook/SsrfGuard.java`, `validators/`, `rsaapp-connector/src/main/java/com/winllc/rsaapp/connector/security/AuthManagerReplyFilter.java`, `logging/CrlfSafePatternLayout.java`
- `ens-products-page`: `public/.well-known/security.txt`, `src/pages/trust.astro`, `compliance/vulnerability-management-policy.md`, `compliance/secure-development/cisa-attestation-crosswalk.md`
- Documentation: `https://winllc.github.io/ens-apps-documentation/releases/`, `.../fips-and-stig/`, and each product's `security/`, `fips-and-stig/` and (CA, DSP, RSA) `architecture/` pages, plus `.../rsa-operations-portal/rsa-integration/`
